import { ConflictError } from '../lib/errors'
import { supabase } from '../lib/supabase'
import type {
  Category,
  Household,
  HouseholdContext,
  HouseholdMember,
  InventoryItem,
  ItemInput,
  Profile,
  StorageLocation,
} from '../types/database'

export const queryKeys = {
  context: ['household-context'] as const,
  inventory: (householdId: string) => ['inventory', householdId] as const,
  categories: (householdId: string) => ['categories', householdId] as const,
  locations: (householdId: string) => ['locations', householdId] as const,
  members: (householdId: string) => ['members', householdId] as const,
}

function unwrap<T>(data: T | null, error: { message: string } | null): T {
  if (error) throw new Error(error.message)
  if (data === null) throw new Error('The requested data was not found.')
  return data
}

export async function fetchHouseholdContext(userId: string): Promise<HouseholdContext | null> {
  const [profileResult, memberResult] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', userId).single(),
    supabase
      .from('household_members')
      .select('household_id, household:households(*)')
      .eq('user_id', userId)
      .maybeSingle(),
  ])
  const profile = unwrap(profileResult.data, profileResult.error) as Profile
  if (memberResult.error) throw new Error(memberResult.error.message)
  if (!memberResult.data) return null
  const household = memberResult.data.household as unknown as Household
  return { profile, household }
}

export async function fetchInventory(householdId: string): Promise<InventoryItem[]> {
  const { data, error } = await supabase
    .from('inventory_items')
    .select('*, category:categories(id,name), location:locations(id,name)')
    .eq('household_id', householdId)
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as InventoryItem[]
}

export async function fetchCategories(householdId: string): Promise<Category[]> {
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .eq('household_id', householdId)
    .order('name')
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function fetchLocations(householdId: string): Promise<StorageLocation[]> {
  const { data, error } = await supabase
    .from('locations')
    .select('*')
    .eq('household_id', householdId)
    .order('name')
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function fetchMembers(householdId: string): Promise<HouseholdMember[]> {
  const { data, error } = await supabase
    .from('household_members')
    .select('household_id,user_id,joined_at,profile:profiles(id,display_name)')
    .eq('household_id', householdId)
    .order('joined_at')
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as HouseholdMember[]
}

export async function createInventoryItem(
  householdId: string,
  userId: string,
  input: ItemInput,
) {
  const { error } = await supabase.from('inventory_items').insert({
    ...input,
    household_id: householdId,
    created_by: userId,
  })
  if (error) throw new Error(error.message)
}

export async function updateInventoryItem(item: InventoryItem, input: ItemInput) {
  const { data, error } = await supabase
    .from('inventory_items')
    .update(input)
    .eq('id', item.id)
    .eq('version', item.version)
    .select('id')
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new ConflictError()
}

export async function deleteInventoryItem(item: InventoryItem) {
  const { data, error } = await supabase
    .from('inventory_items')
    .delete()
    .eq('id', item.id)
    .eq('version', item.version)
    .select('id')
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new ConflictError('This item changed or was already removed.')
}

export async function createHousehold(name: string) {
  const { data, error } = await supabase.rpc('create_household', { household_name: name })
  if (error) throw new Error(error.message)
  return unwrap(data?.[0] ?? null, null)
}

export async function joinHousehold(code: string) {
  const { data, error } = await supabase.rpc('join_household', { code })
  if (error) throw new Error(error.message)
  return unwrap(data?.[0] ?? null, null)
}

export async function rotateJoinCode() {
  const { data, error } = await supabase.rpc('rotate_household_join_code')
  if (error) throw new Error(error.message)
  return unwrap(data?.[0] ?? null, null)
}

export async function updateHouseholdName(householdId: string, name: string) {
  const { error } = await supabase.from('households').update({ name }).eq('id', householdId)
  if (error) throw new Error(error.message)
}

export async function createTaxonomy(
  table: 'categories' | 'locations',
  householdId: string,
  name: string,
) {
  const { error } = await supabase.from(table).insert({ household_id: householdId, name })
  if (error) throw new Error(error.message)
}

export async function updateTaxonomy(
  table: 'categories' | 'locations',
  id: string,
  name: string,
) {
  const { error } = await supabase.from(table).update({ name }).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function deleteTaxonomy(table: 'categories' | 'locations', id: string) {
  const { error } = await supabase.from(table).delete().eq('id', id)
  if (error) throw new Error(error.message)
}

export async function updateDisplayName(userId: string, displayName: string) {
  const { error } = await supabase
    .from('profiles')
    .update({ display_name: displayName })
    .eq('id', userId)
  if (error) throw new Error(error.message)
}

export async function removeMember(userId: string) {
  const { error } = await supabase.rpc('remove_household_member', {
    member_user_id: userId,
  })
  if (error) throw new Error(error.message)
}

export async function leaveHousehold() {
  const { error } = await supabase.rpc('leave_household')
  if (error) throw new Error(error.message)
}

export async function deleteHousehold(confirmationName: string) {
  const { error } = await supabase.rpc('delete_household', {
    confirmation_name: confirmationName,
  })
  if (error) throw new Error(error.message)
}
