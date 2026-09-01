import { ConflictError } from '../lib/errors'
import { supabase } from '../lib/supabase'
import {
  cachedCollection,
  cachedContext,
  currentUserId,
  projectedGroceries,
  projectedInventory,
} from '../offline/cache'
import { queueCommand } from '../offline/sync'
import { readLatestContext } from '../offline/store'
import type {
  Category,
  GroceryItem,
  GroceryItemInput,
  Household,
  HouseholdContext,
  HouseholdMember,
  InventoryItem,
  ItemInput,
  PurchaseInput,
  Profile,
  StorageLocation,
  Json,
} from '../types/database'

export const queryKeys = {
  context: ['household-context'] as const,
  inventory: (householdId: string) => ['inventory', householdId] as const,
  categories: (householdId: string) => ['categories', householdId] as const,
  locations: (householdId: string) => ['locations', householdId] as const,
  members: (householdId: string) => ['members', householdId] as const,
  groceries: (householdId: string) => ['groceries', householdId] as const,
}

function unwrap<T>(data: T | null, error: { message: string } | null): T {
  if (error) throw new Error(error.message)
  if (data === null) throw new Error('The requested data was not found.')
  return data
}

export async function fetchHouseholdContext(userId: string): Promise<HouseholdContext | null> {
  return cachedContext(userId, async () => {
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
  })
}

export async function fetchInventory(householdId: string): Promise<InventoryItem[]> {
  const base = await cachedCollection(householdId, 'inventory', async () => {
    const { data, error } = await supabase
      .from('inventory_items')
      .select('*, category:categories(id,name), location:locations(id,name)')
      .eq('household_id', householdId)
    if (error) throw new Error(error.message)
    return (data ?? []) as unknown as InventoryItem[]
  })
  return projectedInventory(householdId, base)
}

export async function fetchCategories(householdId: string): Promise<Category[]> {
  return cachedCollection(householdId, 'categories', async () => {
    const { data, error } = await supabase
      .from('categories')
      .select('*')
      .eq('household_id', householdId)
      .order('name')
    if (error) throw new Error(error.message)
    return data ?? []
  })
}

export async function fetchLocations(householdId: string): Promise<StorageLocation[]> {
  return cachedCollection(householdId, 'locations', async () => {
    const { data, error } = await supabase
      .from('locations')
      .select('*')
      .eq('household_id', householdId)
      .order('name')
    if (error) throw new Error(error.message)
    return data ?? []
  })
}

export async function fetchGroceries(householdId: string): Promise<GroceryItem[]> {
  const base = await cachedCollection(householdId, 'groceries', async () => {
    const { data, error } = await supabase
      .from('grocery_items')
      .select('*, category:categories(id,name), inventory_item:inventory_items(id,name,quantity,unit,low_stock_threshold)')
      .eq('household_id', householdId)
    if (error) throw new Error(error.message)
    return (data ?? []) as unknown as GroceryItem[]
  })
  return projectedGroceries(householdId, base)
}

export async function fetchMembers(householdId: string): Promise<HouseholdMember[]> {
  return cachedCollection(householdId, 'members', async () => {
    const { data, error } = await supabase
      .from('household_members')
      .select('household_id,user_id,joined_at,profile:profiles(id,display_name)')
      .eq('household_id', householdId)
      .order('joined_at')
    if (error) throw new Error(error.message)
    return (data ?? []) as unknown as HouseholdMember[]
  })
}

function payload(value: Record<string, unknown>) {
  return value as Record<string, Json>
}

function requireOnline() {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new Error('This setting can only be changed while online.')
  }
}

async function currentHouseholdId() {
  const userId = await currentUserId()
  if (!userId) throw new Error('You must be signed in.')
  const context = await readLatestContext<HouseholdContext>(userId)
  if (context) return context.household.id
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new Error('Open your household online once before making offline changes.')
  }
  const { data, error } = await supabase.rpc('current_household_id')
  if (error || !data) throw new Error(error?.message ?? 'You must belong to a household.')
  return data
}

export async function createInventoryItem(
  householdId: string,
  _userId: string,
  input: ItemInput,
) {
  const id = crypto.randomUUID()
  await queueCommand(householdId, 'inventory.create', id, payload({ id, ...input }))
  return id
}

export async function updateInventoryItem(item: InventoryItem, input: ItemInput) {
  await queueCommand(item.household_id, 'inventory.update', item.id, payload({
    id: item.id,
    expected_version: item.version,
    ...input,
  }))
}

export async function deleteInventoryItem(item: InventoryItem) {
  await queueCommand(item.household_id, 'inventory.delete', item.id, payload({
    id: item.id,
    expected_version: item.version,
  }))
}

function throwRpcError(error: { code?: string; message: string } | null) {
  if (!error) return
  if (error.code === '40001') throw new ConflictError(error.message)
  throw new Error(error.message)
}

export async function createGroceryItem(input: GroceryItemInput) {
  const household = await currentHouseholdId()
  const id = crypto.randomUUID()
  await queueCommand(household, 'grocery.create', id, payload({ id, ...input }))
  return { grocery_item_id: id, created: true }
}

export async function updateGroceryItem(item: GroceryItem, input: GroceryItemInput) {
  await queueCommand(item.household_id, 'grocery.update', item.id, payload({
    id: item.id,
    expected_version: item.version,
    ...input,
  }))
}

export async function deleteGroceryItem(item: GroceryItem) {
  await queueCommand(item.household_id, 'grocery.delete', item.id, payload({
    id: item.id,
    expected_version: item.version,
  }))
}

export async function completeGroceryItem(item: GroceryItem, input: PurchaseInput) {
  const newInventoryId = input.stock_action === 'new' ? crypto.randomUUID() : null
  await queueCommand(item.household_id, 'grocery.complete', item.id, payload({
    id: item.id,
    expected_version: item.version,
    ...input,
    linked_inventory_item_id: item.inventory_item_id,
    new_inventory_item_id: newInventoryId,
    name: item.name,
    category_id: item.category_id,
    notes: item.notes,
  }))
  return { completed_grocery_item_id: item.id, stocked_inventory_item_id: newInventoryId ?? input.target_inventory_item_id }
}

export async function repeatGroceryItem(item: GroceryItem) {
  const newId = crypto.randomUUID()
  await queueCommand(item.household_id, 'grocery.repeat', item.id, payload({
    id: item.id,
    new_grocery_item_id: newId,
  }))
  return { grocery_item_id: newId, created: true }
}

export async function clearGroceryHistory() {
  requireOnline()
  const { data, error } = await supabase.rpc('clear_grocery_history')
  throwRpcError(error)
  return data ?? 0
}

export async function createHousehold(name: string) {
  requireOnline()
  const { data, error } = await supabase.rpc('create_household', { household_name: name })
  if (error) throw new Error(error.message)
  return unwrap(data?.[0] ?? null, null)
}

export async function joinHousehold(code: string) {
  requireOnline()
  const { data, error } = await supabase.rpc('join_household', { code })
  if (error) throw new Error(error.message)
  return unwrap(data?.[0] ?? null, null)
}

export async function rotateJoinCode() {
  requireOnline()
  const { data, error } = await supabase.rpc('rotate_household_join_code')
  if (error) throw new Error(error.message)
  return unwrap(data?.[0] ?? null, null)
}

export async function updateHouseholdName(householdId: string, name: string) {
  requireOnline()
  const { error } = await supabase.from('households').update({ name }).eq('id', householdId)
  if (error) throw new Error(error.message)
}

export async function createTaxonomy(
  table: 'categories' | 'locations',
  householdId: string,
  name: string,
) {
  requireOnline()
  const { error } = await supabase.from(table).insert({ household_id: householdId, name })
  if (error) throw new Error(error.message)
}

export async function updateTaxonomy(
  table: 'categories' | 'locations',
  id: string,
  name: string,
) {
  requireOnline()
  const { error } = await supabase.from(table).update({ name }).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function deleteTaxonomy(table: 'categories' | 'locations', id: string) {
  requireOnline()
  const { error } = await supabase.from(table).delete().eq('id', id)
  if (error) throw new Error(error.message)
}

export async function updateDisplayName(userId: string, displayName: string) {
  requireOnline()
  const { error } = await supabase
    .from('profiles')
    .update({ display_name: displayName })
    .eq('id', userId)
  if (error) throw new Error(error.message)
}

export async function removeMember(userId: string) {
  requireOnline()
  const { error } = await supabase.rpc('remove_household_member', {
    member_user_id: userId,
  })
  if (error) throw new Error(error.message)
}

export async function leaveHousehold() {
  requireOnline()
  const { error } = await supabase.rpc('leave_household')
  if (error) throw new Error(error.message)
}

export async function deleteHousehold(confirmationName: string) {
  requireOnline()
  const { error } = await supabase.rpc('delete_household', {
    confirmation_name: confirmationName,
  })
  if (error) throw new Error(error.message)
}
