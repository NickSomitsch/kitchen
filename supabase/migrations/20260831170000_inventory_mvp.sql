create extension if not exists pgcrypto with schema extensions;

create type public.inventory_unit as enum ('g', 'kg', 'ml', 'l', 'piece', 'package');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 80),
  join_code text not null unique check (join_code ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id),
  unique (user_id)
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, id)
);

create unique index categories_household_name_key
  on public.categories (household_id, lower(trim(name)));

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, id)
);

create unique index locations_household_name_key
  on public.locations (household_id, lower(trim(name)));

create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  quantity numeric(12, 3) not null check (quantity >= 0),
  unit public.inventory_unit not null,
  category_id uuid,
  location_id uuid,
  notes text check (notes is null or char_length(notes) <= 500),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  foreign key (household_id, category_id)
    references public.categories(household_id, id) on delete set null (category_id),
  foreign key (household_id, location_id)
    references public.locations(household_id, id) on delete set null (location_id)
);

create index inventory_items_household_name_idx
  on public.inventory_items (household_id, lower(name));
create index inventory_items_household_updated_idx
  on public.inventory_items (household_id, updated_at desc);
create index inventory_items_category_idx on public.inventory_items (category_id);
create index inventory_items_location_idx on public.inventory_items (location_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.set_inventory_update_metadata()
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

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger households_set_updated_at
  before update on public.households
  for each row execute function public.set_updated_at();
create trigger categories_set_updated_at
  before update on public.categories
  for each row execute function public.set_updated_at();
create trigger locations_set_updated_at
  before update on public.locations
  for each row execute function public.set_updated_at();
create trigger inventory_items_set_update_metadata
  before update on public.inventory_items
  for each row execute function public.set_inventory_update_metadata();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
      split_part(coalesce(new.email, 'Kitchen member'), '@', 1)
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

insert into public.profiles (id, display_name)
select
  id,
  coalesce(
    nullif(trim(raw_user_meta_data ->> 'display_name'), ''),
    split_part(coalesce(email, 'Kitchen member'), '@', 1)
  )
from auth.users
on conflict (id) do nothing;

create or replace function public.current_household_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select household_id
  from public.household_members
  where user_id = auth.uid()
  limit 1;
$$;

create or replace function public.shares_household(other_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select other_user_id = auth.uid()
    or exists (
      select 1
      from public.household_members mine
      join public.household_members theirs
        on theirs.household_id = mine.household_id
      where mine.user_id = auth.uid()
        and theirs.user_id = other_user_id
    );
$$;

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

create or replace function public.create_household(household_name text)
returns table (household_id uuid, join_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  new_household_id uuid;
  new_join_code text;
  clean_name text := trim(household_name);
begin
  if caller is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if char_length(clean_name) not between 1 and 80 then
    raise exception 'Household name must be between 1 and 80 characters.' using errcode = '22023';
  end if;
  if exists (select 1 from public.household_members where user_id = caller) then
    raise exception 'Your account already belongs to a household.' using errcode = '23505';
  end if;

  new_join_code := public.generate_join_code();
  insert into public.households (name, join_code, created_by)
  values (clean_name, new_join_code, caller)
  returning id into new_household_id;

  insert into public.household_members (household_id, user_id)
  values (new_household_id, caller);

  insert into public.categories (household_id, name)
  select new_household_id, name
  from unnest(array[
    'Produce', 'Dairy & Eggs', 'Meat & Fish', 'Bakery', 'Pantry',
    'Frozen', 'Beverages', 'Spices', 'Other'
  ]) as name;

  insert into public.locations (household_id, name)
  select new_household_id, name
  from unnest(array['Fridge', 'Freezer', 'Pantry', 'Counter', 'Other']) as name;

  return query select new_household_id, new_join_code;
end;
$$;

create or replace function public.join_household(code text)
returns table (household_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  normalized_code text := regexp_replace(upper(code), '[^A-Z0-9]', '', 'g');
  target_household_id uuid;
begin
  if caller is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if exists (select 1 from public.household_members where user_id = caller) then
    raise exception 'Your account already belongs to a household.' using errcode = '23505';
  end if;

  select id into target_household_id
  from public.households
  where join_code = normalized_code;

  if target_household_id is null then
    raise exception 'That join code is not valid.' using errcode = '22023';
  end if;

  insert into public.household_members (household_id, user_id)
  values (target_household_id, caller);
  return query select target_household_id;
end;
$$;

create or replace function public.rotate_household_join_code()
returns table (join_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  household uuid := public.current_household_id();
  new_code text;
begin
  if household is null then
    raise exception 'You do not belong to a household.' using errcode = '42501';
  end if;
  new_code := public.generate_join_code();
  update public.households set join_code = new_code where id = household;
  return query select new_code;
end;
$$;

create or replace function public.remove_household_member(member_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  household uuid := public.current_household_id();
begin
  if household is null then
    raise exception 'You do not belong to a household.' using errcode = '42501';
  end if;
  if member_user_id = auth.uid() then
    raise exception 'Use leave household to remove yourself.' using errcode = '22023';
  end if;
  delete from public.household_members
  where household_id = household and user_id = member_user_id;
  if not found then
    raise exception 'That user is not a member of your household.' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.leave_household()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  household uuid := public.current_household_id();
  member_count integer;
begin
  if household is null then
    raise exception 'You do not belong to a household.' using errcode = '42501';
  end if;
  select count(*) into member_count
  from public.household_members where household_id = household;
  if member_count <= 1 then
    raise exception 'The last member must delete the household instead.' using errcode = '22023';
  end if;
  delete from public.household_members
  where household_id = household and user_id = auth.uid();
end;
$$;

create or replace function public.delete_household(confirmation_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  household uuid := public.current_household_id();
  household_name text;
begin
  if household is null then
    raise exception 'You do not belong to a household.' using errcode = '42501';
  end if;
  select name into household_name from public.households where id = household;
  if trim(confirmation_name) <> household_name then
    raise exception 'The confirmation name does not match.' using errcode = '22023';
  end if;
  delete from public.households where id = household;
end;
$$;

alter table public.profiles enable row level security;
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.categories enable row level security;
alter table public.locations enable row level security;
alter table public.inventory_items enable row level security;

create policy "Profiles are visible to household members"
  on public.profiles for select to authenticated
  using (public.shares_household(id));
create policy "Users update their own profile"
  on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy "Members view their household"
  on public.households for select to authenticated
  using (id = public.current_household_id());
create policy "Members update their household"
  on public.households for update to authenticated
  using (id = public.current_household_id())
  with check (id = public.current_household_id());

create policy "Members view household membership"
  on public.household_members for select to authenticated
  using (household_id = public.current_household_id());

create policy "Members manage household categories"
  on public.categories for all to authenticated
  using (household_id = public.current_household_id())
  with check (household_id = public.current_household_id());
create policy "Members manage household locations"
  on public.locations for all to authenticated
  using (household_id = public.current_household_id())
  with check (household_id = public.current_household_id());
create policy "Members view household inventory"
  on public.inventory_items for select to authenticated
  using (household_id = public.current_household_id());
create policy "Members add household inventory"
  on public.inventory_items for insert to authenticated
  with check (
    household_id = public.current_household_id()
    and created_by = auth.uid()
  );
create policy "Members update household inventory"
  on public.inventory_items for update to authenticated
  using (household_id = public.current_household_id())
  with check (household_id = public.current_household_id());
create policy "Members delete household inventory"
  on public.inventory_items for delete to authenticated
  using (household_id = public.current_household_id());

revoke all on all tables in schema public from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;
grant select on public.households to authenticated;
grant update (name) on public.households to authenticated;
grant select on public.household_members to authenticated;
grant select, insert, update, delete on public.categories to authenticated;
grant select, insert, update, delete on public.locations to authenticated;
grant select, insert, update, delete on public.inventory_items to authenticated;

revoke all on function public.current_household_id() from public, anon;
revoke all on function public.shares_household(uuid) from public, anon;
revoke all on function public.generate_join_code() from public, anon, authenticated;
revoke all on function public.create_household(text) from public, anon;
revoke all on function public.join_household(text) from public, anon;
revoke all on function public.rotate_household_join_code() from public, anon;
revoke all on function public.remove_household_member(uuid) from public, anon;
revoke all on function public.leave_household() from public, anon;
revoke all on function public.delete_household(text) from public, anon;

grant execute on function public.current_household_id() to authenticated;
grant execute on function public.shares_household(uuid) to authenticated;
grant execute on function public.create_household(text) to authenticated;
grant execute on function public.join_household(text) to authenticated;
grant execute on function public.rotate_household_join_code() to authenticated;
grant execute on function public.remove_household_member(uuid) to authenticated;
grant execute on function public.leave_household() to authenticated;
grant execute on function public.delete_household(text) to authenticated;

alter table public.households replica identity full;
alter table public.household_members replica identity full;
alter table public.categories replica identity full;
alter table public.locations replica identity full;
alter table public.inventory_items replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.households,
      public.household_members,
      public.categories,
      public.locations,
      public.inventory_items;
  end if;
end;
$$;
