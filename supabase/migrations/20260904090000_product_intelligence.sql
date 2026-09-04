-- Product intelligence: barcodes, nutrition, expiry dates, a household product cache,
-- and shared dietary preferences. Every change is additive so already-open clients keep working.

alter table public.inventory_items
  add column barcode text
    check (barcode is null or barcode ~ '^[0-9]{6,14}$'),
  add column brand text
    check (brand is null or char_length(trim(brand)) between 1 and 120),
  add column image_url text
    check (image_url is null or char_length(image_url) between 1 and 500),
  add column nutrition jsonb
    check (nutrition is null or jsonb_typeof(nutrition) = 'object'),
  add column expires_on date
    check (expires_on is null or expires_on between date '1900-01-01' and date '2200-01-01');

-- Recipe ingredients and meal plans reference inventory items within one household.
alter table public.inventory_items add constraint inventory_items_household_id_key
  unique (household_id, id);

create index inventory_items_household_expiry_idx
  on public.inventory_items (household_id, expires_on)
  where expires_on is not null;
create index inventory_items_household_barcode_idx
  on public.inventory_items (household_id, barcode)
  where barcode is not null;

-- Products a household has scanned before, so a repeat scan resolves instantly and offline.
create table public.scanned_products (
  household_id uuid not null references public.households(id) on delete cascade,
  barcode text not null check (barcode ~ '^[0-9]{6,14}$'),
  name text not null check (char_length(trim(name)) between 1 and 200),
  brand text check (brand is null or char_length(trim(brand)) between 1 and 120),
  image_url text check (image_url is null or char_length(image_url) between 1 and 500),
  package_quantity numeric(12, 3)
    check (package_quantity is null or (package_quantity > 0 and package_quantity <= 999999999.999)),
  package_unit public.inventory_unit,
  nutrition jsonb check (nutrition is null or jsonb_typeof(nutrition) = 'object'),
  ingredients_text text check (ingredients_text is null or char_length(ingredients_text) <= 4000),
  allergens text[] not null default '{}' check (cardinality(allergens) <= 40),
  source text not null default 'openfoodfacts'
    check (source in ('openfoodfacts', 'manual')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (household_id, barcode)
);

create trigger scanned_products_set_updated_at
  before update on public.scanned_products
  for each row execute function public.set_updated_at();

-- Shared dietary preferences used to rank and flag recipes.
alter table public.households
  add column diet_tags text[] not null default '{}'
    check (cardinality(diet_tags) <= 20),
  add column avoid_ingredients text[] not null default '{}'
    check (cardinality(avoid_ingredients) <= 60);

alter table public.scanned_products enable row level security;

create policy "Members manage household product cache"
  on public.scanned_products for all to authenticated
  using (household_id = public.current_household_id())
  with check (household_id = public.current_household_id());

revoke all on public.scanned_products from public, anon, authenticated;
grant select, insert, update, delete on public.scanned_products to authenticated;
grant update (name, diet_tags, avoid_ingredients) on public.households to authenticated;

alter table public.scanned_products replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.scanned_products;
  end if;
end;
$$;

-- Extend the offline command applier so queued inventory work can carry the new fields.
-- Keys that are absent from a request are preserved, which keeps older clients safe.
create or replace function public.apply_kitchen_command(
  operation_id uuid,
  command_type text,
  request jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  household uuid := public.current_household_id();
  caller uuid := auth.uid();
  receipt public.mutation_receipts%rowtype;
  result jsonb;
  inventory public.inventory_items%rowtype;
  grocery public.grocery_items%rowtype;
  target_inventory public.inventory_items%rowtype;
  requested_id uuid;
  target_id uuid;
  linked_id uuid;
  category_id uuid;
  location_id uuid;
  expected_version integer;
  clean_name text;
  amount numeric;
  threshold numeric;
  requested_unit public.inventory_unit;
  converted numeric;
  action text;
  created boolean := true;
begin
  if operation_id is null or command_type is null or request is null then
    raise exception 'Operation id, command type, and request are required.' using errcode = '22023';
  end if;
  if household is null or caller is null then
    raise exception 'You must belong to a household.' using errcode = '42501';
  end if;

  -- Serialize retries of the same command, including concurrent browser tabs.
  perform pg_advisory_xact_lock(hashtextextended(operation_id::text, 0));
  select * into receipt
  from public.mutation_receipts
  where user_id = caller and mutation_receipts.operation_id = apply_kitchen_command.operation_id;
  if found then
    if receipt.command_type <> apply_kitchen_command.command_type
       or receipt.request <> apply_kitchen_command.request then
      raise exception 'That operation id was already used for a different command.' using errcode = '22023';
    end if;
    return receipt.result;
  end if;

  if command_type = 'inventory.create' then
    requested_id := (request ->> 'id')::uuid;
    clean_name := trim(request ->> 'name');
    amount := (request ->> 'quantity')::numeric;
    requested_unit := (request ->> 'unit')::public.inventory_unit;
    category_id := nullif(request ->> 'category_id', '')::uuid;
    location_id := nullif(request ->> 'location_id', '')::uuid;
    threshold := nullif(request ->> 'low_stock_threshold', '')::numeric;

    insert into public.inventory_items (
      id, household_id, name, quantity, unit, category_id, location_id, notes,
      low_stock_threshold, barcode, brand, image_url, nutrition, expires_on, created_by
    ) values (
      requested_id, household, clean_name, amount, requested_unit, category_id, location_id,
      nullif(trim(request ->> 'notes'), ''), threshold,
      nullif(trim(request ->> 'barcode'), ''),
      nullif(trim(request ->> 'brand'), ''),
      nullif(trim(request ->> 'image_url'), ''),
      case when jsonb_typeof(request -> 'nutrition') = 'object' then request -> 'nutrition' end,
      nullif(request ->> 'expires_on', '')::date,
      caller
    ) returning * into inventory;
    result := jsonb_build_object('id', inventory.id, 'version', inventory.version);

  elsif command_type = 'inventory.update' then
    requested_id := (request ->> 'id')::uuid;
    expected_version := (request ->> 'expected_version')::integer;
    select * into inventory from public.inventory_items
    where id = requested_id and household_id = household for update;
    if not found then
      raise exception 'That inventory item is no longer available.' using errcode = 'P0002';
    end if;
    if inventory.version <> expected_version then
      raise exception 'This inventory item has changed.' using errcode = '40001';
    end if;

    update public.inventory_items set
      name = trim(request ->> 'name'),
      quantity = (request ->> 'quantity')::numeric,
      unit = (request ->> 'unit')::public.inventory_unit,
      category_id = nullif(request ->> 'category_id', '')::uuid,
      location_id = nullif(request ->> 'location_id', '')::uuid,
      notes = nullif(trim(request ->> 'notes'), ''),
      low_stock_threshold = nullif(request ->> 'low_stock_threshold', '')::numeric,
      barcode = case when request ? 'barcode'
        then nullif(trim(request ->> 'barcode'), '') else inventory_items.barcode end,
      brand = case when request ? 'brand'
        then nullif(trim(request ->> 'brand'), '') else inventory_items.brand end,
      image_url = case when request ? 'image_url'
        then nullif(trim(request ->> 'image_url'), '') else inventory_items.image_url end,
      nutrition = case when request ? 'nutrition'
        then case when jsonb_typeof(request -> 'nutrition') = 'object' then request -> 'nutrition' end
        else inventory_items.nutrition end,
      expires_on = case when request ? 'expires_on'
        then nullif(request ->> 'expires_on', '')::date else inventory_items.expires_on end
    where id = requested_id
    returning * into inventory;
    result := jsonb_build_object('id', inventory.id, 'version', inventory.version);

  elsif command_type = 'inventory.delete' then
    requested_id := (request ->> 'id')::uuid;
    expected_version := (request ->> 'expected_version')::integer;
    select * into inventory from public.inventory_items
    where id = requested_id and household_id = household for update;
    if not found then
      raise exception 'That inventory item is no longer available.' using errcode = 'P0002';
    end if;
    if inventory.version <> expected_version then
      raise exception 'This inventory item has changed.' using errcode = '40001';
    end if;
    delete from public.inventory_items where id = requested_id;
    result := jsonb_build_object('id', requested_id);

  elsif command_type = 'grocery.create' then
    requested_id := (request ->> 'id')::uuid;
    linked_id := nullif(request ->> 'inventory_item_id', '')::uuid;
    clean_name := trim(request ->> 'name');
    category_id := nullif(request ->> 'category_id', '')::uuid;
    amount := nullif(request ->> 'quantity', '')::numeric;
    if nullif(request ->> 'unit', '') is not null then
      requested_unit := (request ->> 'unit')::public.inventory_unit;
    else
      requested_unit := null;
    end if;

    if (amount is null) <> (requested_unit is null) then
      raise exception 'Quantity and unit must be provided together.' using errcode = '22023';
    end if;
    if linked_id is not null then
      select * into inventory from public.inventory_items
      where id = linked_id and household_id = household;
      if not found then
        raise exception 'That inventory item is not available.' using errcode = '42501';
      end if;
      select * into grocery from public.grocery_items
      where household_id = household and inventory_item_id = linked_id and status = 'active';
      if found then
        requested_id := grocery.id;
        created := false;
      else
        clean_name := inventory.name;
        category_id := inventory.category_id;
      end if;
    end if;
    if created then
      insert into public.grocery_items (
        id, household_id, inventory_item_id, name, quantity, unit, category_id, notes, created_by
      ) values (
        requested_id, household, linked_id, clean_name, amount, requested_unit, category_id,
        nullif(trim(request ->> 'notes'), ''), caller
      ) returning * into grocery;
    end if;
    result := jsonb_build_object('id', requested_id, 'created', created, 'version', grocery.version);

  elsif command_type = 'grocery.update' then
    requested_id := (request ->> 'id')::uuid;
    expected_version := (request ->> 'expected_version')::integer;
    perform public.update_grocery_item(
      requested_id,
      expected_version,
      nullif(request ->> 'inventory_item_id', '')::uuid,
      request ->> 'name',
      nullif(request ->> 'quantity', '')::numeric,
      nullif(request ->> 'unit', '')::public.inventory_unit,
      nullif(request ->> 'category_id', '')::uuid,
      request ->> 'notes'
    );
    select * into grocery from public.grocery_items where id = requested_id;
    result := jsonb_build_object('id', grocery.id, 'version', grocery.version);

  elsif command_type = 'grocery.delete' then
    requested_id := (request ->> 'id')::uuid;
    expected_version := (request ->> 'expected_version')::integer;
    perform public.delete_grocery_item(requested_id, expected_version);
    result := jsonb_build_object('id', requested_id);

  elsif command_type = 'grocery.complete' then
    requested_id := (request ->> 'id')::uuid;
    expected_version := (request ->> 'expected_version')::integer;
    action := request ->> 'stock_action';
    amount := nullif(request ->> 'quantity', '')::numeric;
    if nullif(request ->> 'unit', '') is not null then
      requested_unit := (request ->> 'unit')::public.inventory_unit;
    else
      requested_unit := null;
    end if;

    select * into grocery from public.grocery_items
    where id = requested_id and household_id = household for update;
    if not found then
      raise exception 'That grocery item is no longer available.' using errcode = 'P0002';
    end if;
    if grocery.status <> 'active' then
      raise exception 'That grocery item is already completed.' using errcode = '22023';
    end if;
    if grocery.version <> expected_version then
      raise exception 'This grocery item has changed.' using errcode = '40001';
    end if;
    if action not in ('none', 'existing', 'new') then
      raise exception 'Choose how this purchase should affect inventory.' using errcode = '22023';
    end if;

    if action = 'none' then
      update public.grocery_items set
        status = 'purchased', completed_by = caller, completed_at = now(), stocked = false
      where id = grocery.id returning * into grocery;
      target_id := null;
    else
      if amount is null or requested_unit is null or amount <= 0 or amount > 999999999.999 then
        raise exception 'Enter a purchased quantity greater than zero.' using errcode = '22023';
      end if;

      if action = 'existing' then
        target_id := coalesce(nullif(request ->> 'target_inventory_item_id', '')::uuid, grocery.inventory_item_id);
        select * into target_inventory from public.inventory_items
        where id = target_id and household_id = household for update;
        if not found then
          raise exception 'Choose an available inventory item.' using errcode = '22023';
        end if;
        converted := public.convert_inventory_quantity(amount, requested_unit, target_inventory.unit);
        if converted is null then
          raise exception 'The purchased unit is not compatible with the inventory unit.' using errcode = '22023';
        end if;
        update public.inventory_items set
          quantity = quantity + converted,
          expires_on = case when nullif(request ->> 'new_expires_on', '') is not null
            then (request ->> 'new_expires_on')::date else expires_on end
        where id = target_id returning * into target_inventory;
        update public.grocery_items set
          status = 'purchased', completed_by = caller, completed_at = now(), stocked = true,
          quantity = amount, unit = requested_unit, inventory_item_id = target_id,
          name = target_inventory.name, category_id = target_inventory.category_id
        where id = grocery.id returning * into grocery;
      else
        target_id := (request ->> 'new_inventory_item_id')::uuid;
        location_id := nullif(request ->> 'new_location_id', '')::uuid;
        insert into public.inventory_items (
          id, household_id, name, quantity, unit, category_id, location_id, notes,
          expires_on, created_by
        ) values (
          target_id, household, grocery.name, amount, requested_unit,
          grocery.category_id, location_id, grocery.notes,
          nullif(request ->> 'new_expires_on', '')::date, caller
        ) returning * into target_inventory;
        update public.grocery_items set
          status = 'purchased', completed_by = caller, completed_at = now(), stocked = true,
          quantity = amount, unit = requested_unit, inventory_item_id = target_id
        where id = grocery.id returning * into grocery;
      end if;
    end if;
    result := jsonb_build_object(
      'id', grocery.id,
      'version', grocery.version,
      'inventory_item_id', target_id,
      'inventory_version', case when target_id is null then null else target_inventory.version end
    );

  elsif command_type = 'grocery.repeat' then
    requested_id := (request ->> 'id')::uuid;
    target_id := (request ->> 'new_grocery_item_id')::uuid;
    select * into grocery from public.grocery_items
    where id = requested_id and household_id = household and status = 'purchased';
    if not found then
      raise exception 'That completed grocery item is not available.' using errcode = 'P0002';
    end if;
    if grocery.inventory_item_id is not null then
      select id into linked_id from public.grocery_items
      where household_id = household
        and inventory_item_id = grocery.inventory_item_id
        and status = 'active';
    end if;
    if linked_id is not null then
      target_id := linked_id;
      created := false;
    else
      insert into public.grocery_items (
        id, household_id, inventory_item_id, name, quantity, unit, category_id,
        notes, source, created_by
      ) values (
        target_id, household, grocery.inventory_item_id, grocery.name, grocery.quantity,
        grocery.unit, grocery.category_id, grocery.notes, 'manual', caller
      ) returning * into grocery;
    end if;
    result := jsonb_build_object('id', target_id, 'created', created, 'version', grocery.version);

  else
    raise exception 'Unsupported kitchen command.' using errcode = '22023';
  end if;

  insert into public.mutation_receipts (
    household_id, user_id, operation_id, command_type, request, result
  ) values (
    household, caller, apply_kitchen_command.operation_id,
    apply_kitchen_command.command_type, apply_kitchen_command.request, result
  );
  return result;
end;
$$;

revoke all on function public.apply_kitchen_command(uuid, text, jsonb) from public, anon;
grant execute on function public.apply_kitchen_command(uuid, text, jsonb) to authenticated;
