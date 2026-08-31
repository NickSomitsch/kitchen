alter table public.inventory_items
  add column low_stock_threshold numeric(12, 3)
    check (low_stock_threshold is null or low_stock_threshold >= 0);

alter table public.inventory_items
  add constraint inventory_items_household_id_id_key unique (household_id, id);

create type public.grocery_item_source as enum ('manual', 'low_stock');
create type public.grocery_item_status as enum ('active', 'purchased');

create table public.grocery_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  inventory_item_id uuid,
  name text not null check (char_length(trim(name)) between 1 and 120),
  quantity numeric(12, 3) check (quantity is null or quantity > 0),
  unit public.inventory_unit,
  category_id uuid,
  notes text check (notes is null or char_length(notes) <= 500),
  source public.grocery_item_source not null default 'manual',
  status public.grocery_item_status not null default 'active',
  stocked boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  completed_by uuid references auth.users(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  check ((quantity is null and unit is null) or (quantity is not null and unit is not null)),
  check (source = 'manual' or inventory_item_id is not null),
  check (
    (status = 'active' and completed_at is null and completed_by is null and not stocked)
    or (status = 'purchased' and completed_at is not null and completed_by is not null)
  ),
  foreign key (household_id, inventory_item_id)
    references public.inventory_items(household_id, id) on delete set null (inventory_item_id),
  foreign key (household_id, category_id)
    references public.categories(household_id, id) on delete set null (category_id)
);

create unique index grocery_items_one_active_linked_item_key
  on public.grocery_items (household_id, inventory_item_id)
  where status = 'active' and inventory_item_id is not null;
create index grocery_items_household_status_idx
  on public.grocery_items (household_id, status, category_id);
create index grocery_items_household_completed_idx
  on public.grocery_items (household_id, completed_at desc)
  where status = 'purchased';

create or replace function public.set_grocery_update_metadata()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.id = old.id;
  new.household_id = old.household_id;
  new.source = old.source;
  new.created_by = old.created_by;
  new.created_at = old.created_at;
  new.version = old.version + 1;
  new.updated_at = now();
  return new;
end;
$$;

create trigger grocery_items_set_update_metadata
  before update on public.grocery_items
  for each row execute function public.set_grocery_update_metadata();

create or replace function public.convert_inventory_quantity(
  amount numeric,
  from_unit public.inventory_unit,
  to_unit public.inventory_unit
)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when from_unit = to_unit then amount
    when from_unit = 'g' and to_unit = 'kg' then amount / 1000
    when from_unit = 'kg' and to_unit = 'g' then amount * 1000
    when from_unit = 'ml' and to_unit = 'l' then amount / 1000
    when from_unit = 'l' and to_unit = 'ml' then amount * 1000
    else null
  end;
$$;

create or replace function public.reconcile_low_stock(target_inventory_item_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  item public.inventory_items%rowtype;
begin
  select * into item
  from public.inventory_items
  where id = target_inventory_item_id;

  if not found then
    return;
  end if;

  update public.grocery_items
  set name = item.name,
      category_id = item.category_id
  where household_id = item.household_id
    and inventory_item_id = item.id
    and status = 'active'
    and (name is distinct from item.name or category_id is distinct from item.category_id);

  if item.low_stock_threshold is not null and item.quantity <= item.low_stock_threshold then
    if not exists (
      select 1 from public.grocery_items
      where household_id = item.household_id
        and inventory_item_id = item.id
        and status = 'active'
    ) then
      insert into public.grocery_items (
        household_id,
        inventory_item_id,
        name,
        category_id,
        source,
        created_by
      ) values (
        item.household_id,
        item.id,
        item.name,
        item.category_id,
        'low_stock',
        coalesce(auth.uid(), item.created_by)
      );
    end if;
  else
    delete from public.grocery_items
    where household_id = item.household_id
      and inventory_item_id = item.id
      and source = 'low_stock'
      and status = 'active';
  end if;
end;
$$;

create or replace function public.inventory_reconcile_grocery()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.reconcile_low_stock(new.id);
  return new;
end;
$$;

create trigger inventory_items_reconcile_grocery
  after insert or update of name, quantity, unit, category_id, low_stock_threshold
  on public.inventory_items
  for each row execute function public.inventory_reconcile_grocery();

create or replace function public.inventory_remove_active_low_stock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.grocery_items
  where inventory_item_id = old.id
    and source = 'low_stock'
    and status = 'active';
  return old;
end;
$$;

create trigger inventory_items_remove_active_low_stock
  before delete on public.inventory_items
  for each row execute function public.inventory_remove_active_low_stock();

create or replace function public.grocery_reconcile_inventory()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if pg_trigger_depth() > 1 then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.inventory_item_id is not null then
      perform public.reconcile_low_stock(old.inventory_item_id);
    end if;
    return old;
  end if;

  if old.inventory_item_id is not null then
    perform public.reconcile_low_stock(old.inventory_item_id);
  end if;
  if new.inventory_item_id is not null
     and new.inventory_item_id is distinct from old.inventory_item_id then
    perform public.reconcile_low_stock(new.inventory_item_id);
  end if;
  return new;
end;
$$;

create trigger grocery_items_reconcile_inventory_after_delete
  after delete on public.grocery_items
  for each row execute function public.grocery_reconcile_inventory();
create trigger grocery_items_reconcile_inventory_after_update
  after update of status, inventory_item_id on public.grocery_items
  for each row execute function public.grocery_reconcile_inventory();

create or replace function public.create_grocery_item(
  linked_inventory_item_id uuid default null,
  item_name text default null,
  item_quantity numeric default null,
  item_unit public.inventory_unit default null,
  item_category_id uuid default null,
  item_notes text default null
)
returns table (grocery_item_id uuid, created boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  household uuid := public.current_household_id();
  caller uuid := auth.uid();
  clean_name text := trim(item_name);
  inventory_name text;
  inventory_category_id uuid;
  new_id uuid;
begin
  if household is null or caller is null then
    raise exception 'You must belong to a household.' using errcode = '42501';
  end if;
  if (item_quantity is null) <> (item_unit is null) then
    raise exception 'Quantity and unit must be provided together.' using errcode = '22023';
  end if;
  if item_quantity is not null and (item_quantity <= 0 or item_quantity > 999999999.999) then
    raise exception 'Grocery quantity must be greater than zero.' using errcode = '22023';
  end if;
  if item_notes is not null and char_length(item_notes) > 500 then
    raise exception 'Notes must be 500 characters or fewer.' using errcode = '22023';
  end if;

  if linked_inventory_item_id is not null then
    select name, category_id into inventory_name, inventory_category_id
    from public.inventory_items
    where id = linked_inventory_item_id and household_id = household;
    if not found then
      raise exception 'That inventory item is not available.' using errcode = '42501';
    end if;
    select id into new_id from public.grocery_items
    where household_id = household
      and inventory_item_id = linked_inventory_item_id
      and status = 'active';
    if found then
      return query select new_id, false;
      return;
    end if;
    clean_name := inventory_name;
    item_category_id := inventory_category_id;
  elsif clean_name is null or char_length(clean_name) not between 1 and 120 then
    raise exception 'Name must be between 1 and 120 characters.' using errcode = '22023';
  end if;

  if item_category_id is not null and not exists (
    select 1 from public.categories where id = item_category_id and household_id = household
  ) then
    raise exception 'That category is not available.' using errcode = '42501';
  end if;

  begin
    insert into public.grocery_items (
      household_id, inventory_item_id, name, quantity, unit, category_id, notes, created_by
    ) values (
      household, linked_inventory_item_id, clean_name, item_quantity, item_unit,
      item_category_id, nullif(trim(item_notes), ''), caller
    ) returning id into new_id;
  exception when unique_violation then
    select id into new_id from public.grocery_items
    where household_id = household
      and inventory_item_id = linked_inventory_item_id
      and status = 'active';
    if new_id is null then raise; end if;
    return query select new_id, false;
    return;
  end;

  return query select new_id, true;
end;
$$;

create or replace function public.update_grocery_item(
  grocery_id uuid,
  expected_version integer,
  linked_inventory_item_id uuid default null,
  item_name text default null,
  item_quantity numeric default null,
  item_unit public.inventory_unit default null,
  item_category_id uuid default null,
  item_notes text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  household uuid := public.current_household_id();
  existing public.grocery_items%rowtype;
  clean_name text := trim(item_name);
begin
  select * into existing from public.grocery_items
  where id = grocery_id and household_id = household for update;
  if not found then
    raise exception 'That grocery item is not available.' using errcode = '42501';
  end if;
  if existing.status <> 'active' then
    raise exception 'Only active grocery items can be edited.' using errcode = '22023';
  end if;
  if existing.version <> expected_version then
    raise exception 'This grocery item has changed.' using errcode = '40001';
  end if;
  if existing.source = 'low_stock'
     and linked_inventory_item_id is distinct from existing.inventory_item_id then
    raise exception 'Automatic entries cannot be relinked.' using errcode = '22023';
  end if;
  if (item_quantity is null) <> (item_unit is null) then
    raise exception 'Quantity and unit must be provided together.' using errcode = '22023';
  end if;
  if item_quantity is not null and (item_quantity <= 0 or item_quantity > 999999999.999) then
    raise exception 'Grocery quantity must be greater than zero.' using errcode = '22023';
  end if;
  if item_notes is not null and char_length(item_notes) > 500 then
    raise exception 'Notes must be 500 characters or fewer.' using errcode = '22023';
  end if;

  if linked_inventory_item_id is not null then
    select name, category_id into clean_name, item_category_id
    from public.inventory_items
    where id = linked_inventory_item_id and household_id = household;
    if not found then
      raise exception 'That inventory item is not available.' using errcode = '42501';
    end if;
  elsif clean_name is null or char_length(clean_name) not between 1 and 120 then
    raise exception 'Name must be between 1 and 120 characters.' using errcode = '22023';
  end if;

  if item_category_id is not null and not exists (
    select 1 from public.categories where id = item_category_id and household_id = household
  ) then
    raise exception 'That category is not available.' using errcode = '42501';
  end if;

  update public.grocery_items
  set inventory_item_id = linked_inventory_item_id,
      name = clean_name,
      quantity = item_quantity,
      unit = item_unit,
      category_id = item_category_id,
      notes = nullif(trim(item_notes), '')
  where id = grocery_id;
exception when unique_violation then
  raise exception 'That inventory item is already on the grocery list.' using errcode = '23505';
end;
$$;

create or replace function public.delete_grocery_item(
  grocery_id uuid,
  expected_version integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  household uuid := public.current_household_id();
  existing public.grocery_items%rowtype;
begin
  select * into existing from public.grocery_items
  where id = grocery_id and household_id = household for update;
  if not found then
    raise exception 'That grocery item is not available.' using errcode = '42501';
  end if;
  if existing.version <> expected_version then
    raise exception 'This grocery item has changed.' using errcode = '40001';
  end if;
  if existing.source = 'low_stock' and existing.status = 'active' then
    raise exception 'Disable the low-stock rule to remove this automatic entry.' using errcode = '22023';
  end if;
  delete from public.grocery_items where id = grocery_id;
end;
$$;

create or replace function public.complete_grocery_item(
  grocery_id uuid,
  expected_version integer,
  stock_action text,
  purchased_quantity numeric default null,
  purchased_unit public.inventory_unit default null,
  target_inventory_item_id uuid default null,
  new_location_id uuid default null
)
returns table (completed_grocery_item_id uuid, stocked_inventory_item_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  household uuid := public.current_household_id();
  caller uuid := auth.uid();
  grocery public.grocery_items%rowtype;
  inventory public.inventory_items%rowtype;
  target_id uuid;
  converted numeric;
begin
  select * into grocery from public.grocery_items
  where id = grocery_id and household_id = household for update;
  if not found then
    raise exception 'That grocery item is not available.' using errcode = '42501';
  end if;
  if grocery.status <> 'active' then
    raise exception 'That grocery item is already completed.' using errcode = '22023';
  end if;
  if grocery.version <> expected_version then
    raise exception 'This grocery item has changed.' using errcode = '40001';
  end if;
  if stock_action not in ('none', 'existing', 'new') then
    raise exception 'Choose how this purchase should affect inventory.' using errcode = '22023';
  end if;

  if stock_action = 'none' then
    update public.grocery_items
    set status = 'purchased', completed_by = caller, completed_at = now(), stocked = false
    where id = grocery.id;
    return query select grocery.id, null::uuid;
    return;
  end if;

  if purchased_quantity is null or purchased_unit is null or purchased_quantity <= 0
     or purchased_quantity > 999999999.999 then
    raise exception 'Enter a purchased quantity greater than zero.' using errcode = '22023';
  end if;

  if stock_action = 'existing' then
    target_id := coalesce(target_inventory_item_id, grocery.inventory_item_id);
    select * into inventory from public.inventory_items
    where id = target_id and household_id = household for update;
    if not found then
      raise exception 'Choose an available inventory item.' using errcode = '22023';
    end if;
    converted := public.convert_inventory_quantity(purchased_quantity, purchased_unit, inventory.unit);
    if converted is null then
      raise exception 'The purchased unit is not compatible with the inventory unit.' using errcode = '22023';
    end if;
    if inventory.quantity + converted > 999999999.999 then
      raise exception 'The resulting inventory quantity is too large.' using errcode = '22023';
    end if;

    update public.grocery_items
    set status = 'purchased', completed_by = caller, completed_at = now(), stocked = true,
        quantity = purchased_quantity, unit = purchased_unit,
        inventory_item_id = inventory.id, name = inventory.name, category_id = inventory.category_id
    where id = grocery.id;
    update public.inventory_items set quantity = quantity + converted where id = inventory.id;
    return query select grocery.id, inventory.id;
    return;
  end if;

  if new_location_id is not null and not exists (
    select 1 from public.locations where id = new_location_id and household_id = household
  ) then
    raise exception 'That location is not available.' using errcode = '42501';
  end if;

  insert into public.inventory_items (
    household_id, name, quantity, unit, category_id, location_id, notes, created_by
  ) values (
    household, grocery.name, purchased_quantity, purchased_unit,
    grocery.category_id, new_location_id, grocery.notes, caller
  ) returning id into target_id;

  update public.grocery_items
  set status = 'purchased', completed_by = caller, completed_at = now(), stocked = true,
      quantity = purchased_quantity, unit = purchased_unit, inventory_item_id = target_id
  where id = grocery.id;
  return query select grocery.id, target_id;
end;
$$;

create or replace function public.repeat_grocery_item(grocery_id uuid)
returns table (grocery_item_id uuid, created boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  household uuid := public.current_household_id();
  caller uuid := auth.uid();
  grocery public.grocery_items%rowtype;
  new_id uuid;
begin
  select * into grocery from public.grocery_items
  where id = grocery_id and household_id = household and status = 'purchased';
  if not found then
    raise exception 'That completed grocery item is not available.' using errcode = '42501';
  end if;

  if grocery.inventory_item_id is not null then
    select id into new_id from public.grocery_items
    where household_id = household
      and inventory_item_id = grocery.inventory_item_id
      and status = 'active';
    if found then
      return query select new_id, false;
      return;
    end if;
  end if;

  insert into public.grocery_items (
    household_id, inventory_item_id, name, quantity, unit, category_id, notes, source, created_by
  ) values (
    household, grocery.inventory_item_id, grocery.name, grocery.quantity, grocery.unit,
    grocery.category_id, grocery.notes, 'manual', caller
  ) returning id into new_id;
  return query select new_id, true;
end;
$$;

create or replace function public.clear_grocery_history()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  household uuid := public.current_household_id();
  removed integer;
begin
  if household is null then
    raise exception 'You must belong to a household.' using errcode = '42501';
  end if;
  delete from public.grocery_items where household_id = household and status = 'purchased';
  get diagnostics removed = row_count;
  return removed;
end;
$$;

alter table public.grocery_items enable row level security;

create policy "Members view household groceries"
  on public.grocery_items for select to authenticated
  using (household_id = public.current_household_id());

revoke all on public.grocery_items from anon, authenticated;
grant select on public.grocery_items to authenticated;

revoke all on function public.convert_inventory_quantity(numeric, public.inventory_unit, public.inventory_unit) from public, anon, authenticated;
revoke all on function public.reconcile_low_stock(uuid) from public, anon, authenticated;
revoke all on function public.create_grocery_item(uuid, text, numeric, public.inventory_unit, uuid, text) from public, anon;
revoke all on function public.update_grocery_item(uuid, integer, uuid, text, numeric, public.inventory_unit, uuid, text) from public, anon;
revoke all on function public.delete_grocery_item(uuid, integer) from public, anon;
revoke all on function public.complete_grocery_item(uuid, integer, text, numeric, public.inventory_unit, uuid, uuid) from public, anon;
revoke all on function public.repeat_grocery_item(uuid) from public, anon;
revoke all on function public.clear_grocery_history() from public, anon;

grant execute on function public.create_grocery_item(uuid, text, numeric, public.inventory_unit, uuid, text) to authenticated;
grant execute on function public.update_grocery_item(uuid, integer, uuid, text, numeric, public.inventory_unit, uuid, text) to authenticated;
grant execute on function public.delete_grocery_item(uuid, integer) to authenticated;
grant execute on function public.complete_grocery_item(uuid, integer, text, numeric, public.inventory_unit, uuid, uuid) to authenticated;
grant execute on function public.repeat_grocery_item(uuid) to authenticated;
grant execute on function public.clear_grocery_history() to authenticated;

alter table public.grocery_items replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'grocery_items'
     ) then
    alter publication supabase_realtime add table public.grocery_items;
  end if;
end;
$$;
