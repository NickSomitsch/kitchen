-- Recipes, transparent ingredient matching, and the weekly meal plan.
-- Reads go through row level security; every write goes through a security definer
-- function so ingredient replacement and inventory deduction stay atomic.

create type public.meal_slot as enum ('breakfast', 'lunch', 'dinner', 'snack');

create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 160),
  description text check (description is null or char_length(description) <= 1000),
  instructions text check (instructions is null or char_length(instructions) <= 20000),
  servings integer not null default 2 check (servings between 1 and 100),
  prep_minutes integer check (prep_minutes is null or prep_minutes between 0 and 6000),
  cook_minutes integer check (cook_minutes is null or cook_minutes between 0 and 6000),
  source_url text check (source_url is null or char_length(source_url) <= 500),
  image_url text check (image_url is null or char_length(image_url) <= 500),
  tags text[] not null default '{}' check (cardinality(tags) <= 20),
  is_favorite boolean not null default false,
  last_cooked_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  unique (household_id, id)
);

create index recipes_household_name_idx on public.recipes (household_id, lower(name));
create index recipes_household_updated_idx on public.recipes (household_id, updated_at desc);

create table public.recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  recipe_id uuid not null,
  inventory_item_id uuid,
  name text not null check (char_length(trim(name)) between 1 and 120),
  quantity numeric(12, 3)
    check (quantity is null or (quantity > 0 and quantity <= 999999999.999)),
  unit public.inventory_unit,
  optional boolean not null default false,
  position integer not null default 0 check (position between 0 and 200),
  created_at timestamptz not null default now(),
  check ((quantity is null) = (unit is null)),
  foreign key (household_id, recipe_id)
    references public.recipes(household_id, id) on delete cascade,
  foreign key (household_id, inventory_item_id)
    references public.inventory_items(household_id, id) on delete set null (inventory_item_id)
);

create index recipe_ingredients_recipe_idx
  on public.recipe_ingredients (recipe_id, position);
create index recipe_ingredients_household_name_idx
  on public.recipe_ingredients (household_id, lower(name));

create table public.meal_plan_entries (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  planned_on date not null
    check (planned_on between date '2000-01-01' and date '2200-01-01'),
  slot public.meal_slot not null,
  recipe_id uuid,
  title text check (title is null or char_length(trim(title)) between 1 and 160),
  servings integer check (servings is null or servings between 1 and 100),
  notes text check (notes is null or char_length(notes) <= 500),
  cooked_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  check (recipe_id is not null or nullif(trim(title), '') is not null),
  foreign key (household_id, recipe_id)
    references public.recipes(household_id, id) on delete set null (recipe_id)
);

create index meal_plan_entries_household_date_idx
  on public.meal_plan_entries (household_id, planned_on, slot);

create or replace function public.set_recipe_update_metadata()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.id = old.id;
  new.household_id = old.household_id;
  new.created_by = old.created_by;
  new.created_at = old.created_at;
  new.version = old.version + 1;
  new.updated_at = now();
  return new;
end;
$$;

create trigger recipes_set_update_metadata
  before update on public.recipes
  for each row execute function public.set_recipe_update_metadata();
create trigger meal_plan_entries_set_update_metadata
  before update on public.meal_plan_entries
  for each row execute function public.set_recipe_update_metadata();

-- Ingredient matching is deliberately explainable: an explicit link wins, otherwise
-- the ingredient name is compared to inventory names without case or padding.
create or replace function public.match_inventory_item(
  household uuid,
  ingredient_name text,
  linked uuid
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select item.id from public.inventory_items item
      where item.id = linked and item.household_id = household
    ),
    (
      select item.id from public.inventory_items item
      where item.household_id = household
        and lower(trim(item.name)) = lower(trim(ingredient_name))
      order by item.quantity desc, item.created_at
      limit 1
    )
  );
$$;

create or replace function public.save_recipe(
  recipe_id uuid,
  expected_version integer,
  recipe jsonb,
  ingredients jsonb
)
returns table (id uuid, version integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  household uuid := public.current_household_id();
  caller uuid := auth.uid();
  saved public.recipes%rowtype;
  ingredient jsonb;
  ingredient_count integer;
  slot integer := 0;
  linked uuid;
  ingredient_quantity numeric;
  ingredient_unit public.inventory_unit;
begin
  if household is null or caller is null then
    raise exception 'You must belong to a household.' using errcode = '42501';
  end if;
  if recipe is null or jsonb_typeof(recipe) <> 'object' then
    raise exception 'Recipe details are required.' using errcode = '22023';
  end if;
  if ingredients is null or jsonb_typeof(ingredients) <> 'array' then
    raise exception 'Recipe ingredients are required.' using errcode = '22023';
  end if;
  ingredient_count := jsonb_array_length(ingredients);
  if ingredient_count = 0 then
    raise exception 'Add at least one ingredient.' using errcode = '22023';
  end if;
  if ingredient_count > 60 then
    raise exception 'A recipe can hold at most 60 ingredients.' using errcode = '22023';
  end if;

  if expected_version is null then
    insert into public.recipes (
      id, household_id, name, description, instructions, servings,
      prep_minutes, cook_minutes, source_url, image_url, tags, created_by
    ) values (
      coalesce(recipe_id, gen_random_uuid()),
      household,
      trim(recipe ->> 'name'),
      nullif(trim(recipe ->> 'description'), ''),
      nullif(trim(recipe ->> 'instructions'), ''),
      coalesce(nullif(recipe ->> 'servings', '')::integer, 2),
      nullif(recipe ->> 'prep_minutes', '')::integer,
      nullif(recipe ->> 'cook_minutes', '')::integer,
      nullif(trim(recipe ->> 'source_url'), ''),
      nullif(trim(recipe ->> 'image_url'), ''),
      coalesce(
        (select array_agg(distinct lower(trim(tag)))
         from jsonb_array_elements_text(
           case when jsonb_typeof(recipe -> 'tags') = 'array' then recipe -> 'tags' else '[]'::jsonb end
         ) as tag
         where char_length(trim(tag)) between 1 and 40),
        '{}'::text[]
      ),
      caller
    ) returning * into saved;
  else
    select * into saved from public.recipes
    where recipes.id = recipe_id and recipes.household_id = household for update;
    if not found then
      raise exception 'That recipe is no longer available.' using errcode = 'P0002';
    end if;
    if saved.version <> expected_version then
      raise exception 'This recipe has changed.' using errcode = '40001';
    end if;
    update public.recipes set
      name = trim(recipe ->> 'name'),
      description = nullif(trim(recipe ->> 'description'), ''),
      instructions = nullif(trim(recipe ->> 'instructions'), ''),
      servings = coalesce(nullif(recipe ->> 'servings', '')::integer, 2),
      prep_minutes = nullif(recipe ->> 'prep_minutes', '')::integer,
      cook_minutes = nullif(recipe ->> 'cook_minutes', '')::integer,
      source_url = nullif(trim(recipe ->> 'source_url'), ''),
      image_url = nullif(trim(recipe ->> 'image_url'), ''),
      tags = coalesce(
        (select array_agg(distinct lower(trim(tag)))
         from jsonb_array_elements_text(
           case when jsonb_typeof(recipe -> 'tags') = 'array' then recipe -> 'tags' else '[]'::jsonb end
         ) as tag
         where char_length(trim(tag)) between 1 and 40),
        '{}'::text[]
      ),
      is_favorite = coalesce((recipe ->> 'is_favorite')::boolean, recipes.is_favorite)
    where recipes.id = saved.id
    returning * into saved;
    delete from public.recipe_ingredients where recipe_ingredients.recipe_id = saved.id;
  end if;

  for ingredient in select * from jsonb_array_elements(ingredients) loop
    ingredient_quantity := nullif(ingredient ->> 'quantity', '')::numeric;
    ingredient_unit := nullif(ingredient ->> 'unit', '')::public.inventory_unit;
    if (ingredient_quantity is null) <> (ingredient_unit is null) then
      raise exception 'Ingredient quantity and unit must be provided together.' using errcode = '22023';
    end if;
    linked := nullif(ingredient ->> 'inventory_item_id', '')::uuid;
    if linked is not null and not exists (
      select 1 from public.inventory_items
      where inventory_items.id = linked and inventory_items.household_id = household
    ) then
      linked := null;
    end if;
    insert into public.recipe_ingredients (
      household_id, recipe_id, inventory_item_id, name, quantity, unit, optional, position
    ) values (
      household, saved.id, linked, trim(ingredient ->> 'name'),
      ingredient_quantity, ingredient_unit,
      coalesce((ingredient ->> 'optional')::boolean, false), slot
    );
    slot := slot + 1;
  end loop;

  return query select saved.id, saved.version;
end;
$$;

create or replace function public.delete_recipe(
  recipe_id uuid,
  expected_version integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  household uuid := public.current_household_id();
  existing public.recipes%rowtype;
begin
  if household is null then
    raise exception 'You must belong to a household.' using errcode = '42501';
  end if;
  select * into existing from public.recipes
  where recipes.id = recipe_id and recipes.household_id = household for update;
  if not found then
    raise exception 'That recipe is no longer available.' using errcode = 'P0002';
  end if;
  if existing.version <> expected_version then
    raise exception 'This recipe has changed.' using errcode = '40001';
  end if;
  delete from public.recipes where recipes.id = recipe_id;
end;
$$;

create or replace function public.set_recipe_favorite(
  recipe_id uuid,
  favorite boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  household uuid := public.current_household_id();
begin
  if household is null then
    raise exception 'You must belong to a household.' using errcode = '42501';
  end if;
  update public.recipes set is_favorite = favorite
  where recipes.id = recipe_id and recipes.household_id = household;
  if not found then
    raise exception 'That recipe is no longer available.' using errcode = 'P0002';
  end if;
end;
$$;

-- Adds every ingredient the household is short of to the shared grocery list.
create or replace function public.add_recipe_to_groceries(
  recipe_id uuid,
  target_servings integer default null
)
returns table (added integer, skipped integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  household uuid := public.current_household_id();
  recipe public.recipes%rowtype;
  ingredient public.recipe_ingredients%rowtype;
  scale numeric;
  matched uuid;
  stocked public.inventory_items%rowtype;
  needed numeric;
  available numeric;
  added_count integer := 0;
  skipped_count integer := 0;
  grocery_result record;
begin
  if household is null then
    raise exception 'You must belong to a household.' using errcode = '42501';
  end if;
  select * into recipe from public.recipes
  where recipes.id = recipe_id and recipes.household_id = household;
  if not found then
    raise exception 'That recipe is no longer available.' using errcode = 'P0002';
  end if;
  if target_servings is not null and target_servings not between 1 and 100 then
    raise exception 'Servings must be between 1 and 100.' using errcode = '22023';
  end if;
  scale := coalesce(target_servings, recipe.servings)::numeric / greatest(recipe.servings, 1);

  for ingredient in
    select * from public.recipe_ingredients
    where recipe_ingredients.recipe_id = recipe.id
    order by position
  loop
    matched := public.match_inventory_item(household, ingredient.name, ingredient.inventory_item_id);
    needed := case when ingredient.quantity is null then null else ingredient.quantity * scale end;
    available := null;

    if matched is not null then
      select * into stocked from public.inventory_items where inventory_items.id = matched;
      if needed is null then
        -- Without a stated amount, anything on hand counts as covered.
        available := case when stocked.quantity > 0 then 1 else 0 end;
        if available = 1 then
          skipped_count := skipped_count + 1;
          continue;
        end if;
      else
        available := public.convert_inventory_quantity(stocked.quantity, stocked.unit, ingredient.unit);
        if available is null then
          -- Pieces cannot be weighed against grams, so anything on hand counts as covered.
          if stocked.quantity > 0 then
            skipped_count := skipped_count + 1;
            continue;
          end if;
        elsif available >= needed then
          skipped_count := skipped_count + 1;
          continue;
        end if;
      end if;
    end if;

    select * into grocery_result from public.create_grocery_item(
      matched,
      ingredient.name,
      case when needed is null then null else round(
        case
          when available is not null and needed > available
            then needed - available
          else needed
        end, 3) end,
      case when needed is null then null else ingredient.unit end,
      null::uuid,
      'For ' || recipe.name
    );
    if grocery_result.created then
      added_count := added_count + 1;
    else
      skipped_count := skipped_count + 1;
    end if;
  end loop;

  return query select added_count, skipped_count;
end;
$$;

-- Marks a recipe as cooked and optionally deducts what it used from inventory.
create or replace function public.log_recipe_cooked(
  recipe_id uuid,
  target_servings integer default null,
  consume boolean default true,
  entry_id uuid default null
)
returns table (deducted integer, unmatched integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  household uuid := public.current_household_id();
  recipe public.recipes%rowtype;
  ingredient public.recipe_ingredients%rowtype;
  scale numeric;
  matched uuid;
  stocked public.inventory_items%rowtype;
  needed numeric;
  deducted_count integer := 0;
  unmatched_count integer := 0;
begin
  if household is null then
    raise exception 'You must belong to a household.' using errcode = '42501';
  end if;
  select * into recipe from public.recipes
  where recipes.id = recipe_id and recipes.household_id = household;
  if not found then
    raise exception 'That recipe is no longer available.' using errcode = 'P0002';
  end if;
  if target_servings is not null and target_servings not between 1 and 100 then
    raise exception 'Servings must be between 1 and 100.' using errcode = '22023';
  end if;
  scale := coalesce(target_servings, recipe.servings)::numeric / greatest(recipe.servings, 1);

  if consume then
    for ingredient in
      select * from public.recipe_ingredients
      where recipe_ingredients.recipe_id = recipe.id
      order by position
    loop
      matched := public.match_inventory_item(household, ingredient.name, ingredient.inventory_item_id);
      if matched is null or ingredient.quantity is null then
        unmatched_count := unmatched_count + 1;
        continue;
      end if;
      select * into stocked from public.inventory_items
      where inventory_items.id = matched for update;
      needed := public.convert_inventory_quantity(
        ingredient.quantity * scale, ingredient.unit, stocked.unit
      );
      if needed is null then
        unmatched_count := unmatched_count + 1;
        continue;
      end if;
      update public.inventory_items
      set quantity = round(greatest(stocked.quantity - needed, 0), 3)
      where inventory_items.id = matched;
      deducted_count := deducted_count + 1;
    end loop;
  end if;

  update public.recipes set last_cooked_at = now() where recipes.id = recipe.id;
  if entry_id is not null then
    update public.meal_plan_entries set cooked_at = now()
    where meal_plan_entries.id = entry_id and meal_plan_entries.household_id = household;
  end if;

  return query select deducted_count, unmatched_count;
end;
$$;

create or replace function public.save_meal_plan_entry(
  entry_id uuid,
  expected_version integer,
  planned_on date,
  slot public.meal_slot,
  recipe_id uuid default null,
  entry_title text default null,
  entry_servings integer default null,
  entry_notes text default null
)
returns table (id uuid, version integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  household uuid := public.current_household_id();
  caller uuid := auth.uid();
  saved public.meal_plan_entries%rowtype;
  clean_title text := nullif(trim(entry_title), '');
begin
  if household is null or caller is null then
    raise exception 'You must belong to a household.' using errcode = '42501';
  end if;
  if recipe_id is null and clean_title is null then
    raise exception 'Choose a recipe or enter a title.' using errcode = '22023';
  end if;
  if recipe_id is not null and not exists (
    select 1 from public.recipes
    where recipes.id = recipe_id and recipes.household_id = household
  ) then
    raise exception 'That recipe is not available.' using errcode = '42501';
  end if;

  if expected_version is null then
    insert into public.meal_plan_entries (
      id, household_id, planned_on, slot, recipe_id, title, servings, notes, created_by
    ) values (
      coalesce(save_meal_plan_entry.entry_id, gen_random_uuid()), household,
      save_meal_plan_entry.planned_on, save_meal_plan_entry.slot,
      save_meal_plan_entry.recipe_id, clean_title, save_meal_plan_entry.entry_servings,
      nullif(trim(save_meal_plan_entry.entry_notes), ''), caller
    ) returning * into saved;
  else
    select * into saved from public.meal_plan_entries
    where meal_plan_entries.id = entry_id and meal_plan_entries.household_id = household
    for update;
    if not found then
      raise exception 'That meal is no longer planned.' using errcode = 'P0002';
    end if;
    if saved.version <> expected_version then
      raise exception 'This meal has changed.' using errcode = '40001';
    end if;
    update public.meal_plan_entries set
      planned_on = save_meal_plan_entry.planned_on,
      slot = save_meal_plan_entry.slot,
      recipe_id = save_meal_plan_entry.recipe_id,
      title = clean_title,
      servings = entry_servings,
      notes = nullif(trim(entry_notes), '')
    where meal_plan_entries.id = saved.id
    returning * into saved;
  end if;

  return query select saved.id, saved.version;
end;
$$;

create or replace function public.delete_meal_plan_entry(
  entry_id uuid,
  expected_version integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  household uuid := public.current_household_id();
  existing public.meal_plan_entries%rowtype;
begin
  if household is null then
    raise exception 'You must belong to a household.' using errcode = '42501';
  end if;
  select * into existing from public.meal_plan_entries
  where meal_plan_entries.id = entry_id and meal_plan_entries.household_id = household
  for update;
  if not found then
    raise exception 'That meal is no longer planned.' using errcode = 'P0002';
  end if;
  if existing.version <> expected_version then
    raise exception 'This meal has changed.' using errcode = '40001';
  end if;
  delete from public.meal_plan_entries where meal_plan_entries.id = entry_id;
end;
$$;

-- Adds every missing ingredient for a date range of planned meals in one pass.
create or replace function public.add_meal_plan_to_groceries(
  from_date date,
  to_date date
)
returns table (added integer, skipped integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  household uuid := public.current_household_id();
  entry public.meal_plan_entries%rowtype;
  outcome record;
  added_total integer := 0;
  skipped_total integer := 0;
begin
  if household is null then
    raise exception 'You must belong to a household.' using errcode = '42501';
  end if;
  if from_date is null or to_date is null or to_date < from_date then
    raise exception 'Enter a valid date range.' using errcode = '22023';
  end if;
  if to_date - from_date > 60 then
    raise exception 'Plan ranges are limited to 60 days.' using errcode = '22023';
  end if;

  for entry in
    select * from public.meal_plan_entries
    where meal_plan_entries.household_id = household
      and meal_plan_entries.planned_on between from_date and to_date
      and meal_plan_entries.recipe_id is not null
      and meal_plan_entries.cooked_at is null
    order by planned_on, slot
  loop
    select * into outcome
    from public.add_recipe_to_groceries(entry.recipe_id, entry.servings);
    added_total := added_total + outcome.added;
    skipped_total := skipped_total + outcome.skipped;
  end loop;

  return query select added_total, skipped_total;
end;
$$;

alter table public.recipes enable row level security;
alter table public.recipe_ingredients enable row level security;
alter table public.meal_plan_entries enable row level security;

create policy "Members view household recipes"
  on public.recipes for select to authenticated
  using (household_id = public.current_household_id());
create policy "Members view household recipe ingredients"
  on public.recipe_ingredients for select to authenticated
  using (household_id = public.current_household_id());
create policy "Members view household meal plan"
  on public.meal_plan_entries for select to authenticated
  using (household_id = public.current_household_id());

revoke all on public.recipes from public, anon, authenticated;
revoke all on public.recipe_ingredients from public, anon, authenticated;
revoke all on public.meal_plan_entries from public, anon, authenticated;
grant select on public.recipes to authenticated;
grant select on public.recipe_ingredients to authenticated;
grant select on public.meal_plan_entries to authenticated;

revoke all on function public.match_inventory_item(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.save_recipe(uuid, integer, jsonb, jsonb) from public, anon;
revoke all on function public.delete_recipe(uuid, integer) from public, anon;
revoke all on function public.set_recipe_favorite(uuid, boolean) from public, anon;
revoke all on function public.add_recipe_to_groceries(uuid, integer) from public, anon;
revoke all on function public.log_recipe_cooked(uuid, integer, boolean, uuid) from public, anon;
revoke all on function public.save_meal_plan_entry(uuid, integer, date, public.meal_slot, uuid, text, integer, text) from public, anon;
revoke all on function public.delete_meal_plan_entry(uuid, integer) from public, anon;
revoke all on function public.add_meal_plan_to_groceries(date, date) from public, anon;

grant execute on function public.save_recipe(uuid, integer, jsonb, jsonb) to authenticated;
grant execute on function public.delete_recipe(uuid, integer) to authenticated;
grant execute on function public.set_recipe_favorite(uuid, boolean) to authenticated;
grant execute on function public.add_recipe_to_groceries(uuid, integer) to authenticated;
grant execute on function public.log_recipe_cooked(uuid, integer, boolean, uuid) to authenticated;
grant execute on function public.save_meal_plan_entry(uuid, integer, date, public.meal_slot, uuid, text, integer, text) to authenticated;
grant execute on function public.delete_meal_plan_entry(uuid, integer) to authenticated;
grant execute on function public.add_meal_plan_to_groceries(date, date) to authenticated;

alter table public.recipes replica identity full;
alter table public.recipe_ingredients replica identity full;
alter table public.meal_plan_entries replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.recipes,
      public.recipe_ingredients,
      public.meal_plan_entries;
  end if;
end;
$$;
