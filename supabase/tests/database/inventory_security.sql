begin;
select plan(14);

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
values
  ('00000000-0000-4000-8000-000000000001', 'alex@example.test', now(), '{"display_name":"Alex"}'),
  ('00000000-0000-4000-8000-000000000002', 'sam@example.test', now(), '{"display_name":"Sam"}'),
  ('00000000-0000-4000-8000-000000000003', 'taylor@example.test', now(), '{"display_name":"Taylor"}');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
select lives_ok(
  $$select public.create_household('Alpha Kitchen')$$,
  'an authenticated user can create a household'
);

reset role;
select is(
  (select count(*)::integer from public.categories),
  9,
  'creating a household seeds nine categories'
);
select is(
  (select count(*)::integer from public.locations),
  5,
  'creating a household seeds five locations'
);
select ok(
  (select join_code ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$' from public.households),
  'join codes use ten unambiguous characters'
);
do $$
begin
  perform set_config('test.alpha_household_id', (select id::text from public.households), true);
  perform set_config('test.alpha_join_code', (select join_code from public.households), true);
end;
$$;

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';
select lives_ok(
  $$select public.join_household(
    overlay(current_setting('test.alpha_join_code') placing '-' from 6 for 0)
  )$$,
  'join codes accept display hyphens'
);
select throws_ok(
  $$select public.create_household('Second Kitchen')$$,
  '23505',
  'Your account already belongs to a household.',
  'one account cannot belong to two households'
);

reset role;
select is(
  (select count(*)::integer from public.household_members),
  2,
  'joining adds a second household member'
);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
insert into public.inventory_items (household_id, name, quantity, unit, created_by)
values (
  public.current_household_id(),
  'Rice',
  1,
  'kg',
  auth.uid()
);
select is(
  (select count(*)::integer from public.inventory_items),
  1,
  'a member can add inventory to their household'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000003';
select lives_ok(
  $$select public.create_household('Isolated Kitchen')$$,
  'another user can create a separate household'
);
select is(
  (select count(*)::integer from public.inventory_items),
  0,
  'RLS hides another household inventory'
);
select throws_ok(
  $$insert into public.inventory_items (household_id, name, quantity, unit, created_by)
    values (
      current_setting('test.alpha_household_id')::uuid,
      'Forbidden', 1, 'piece', auth.uid()
    )$$,
  '42501',
  'new row violates row-level security policy for table "inventory_items"',
  'RLS blocks cross-household inserts'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
select lives_ok(
  $$select public.rotate_household_join_code()$$,
  'any member can rotate the household join code'
);
select lives_ok(
  $$select public.remove_household_member('00000000-0000-4000-8000-000000000002')$$,
  'any member can remove another member'
);
select throws_ok(
  $$select public.leave_household()$$,
  '22023',
  'The last member must delete the household instead.',
  'the last member cannot leave the household'
);

select * from finish();
rollback;
