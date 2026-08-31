begin;
select plan(38);

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
  (select count(*)::integer from public.categories
    where household_id = (select id from public.households where created_by = '00000000-0000-4000-8000-000000000001')),
  9,
  'creating a household seeds nine categories'
);
select is(
  (select count(*)::integer from public.locations
    where household_id = (select id from public.households where created_by = '00000000-0000-4000-8000-000000000001')),
  5,
  'creating a household seeds five locations'
);
select ok(
  (select join_code ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$'
    from public.households where created_by = '00000000-0000-4000-8000-000000000001'),
  'join codes use ten unambiguous characters'
);
do $$
begin
  perform set_config('test.alpha_household_id', (
    select id::text from public.households where created_by = '00000000-0000-4000-8000-000000000001'
  ), true);
  perform set_config('test.alpha_join_code', (
    select join_code from public.households where created_by = '00000000-0000-4000-8000-000000000001'
  ), true);
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
  (select count(*)::integer from public.household_members
    where household_id = current_setting('test.alpha_household_id')::uuid),
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
select lives_ok(
  $$update public.inventory_items set low_stock_threshold = 1 where name = 'Rice'$$,
  'a member can configure a low-stock threshold'
);
select is(
  (select count(*)::integer from public.grocery_items where status = 'active'),
  1,
  'reaching a threshold creates one active grocery entry'
);
select is(
  (select source::text from public.grocery_items where status = 'active'),
  'low_stock',
  'the generated entry is marked as automatic'
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
select is(
  (select count(*)::integer from public.grocery_items),
  0,
  'RLS hides another household grocery list'
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
  $$select public.complete_grocery_item(
      (select id from public.grocery_items where status = 'active'),
      1,
      'existing',
      500,
      'g',
      (select id from public.inventory_items where name = 'Rice'),
      null
    )$$,
  'purchase completion atomically stocks a compatible inventory item'
);
select is(
  (select quantity from public.inventory_items where name = 'Rice'),
  1.500::numeric,
  'purchase quantities are converted into the inventory unit'
);
select is(
  (select count(*)::integer from public.grocery_items where status = 'purchased' and stocked),
  1,
  'the completed grocery remains in stocked purchase history'
);
select is(
  (select count(*)::integer from public.grocery_items where status = 'active'),
  0,
  'restocking above the threshold leaves no automatic entry'
);
select lives_ok(
  $$insert into public.inventory_items (
      household_id, name, quantity, unit, low_stock_threshold, created_by
    ) values (public.current_household_id(), 'Tea', 0, 'piece', 0, auth.uid())$$,
  'a zero threshold creates an automatic entry at zero stock'
);
select lives_ok(
  $$select public.complete_grocery_item(
      (select id from public.grocery_items where name = 'Tea' and status = 'active'),
      1, 'existing', 2, 'piece',
      (select id from public.inventory_items where name = 'Tea'), null
    )$$,
  'a zero-threshold entry can be purchased and stocked'
);
select lives_ok(
  $$delete from public.inventory_items where name = 'Tea'$$,
  'inventory deletion succeeds while preserving completed grocery history'
);
select is(
  (select inventory_item_id from public.grocery_items where name = 'Tea' and status = 'purchased'),
  null::uuid,
  'completed automatic history becomes an unlinked snapshot'
);
select lives_ok(
  $$update public.inventory_items set quantity = 0.5 where name = 'Rice'$$,
  'lowering inventory below the threshold reconciles groceries'
);
select is(
  (select count(*)::integer from public.grocery_items where status = 'active' and source = 'low_stock'),
  1,
  'a new automatic entry appears when stock becomes low again'
);
select lives_ok(
  $$update public.inventory_items set quantity = 2 where name = 'Rice'$$,
  'raising inventory above the threshold reconciles groceries'
);
select is(
  (select count(*)::integer from public.grocery_items where status = 'active'),
  0,
  'recovered stock removes only the active automatic entry'
);
select lives_ok(
  $$select public.create_grocery_item(
      (select id from public.inventory_items where name = 'Rice'),
      null, null, null, null, null
    )$$,
  'a linked inventory item can be added manually'
);
select throws_ok(
  $$select public.complete_grocery_item(
      (select id from public.grocery_items where name = 'Rice' and status = 'active'),
      1, 'existing', 1, 'l',
      (select id from public.inventory_items where name = 'Rice'), null
    )$$,
  '22023',
  'The purchased unit is not compatible with the inventory unit.',
  'incompatible purchase units are rejected'
);
select lives_ok(
  $$select public.delete_grocery_item(
      (select id from public.grocery_items where name = 'Rice' and status = 'active'), 1
    )$$,
  'a member can remove a version-matched manual grocery entry'
);

set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';
select lives_ok(
  $$select public.create_grocery_item(null, 'Dish soap', null, null, null, 'Unscented')$$,
  'an equal household member can add a free-form grocery'
);
select is(
  (select count(*)::integer from public.grocery_items where status = 'active'),
  1,
  'the shared household sees the member-added grocery'
);
select lives_ok(
  $$select public.complete_grocery_item(
      (select id from public.grocery_items where name = 'Dish soap' and status = 'active'),
      1, 'new', 2, 'package', null, null
    )$$,
  'a free-form purchase can create a new inventory item atomically'
);
select is(
  (select quantity::text || ' ' || unit::text from public.inventory_items where name = 'Dish soap'),
  '2.000 package',
  'the new inventory item uses the reviewed purchase amount'
);
select throws_ok(
  $$insert into public.grocery_items (household_id, name, created_by)
    values (public.current_household_id(), 'Forged', auth.uid())$$,
  '42501',
  'permission denied for table grocery_items',
  'direct grocery writes are denied in favor of protected functions'
);

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
