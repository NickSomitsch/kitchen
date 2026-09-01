create or replace function public.apply_kitchen_command_v2(
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
  entity_id uuid;
  latest jsonb;
begin
  return public.apply_kitchen_command(operation_id, command_type, request);
exception
  when serialization_failure then
    entity_id := nullif(request ->> 'id', '')::uuid;
    if command_type like 'inventory.%' then
      select to_jsonb(item) into latest
      from public.inventory_items item
      where item.id = entity_id
        and item.household_id = public.current_household_id();
    elsif command_type like 'grocery.%' then
      select to_jsonb(item) into latest
      from public.grocery_items item
      where item.id = entity_id
        and item.household_id = public.current_household_id();
    end if;
    raise exception '%', sqlerrm
      using errcode = 'PT409', detail = coalesce(latest, 'null'::jsonb)::text;
end;
$$;

revoke all on function public.apply_kitchen_command_v2(uuid, text, jsonb) from public, anon;
grant execute on function public.apply_kitchen_command_v2(uuid, text, jsonb) to authenticated;
