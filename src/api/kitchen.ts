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
  HouseholdPreferencesInput,
  MealPlanEntry,
  MealPlanEntryInput,
  ProductFacts,
  Recipe,
  RecipeInput,
  ScanMode,
  ScanResult,
  ScannedProduct,
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
  products: (householdId: string) => ['products', householdId] as const,
  recipes: (householdId: string) => ['recipes', householdId] as const,
  mealPlan: (householdId: string) => ['meal-plan', householdId] as const,
}

/** The meal plan is cached from a week ago onward, which covers the visible planner. */
export function mealPlanWindowStart(today = new Date()) {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 7)
  const month = `${start.getMonth() + 1}`.padStart(2, '0')
  const day = `${start.getDate()}`.padStart(2, '0')
  return `${start.getFullYear()}-${month}-${day}`
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

export async function updateHouseholdPreferences(
  householdId: string,
  input: HouseholdPreferencesInput,
) {
  requireOnline()
  const { error } = await supabase
    .from('households')
    .update({
      diet_tags: input.diet_tags,
      avoid_ingredients: input.avoid_ingredients,
    })
    .eq('id', householdId)
  if (error) throw new Error(error.message)
}

/* Barcodes and product facts */

export async function fetchScannedProducts(householdId: string): Promise<ScannedProduct[]> {
  return cachedCollection(householdId, 'products', async () => {
    const { data, error } = await supabase
      .from('scanned_products')
      .select('*')
      .eq('household_id', householdId)
      .order('updated_at', { ascending: false })
      .limit(500)
    if (error) throw new Error(error.message)
    return (data ?? []) as unknown as ScannedProduct[]
  })
}

function factsFromCache(product: ScannedProduct): ProductFacts {
  return {
    barcode: product.barcode,
    name: product.name,
    brand: product.brand,
    image_url: product.image_url,
    package_quantity: product.package_quantity,
    package_unit: product.package_unit,
    nutrition: product.nutrition,
    ingredients_text: product.ingredients_text,
    allergens: product.allergens ?? [],
    source: product.source,
    origin: 'cache',
  }
}

/** Remembers a product so the next scan of the same barcode resolves instantly, even offline. */
export async function rememberProduct(householdId: string, facts: ProductFacts) {
  const { error } = await supabase.from('scanned_products').upsert({
    household_id: householdId,
    barcode: facts.barcode,
    name: facts.name,
    brand: facts.brand,
    image_url: facts.image_url,
    package_quantity: facts.package_quantity,
    package_unit: facts.package_unit,
    nutrition: facts.nutrition as unknown as Json,
    ingredients_text: facts.ingredients_text,
    allergens: facts.allergens,
    source: facts.source,
  }, { onConflict: 'household_id,barcode' })
  if (error) throw new Error(error.message)
}

/**
 * Resolves a barcode from the household's own cache first, then from Open Food Facts.
 * Community data can be wrong or incomplete, so callers always confirm before saving.
 */
export async function lookupProduct(
  householdId: string,
  barcode: string,
): Promise<ProductFacts> {
  const { normalizeBarcode, lookupBarcode, ProductNotFoundError } = await import('../lib/openfoodfacts')
  const normalized = normalizeBarcode(barcode)
  const cached = await fetchScannedProducts(householdId)
    .then((products) => products.find((product) => product.barcode === normalized))
    .catch(() => undefined)
  if (cached) return factsFromCache(cached)
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new ProductNotFoundError(normalized)
  }
  const facts = await lookupBarcode(normalized)
  void rememberProduct(householdId, facts).catch(() => {
    // Caching is a convenience; a failure here must not block the scan.
  })
  return facts
}

/* Photo and receipt recognition */

export class RecognitionUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RecognitionUnavailableError'
  }
}

export async function recognizeImage(
  mode: ScanMode,
  imageDataUrl: string,
  hints: { categories: string[] },
): Promise<ScanResult> {
  requireOnline()
  const { data, error } = await supabase.functions.invoke<ScanResult>('scan-image', {
    body: { mode, image: imageDataUrl, categories: hints.categories.slice(0, 40) },
  })
  if (error) {
    const response = (error as { context?: Response }).context
    if (response) {
      const body = await response.json().catch(() => null) as { error?: string } | null
      // 404 is what an undeployed function returns, and 501 is the function
      // reporting that its API key was never set.
      if (response.status === 404) {
        throw new RecognitionUnavailableError(
          'Image recognition is not available. Deploy the scan-image function to enable it.',
        )
      }
      const message = body?.error ?? 'Image recognition failed.'
      if (response.status === 501 || response.status === 503) {
        throw new RecognitionUnavailableError(message)
      }
      throw new Error(message)
    }
    throw new RecognitionUnavailableError(
      'Image recognition is not available. Deploy the scan-image function to enable it.',
    )
  }
  if (!data) throw new Error('Image recognition returned no result.')
  return data
}

/* Recipes */

export async function fetchRecipes(householdId: string): Promise<Recipe[]> {
  return cachedCollection(householdId, 'recipes', async () => {
    const { data, error } = await supabase
      .from('recipes')
      .select('*, ingredients:recipe_ingredients(*)')
      .eq('household_id', householdId)
      .order('name')
    if (error) throw new Error(error.message)
    return (data ?? []).map((recipe) => ({
      ...recipe,
      ingredients: [...(recipe.ingredients ?? [])].sort(
        (left: { position: number }, right: { position: number }) => left.position - right.position,
      ),
    })) as unknown as Recipe[]
  })
}

function recipePayload(input: RecipeInput) {
  return {
    name: input.name.trim(),
    description: input.description,
    instructions: input.instructions,
    servings: input.servings,
    prep_minutes: input.prep_minutes,
    cook_minutes: input.cook_minutes,
    source_url: input.source_url,
    image_url: input.image_url,
    tags: input.tags,
  }
}

export async function saveRecipe(
  input: RecipeInput,
  existing?: Pick<Recipe, 'id' | 'version'>,
) {
  requireOnline()
  const { data, error } = await supabase.rpc('save_recipe', {
    recipe_id: existing?.id ?? crypto.randomUUID(),
    expected_version: existing?.version ?? null,
    recipe: recipePayload(input) as unknown as Json,
    ingredients: input.ingredients.map((ingredient, index) => ({
      name: ingredient.name.trim(),
      quantity: ingredient.quantity,
      unit: ingredient.unit,
      optional: ingredient.optional,
      inventory_item_id: ingredient.inventory_item_id,
      position: index,
    })) as unknown as Json,
  })
  throwRpcError(error)
  return unwrap(data?.[0] ?? null, null)
}

export async function deleteRecipe(recipe: Pick<Recipe, 'id' | 'version'>) {
  requireOnline()
  const { error } = await supabase.rpc('delete_recipe', {
    recipe_id: recipe.id,
    expected_version: recipe.version,
  })
  throwRpcError(error)
}

export async function setRecipeFavorite(recipeId: string, favorite: boolean) {
  requireOnline()
  const { error } = await supabase.rpc('set_recipe_favorite', {
    recipe_id: recipeId,
    favorite,
  })
  throwRpcError(error)
}

export async function addRecipeToGroceries(recipeId: string, servings: number | null) {
  requireOnline()
  const { data, error } = await supabase.rpc('add_recipe_to_groceries', {
    recipe_id: recipeId,
    target_servings: servings,
  })
  throwRpcError(error)
  return data?.[0] ?? { added: 0, skipped: 0 }
}

export async function logRecipeCooked(
  recipeId: string,
  servings: number | null,
  consume: boolean,
  entryId: string | null = null,
) {
  requireOnline()
  const { data, error } = await supabase.rpc('log_recipe_cooked', {
    recipe_id: recipeId,
    target_servings: servings,
    consume,
    entry_id: entryId,
  })
  throwRpcError(error)
  return data?.[0] ?? { deducted: 0, unmatched: 0 }
}

/* Meal plan */

export async function fetchMealPlan(householdId: string): Promise<MealPlanEntry[]> {
  return cachedCollection(householdId, 'meal_plan', async () => {
    const { data, error } = await supabase
      .from('meal_plan_entries')
      .select('*, recipe:recipes(id,name,servings,image_url,prep_minutes,cook_minutes)')
      .eq('household_id', householdId)
      .gte('planned_on', mealPlanWindowStart())
      .order('planned_on')
    if (error) throw new Error(error.message)
    return (data ?? []) as unknown as MealPlanEntry[]
  })
}

export async function saveMealPlanEntry(
  input: MealPlanEntryInput,
  existing?: Pick<MealPlanEntry, 'id' | 'version'>,
) {
  requireOnline()
  const { data, error } = await supabase.rpc('save_meal_plan_entry', {
    entry_id: existing?.id ?? crypto.randomUUID(),
    expected_version: existing?.version ?? null,
    planned_on: input.planned_on,
    slot: input.slot,
    recipe_id: input.recipe_id,
    entry_title: input.title,
    entry_servings: input.servings,
    entry_notes: input.notes,
  })
  throwRpcError(error)
  return unwrap(data?.[0] ?? null, null)
}

export async function deleteMealPlanEntry(entry: Pick<MealPlanEntry, 'id' | 'version'>) {
  requireOnline()
  const { error } = await supabase.rpc('delete_meal_plan_entry', {
    entry_id: entry.id,
    expected_version: entry.version,
  })
  throwRpcError(error)
}

export async function addMealPlanToGroceries(from: string, to: string) {
  requireOnline()
  const { data, error } = await supabase.rpc('add_meal_plan_to_groceries', {
    from_date: from,
    to_date: to,
  })
  throwRpcError(error)
  return data?.[0] ?? { added: 0, skipped: 0 }
}
