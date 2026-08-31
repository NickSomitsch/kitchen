import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !publishableKey || !serviceRoleKey) {
  throw new Error('SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, and SUPABASE_SERVICE_ROLE_KEY are required.')
}

const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } })
const stamp = Date.now()
const password = `Hosted-QA-${stamp}!`
const users = []
const households = []

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function createUser(label) {
  const email = `hosted-qa-${label}-${stamp}@example.test`
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: `QA ${label}` },
  })
  if (error) throw error
  users.push(data.user.id)

  const client = createClient(url, publishableKey, { auth: { persistSession: false } })
  const { error: signInError } = await client.auth.signInWithPassword({ email, password })
  if (signInError) throw signInError
  return { client, id: data.user.id }
}

try {
  const first = await createUser('one')
  const second = await createUser('two')
  const isolated = await createUser('isolated')

  const { data: created, error: createError } = await first.client.rpc('create_household', {
    household_name: 'Hosted QA Kitchen',
  })
  if (createError) throw createError
  const sharedHousehold = created?.[0]
  assert(sharedHousehold, 'The first household was not created.')
  households.push(sharedHousehold.household_id)

  const { error: joinError } = await second.client.rpc('join_household', {
    code: `${sharedHousehold.join_code.slice(0, 5)}-${sharedHousehold.join_code.slice(5)}`,
  })
  if (joinError) throw joinError

  const { data: categories, error: categoriesError } = await first.client
    .from('categories')
    .select('id')
  if (categoriesError) throw categoriesError
  assert(categories.length === 9, 'Household category defaults were not seeded.')

  const { data: inserted, error: insertError } = await first.client
    .from('inventory_items')
    .insert({
      household_id: sharedHousehold.household_id,
      name: 'Hosted QA rice',
      quantity: 1,
      unit: 'kg',
      created_by: first.id,
    })
    .select('*')
    .single()
  if (insertError) throw insertError

  const { data: visibleToMember, error: memberReadError } = await second.client
    .from('inventory_items')
    .select('*')
  if (memberReadError) throw memberReadError
  assert(visibleToMember.length === 1, 'A household member could not read shared inventory.')

  const { data: updated, error: updateError } = await second.client
    .from('inventory_items')
    .update({ quantity: 2.5 })
    .eq('id', inserted.id)
    .eq('version', inserted.version)
    .select('*')
    .single()
  if (updateError) throw updateError
  assert(updated.version === 2, 'Inventory versioning did not increment.')

  const { data: isolatedHouseholdData, error: isolatedCreateError } = await isolated.client.rpc(
    'create_household',
    { household_name: 'Hosted QA Isolated Kitchen' },
  )
  if (isolatedCreateError) throw isolatedCreateError
  const isolatedHousehold = isolatedHouseholdData?.[0]
  assert(isolatedHousehold, 'The isolated household was not created.')
  households.push(isolatedHousehold.household_id)

  const { data: hidden, error: isolatedReadError } = await isolated.client
    .from('inventory_items')
    .select('*')
  if (isolatedReadError) throw isolatedReadError
  assert(hidden.length === 0, 'RLS exposed another household inventory.')

  const { error: crossInsertError } = await isolated.client.from('inventory_items').insert({
    household_id: sharedHousehold.household_id,
    name: 'Forbidden item',
    quantity: 1,
    unit: 'piece',
    created_by: isolated.id,
  })
  assert(crossInsertError, 'RLS allowed a cross-household inventory insert.')

  const { error: rotateError } = await second.client.rpc('rotate_household_join_code')
  if (rotateError) throw rotateError
  const { error: removeError } = await first.client.rpc('remove_household_member', {
    member_user_id: second.id,
  })
  if (removeError) throw removeError
  const { error: leaveError } = await first.client.rpc('leave_household')
  assert(leaveError, 'The final member was allowed to leave the household.')

  console.log('Hosted Supabase verification passed.')
} finally {
  if (households.length) {
    await admin.from('households').delete().in('id', households)
  }
  for (const userId of users) {
    await admin.auth.admin.deleteUser(userId)
  }
}
