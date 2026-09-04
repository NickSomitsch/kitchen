-- A per-person daily allowance for image recognition. The scan-image Edge Function
-- claims a credit using the caller's own token, so the limit and household membership
-- are both enforced here rather than inside the function.

create table public.scan_usage (
  user_id uuid not null references public.profiles(id) on delete cascade,
  used_on date not null,
  household_id uuid not null references public.households(id) on delete cascade,
  scan_count integer not null default 0 check (scan_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, used_on)
);

create index scan_usage_household_day_idx on public.scan_usage (household_id, used_on);

create or replace function public.claim_scan_credit(daily_limit integer default 40)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  household uuid := public.current_household_id();
  caller uuid := auth.uid();
  today date := (now() at time zone 'utc')::date;
  used integer;
  cap integer := least(greatest(coalesce(daily_limit, 40), 1), 200);
begin
  if household is null or caller is null then
    raise exception 'You must belong to a household to scan.' using errcode = '42501';
  end if;

  insert into public.scan_usage as usage (user_id, used_on, household_id, scan_count)
  values (caller, today, household, 1)
  on conflict (user_id, used_on) do update
    set scan_count = usage.scan_count + 1,
        household_id = household,
        updated_at = now()
  returning usage.scan_count into used;

  -- Raising rolls the increment back, so the stored count settles at the cap
  -- and every further attempt today fails the same way.
  if used > cap then
    raise exception 'You have used all % scans for today.', cap using errcode = '53400';
  end if;

  return cap - used;
end;
$$;

create or replace function public.scans_used_today()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select usage.scan_count from public.scan_usage usage
      where usage.user_id = auth.uid()
        and usage.used_on = (now() at time zone 'utc')::date
    ),
    0
  );
$$;

alter table public.scan_usage enable row level security;

create policy "Members read their own scan usage"
  on public.scan_usage for select to authenticated
  using (user_id = auth.uid());

revoke all on public.scan_usage from public, anon, authenticated;
grant select on public.scan_usage to authenticated;

revoke all on function public.claim_scan_credit(integer) from public, anon;
revoke all on function public.scans_used_today() from public, anon;
grant execute on function public.claim_scan_credit(integer) to authenticated;
grant execute on function public.scans_used_today() to authenticated;
