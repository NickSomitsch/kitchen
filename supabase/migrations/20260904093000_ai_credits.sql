-- Recipe suggestions are a second AI-backed feature, so the daily allowance grows a
-- feature dimension. claim_scan_credit keeps its old signature and behaviour, which
-- means an already-deployed scan-image function keeps working through this change.

alter table public.scan_usage
  add column feature text not null default 'scan'
    check (feature in ('scan', 'suggest'));

alter table public.scan_usage drop constraint scan_usage_pkey;
alter table public.scan_usage add primary key (user_id, used_on, feature);

-- Dropped first so the migration stays re-runnable: PostgreSQL refuses to rename
-- an input parameter through CREATE OR REPLACE.
drop function if exists public.claim_ai_credit(text, integer);

create function public.claim_ai_credit(
  ai_feature text,
  daily_limit integer default 40
)
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
  clean_feature text := coalesce(nullif(trim(ai_feature), ''), 'scan');
begin
  if household is null or caller is null then
    raise exception 'You must belong to a household.' using errcode = '42501';
  end if;
  if clean_feature not in ('scan', 'suggest') then
    raise exception 'Unknown AI feature.' using errcode = '22023';
  end if;

  insert into public.scan_usage as usage (user_id, used_on, feature, household_id, scan_count)
  values (caller, today, clean_feature, household, 1)
  on conflict (user_id, used_on, feature) do update
    set scan_count = usage.scan_count + 1,
        household_id = household,
        updated_at = now()
  returning usage.scan_count into used;

  -- Raising rolls the increment back, so the stored count settles at the cap
  -- and every further attempt today fails the same way.
  if used > cap then
    raise exception 'You have used all % of today''s allowance for this feature.', cap
      using errcode = '53400';
  end if;

  return cap - used;
end;
$$;

create or replace function public.claim_scan_credit(daily_limit integer default 40)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.claim_ai_credit('scan', daily_limit);
exception
  when sqlstate '53400' then
    raise exception 'You have used all % scans for today.', least(greatest(coalesce(daily_limit, 40), 1), 200)
      using errcode = '53400';
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
        and usage.feature = 'scan'
    ),
    0
  );
$$;

revoke all on function public.claim_ai_credit(text, integer) from public, anon;
grant execute on function public.claim_ai_credit(text, integer) to authenticated;
