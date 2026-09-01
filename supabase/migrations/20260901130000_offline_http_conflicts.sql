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
begin
  return public.apply_kitchen_command(operation_id, command_type, request);
exception
  when serialization_failure then
    raise exception '%', sqlerrm using errcode = 'PT409';
end;
$$;

revoke all on function public.apply_kitchen_command_v2(uuid, text, jsonb) from public, anon;
grant execute on function public.apply_kitchen_command_v2(uuid, text, jsonb) to authenticated;
