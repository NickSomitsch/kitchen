create table public.mutation_receipts (
  household_id uuid not null,
  user_id uuid not null,
  operation_id uuid not null,
  command_type text not null,
  request jsonb not null,
  result jsonb not null,
  completed_at timestamptz not null default now(),
  primary key (user_id, operation_id),
  foreign key (household_id, user_id)
    references public.household_members(household_id, user_id) on delete cascade
);

create index mutation_receipts_household_completed_idx
  on public.mutation_receipts (household_id, completed_at desc);

alter table public.mutation_receipts enable row level security;
revoke all on public.mutation_receipts from public, anon, authenticated;

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
      low_stock_threshold, created_by
    ) values (
      requested_id, household, clean_name, amount, requested_unit, category_id, location_id,
      nullif(trim(request ->> 'notes'), ''), threshold, caller
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
      low_stock_threshold = nullif(request ->> 'low_stock_threshold', '')::numeric
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
        update public.inventory_items set quantity = quantity + converted
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
          id, household_id, name, quantity, unit, category_id, location_id, notes, created_by
        ) values (
          target_id, household, grocery.name, amount, requested_unit,
          grocery.category_id, location_id, grocery.notes, caller
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
