create or replace function public.generate_join_code()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  random_bytes bytea;
  candidate text;
begin
  loop
    random_bytes := extensions.gen_random_bytes(10);
    candidate := '';
    for byte_index in 0..9 loop
      candidate := candidate || substr(
        alphabet,
        (get_byte(random_bytes, byte_index) % char_length(alphabet)) + 1,
        1
      );
    end loop;
    exit when not exists (
      select 1 from public.households where join_code = candidate
    );
  end loop;
  return candidate;
end;
$$;

revoke all on function public.generate_join_code() from public, anon, authenticated;
