import Dexie, { type EntityTable } from 'dexie'
import { convertQuantity } from '../lib/inventory'
import type {
  Category,
  GroceryItem,
  InventoryItem,
  Json,
  OfflineOperation,
  Nutrition,
  StorageLocation,
  Unit,
} from '../types/database'

export const CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000

export type SnapshotCollection =
  | 'context'
  | 'inventory'
  | 'groceries'
  | 'categories'
  | 'locations'
  | 'members'
  | 'products'
  | 'recipes'
  | 'meal_plan'

interface OfflineSnapshot {
  key: string
  user_id: string
  household_id: string
  collection: SnapshotCollection
  data: unknown
  updated_at: number
}

class KitchenOfflineDatabase extends Dexie {
  snapshots!: EntityTable<OfflineSnapshot, 'key'>
  operations!: EntityTable<OfflineOperation, 'id'>

  constructor() {
    super('kitchen-offline-v1')
    this.version(1).stores({
      snapshots: 'key, user_id, household_id, collection, updated_at',
      operations: 'id, user_id, household_id, status, [user_id+household_id], created_at',
    })
  }
}

export const offlineDb = new KitchenOfflineDatabase()
export const offlineEvents = new EventTarget()

export function isSnapshotFresh(updatedAt: number, now = Date.now()) {
  return now - updatedAt <= CACHE_MAX_AGE
}

function snapshotKey(userId: string, householdId: string, collection: SnapshotCollection) {
  return `${userId}:${householdId}:${collection}`
}

export async function saveSnapshot<T>(
  userId: string,
  householdId: string,
  collection: SnapshotCollection,
  data: T,
) {
  await offlineDb.snapshots.put({
    key: snapshotKey(userId, householdId, collection),
    user_id: userId,
    household_id: householdId,
    collection,
    data,
    updated_at: Date.now(),
  })
  offlineEvents.dispatchEvent(new Event('change'))
}

export async function readSnapshot<T>(
  userId: string,
  householdId: string,
  collection: SnapshotCollection,
  allowExpired = false,
): Promise<T | null> {
  const snapshot = await offlineDb.snapshots.get(snapshotKey(userId, householdId, collection))
  if (!snapshot) return null
  if (!allowExpired && !isSnapshotFresh(snapshot.updated_at)) return null
  return snapshot.data as T
}

export async function readLatestContext<T>(userId: string): Promise<T | null> {
  const snapshots = await offlineDb.snapshots
    .where('user_id')
    .equals(userId)
    .and((snapshot) => snapshot.collection === 'context')
    .toArray()
  snapshots.sort((left, right) => right.updated_at - left.updated_at)
  const snapshot = snapshots[0]
  if (!snapshot || !isSnapshotFresh(snapshot.updated_at)) return null
  return snapshot.data as T
}

export async function listOperations(userId: string, householdId?: string) {
  const operations = householdId
    ? await offlineDb.operations.where('[user_id+household_id]').equals([userId, householdId]).toArray()
    : await offlineDb.operations.where('user_id').equals(userId).toArray()
  return operations.sort((left, right) => left.created_at.localeCompare(right.created_at))
}

function isProjectable(operation: OfflineOperation) {
  return Boolean(operation)
}

function localStatus(operation: OfflineOperation): 'pending' | 'conflict' | 'failed' {
  if (operation.status === 'conflict') return 'conflict'
  if (operation.status === 'failed') return 'failed'
  return 'pending'
}

function value<T>(payload: Record<string, Json>, key: string): T {
  return payload[key] as T
}

export function projectInventory(
  base: InventoryItem[],
  operations: OfflineOperation[],
  categories: Category[] = [],
  locations: StorageLocation[] = [],
): InventoryItem[] {
  const items = new Map(base.map((item) => [item.id, { ...item }]))

  for (const operation of operations.filter(isProjectable)) {
    const payload = operation.payload
    if (operation.kind === 'inventory.create') {
      const categoryId = value<string | null>(payload, 'category_id')
      const locationId = value<string | null>(payload, 'location_id')
      items.set(operation.entity_id, {
        id: operation.entity_id,
        household_id: operation.household_id,
        name: value<string>(payload, 'name'),
        quantity: value<number>(payload, 'quantity'),
        unit: value<Unit>(payload, 'unit'),
        category_id: categoryId,
        location_id: locationId,
        notes: value<string | null>(payload, 'notes'),
        low_stock_threshold: value<number | null>(payload, 'low_stock_threshold'),
        barcode: value<string | null>(payload, 'barcode') ?? null,
        brand: value<string | null>(payload, 'brand') ?? null,
        image_url: value<string | null>(payload, 'image_url') ?? null,
        nutrition: value<Nutrition | null>(payload, 'nutrition') ?? null,
        expires_on: value<string | null>(payload, 'expires_on') ?? null,
        created_by: operation.user_id,
        created_at: operation.created_at,
        updated_at: operation.created_at,
        version: 1,
        category: categories.find((category) => category.id === categoryId) ?? null,
        location: locations.find((location) => location.id === locationId) ?? null,
        local_sync_status: localStatus(operation),
      })
    } else if (operation.kind === 'inventory.update') {
      const existing = items.get(operation.entity_id)
      if (!existing) continue
      const categoryId = value<string | null>(payload, 'category_id')
      const locationId = value<string | null>(payload, 'location_id')
      items.set(operation.entity_id, {
        ...existing,
        name: value<string>(payload, 'name'),
        quantity: value<number>(payload, 'quantity'),
        unit: value<Unit>(payload, 'unit'),
        category_id: categoryId,
        location_id: locationId,
        notes: value<string | null>(payload, 'notes'),
        low_stock_threshold: value<number | null>(payload, 'low_stock_threshold'),
        barcode: 'barcode' in payload ? value<string | null>(payload, 'barcode') : existing.barcode,
        brand: 'brand' in payload ? value<string | null>(payload, 'brand') : existing.brand,
        image_url: 'image_url' in payload ? value<string | null>(payload, 'image_url') : existing.image_url,
        nutrition: 'nutrition' in payload ? value<Nutrition | null>(payload, 'nutrition') : existing.nutrition,
        expires_on: 'expires_on' in payload ? value<string | null>(payload, 'expires_on') : existing.expires_on,
        category: categories.find((category) => category.id === categoryId) ?? null,
        location: locations.find((location) => location.id === locationId) ?? null,
        updated_at: operation.created_at,
        local_sync_status: localStatus(operation),
      })
    } else if (operation.kind === 'inventory.delete') {
      items.delete(operation.entity_id)
    } else if (operation.kind === 'grocery.complete') {
      const action = value<string>(payload, 'stock_action')
      if (action === 'existing') {
        const targetId = value<string | null>(payload, 'target_inventory_item_id')
          ?? value<string | null>(payload, 'linked_inventory_item_id')
        const existing = targetId ? items.get(targetId) : undefined
        if (!existing) continue
        const converted = convertQuantity(
          value<number>(payload, 'quantity'),
          value<Unit>(payload, 'unit'),
          existing.unit,
        )
        if (converted === null) continue
        items.set(existing.id, {
          ...existing,
          quantity: existing.quantity + converted,
          expires_on: value<string | null>(payload, 'new_expires_on') ?? existing.expires_on,
          updated_at: operation.created_at,
          local_sync_status: localStatus(operation),
        })
      } else if (action === 'new') {
        const newId = value<string>(payload, 'new_inventory_item_id')
        items.set(newId, {
          id: newId,
          household_id: operation.household_id,
          name: value<string>(payload, 'name'),
          quantity: value<number>(payload, 'quantity'),
          unit: value<Unit>(payload, 'unit'),
          category_id: value<string | null>(payload, 'category_id'),
          location_id: value<string | null>(payload, 'new_location_id'),
          notes: value<string | null>(payload, 'notes'),
          low_stock_threshold: null,
          barcode: null,
          brand: null,
          image_url: null,
          nutrition: null,
          expires_on: value<string | null>(payload, 'new_expires_on') ?? null,
          created_by: operation.user_id,
          created_at: operation.created_at,
          updated_at: operation.created_at,
          version: 1,
          category: categories.find((category) => category.id === value<string | null>(payload, 'category_id')) ?? null,
          location: locations.find((location) => location.id === value<string | null>(payload, 'new_location_id')) ?? null,
          local_sync_status: localStatus(operation),
        })
      }
    }
  }
  return [...items.values()]
}

export function projectGroceries(
  base: GroceryItem[],
  operations: OfflineOperation[],
  categories: Category[] = [],
  inventory: InventoryItem[] = [],
): GroceryItem[] {
  const items = new Map(base.map((item) => [item.id, { ...item }]))

  for (const operation of operations.filter(isProjectable)) {
    const payload = operation.payload
    if (operation.kind === 'grocery.create') {
      const inventoryId = value<string | null>(payload, 'inventory_item_id')
      const inventoryItem = inventory.find((item) => item.id === inventoryId)
      const categoryId = value<string | null>(payload, 'category_id')
      items.set(operation.entity_id, {
        id: operation.entity_id,
        household_id: operation.household_id,
        inventory_item_id: inventoryId,
        name: inventoryItem?.name ?? value<string>(payload, 'name'),
        quantity: value<number | null>(payload, 'quantity'),
        unit: value<Unit | null>(payload, 'unit'),
        category_id: inventoryItem?.category_id ?? categoryId,
        notes: value<string | null>(payload, 'notes'),
        source: 'manual',
        status: 'active',
        stocked: false,
        created_by: operation.user_id,
        completed_by: null,
        completed_at: null,
        created_at: operation.created_at,
        updated_at: operation.created_at,
        version: 1,
        category: categories.find((category) => category.id === (inventoryItem?.category_id ?? categoryId)) ?? null,
        inventory_item: inventoryItem ?? null,
        local_sync_status: localStatus(operation),
      })
    } else if (operation.kind === 'grocery.update') {
      const existing = items.get(operation.entity_id)
      if (!existing) continue
      const inventoryId = value<string | null>(payload, 'inventory_item_id')
      const inventoryItem = inventory.find((item) => item.id === inventoryId)
      const categoryId = inventoryItem?.category_id ?? value<string | null>(payload, 'category_id')
      items.set(existing.id, {
        ...existing,
        inventory_item_id: inventoryId,
        name: inventoryItem?.name ?? value<string>(payload, 'name'),
        quantity: value<number | null>(payload, 'quantity'),
        unit: value<Unit | null>(payload, 'unit'),
        category_id: categoryId,
        notes: value<string | null>(payload, 'notes'),
        category: categories.find((category) => category.id === categoryId) ?? null,
        inventory_item: inventoryItem ?? null,
        updated_at: operation.created_at,
        local_sync_status: localStatus(operation),
      })
    } else if (operation.kind === 'grocery.delete') {
      items.delete(operation.entity_id)
    } else if (operation.kind === 'grocery.complete') {
      const existing = items.get(operation.entity_id)
      if (!existing) continue
      const action = value<string>(payload, 'stock_action')
      items.set(existing.id, {
        ...existing,
        status: 'purchased',
        stocked: action !== 'none',
        quantity: value<number | null>(payload, 'quantity'),
        unit: value<Unit | null>(payload, 'unit'),
        completed_by: operation.user_id,
        completed_at: operation.created_at,
        updated_at: operation.created_at,
        local_sync_status: localStatus(operation),
      })
    } else if (operation.kind === 'grocery.repeat') {
      const source = items.get(operation.entity_id)
      const newId = value<string>(payload, 'new_grocery_item_id')
      if (!source) continue
      items.set(newId, {
        ...source,
        id: newId,
        source: 'manual',
        status: 'active',
        stocked: false,
        completed_by: null,
        completed_at: null,
        created_by: operation.user_id,
        created_at: operation.created_at,
        updated_at: operation.created_at,
        version: 1,
        local_sync_status: localStatus(operation),
      })
    }
  }
  return [...items.values()]
}

export async function enqueueOperation(operation: OfflineOperation) {
  await offlineDb.transaction('rw', offlineDb.operations, async () => {
    const operations = await listOperations(operation.user_id, operation.household_id)
    const prior = [...operations].reverse().find((candidate) =>
      candidate.entity_type === operation.entity_type
      && candidate.entity_id === operation.entity_id
      && candidate.status === 'pending',
    )

    if (prior?.kind.endsWith('.create') && operation.kind.endsWith('.update')) {
      await offlineDb.operations.update(prior.id, {
        payload: { ...prior.payload, ...operation.payload, id: prior.entity_id },
      })
      return
    }
    if (prior?.kind.endsWith('.create') && operation.kind.endsWith('.delete')) {
      await offlineDb.operations.delete(prior.id)
      return
    }
    if (prior?.kind.endsWith('.update') && operation.kind.endsWith('.delete')) {
      await offlineDb.operations.delete(prior.id)
      await offlineDb.operations.add({
        ...operation,
        payload: {
          ...operation.payload,
          expected_version: prior.payload.expected_version,
        },
      })
      return
    }
    if (prior?.kind === operation.kind && operation.kind.endsWith('.update')) {
      await offlineDb.operations.update(prior.id, {
        payload: { ...operation.payload },
        created_at: operation.created_at,
      })
      return
    }
    await offlineDb.operations.add(operation)
  })
  offlineEvents.dispatchEvent(new Event('change'))
  offlineEvents.dispatchEvent(new Event('projection-change'))
}

export async function updateOperation(id: string, changes: Partial<OfflineOperation>) {
  await offlineDb.operations.update(id, changes)
  offlineEvents.dispatchEvent(new Event('change'))
  offlineEvents.dispatchEvent(new Event('projection-change'))
}

export async function removeOperation(id: string) {
  await offlineDb.operations.delete(id)
  offlineEvents.dispatchEvent(new Event('change'))
  offlineEvents.dispatchEvent(new Event('projection-change'))
}

export async function clearOfflineUser(userId: string) {
  await offlineDb.transaction('rw', offlineDb.snapshots, offlineDb.operations, async () => {
    await offlineDb.snapshots.where('user_id').equals(userId).delete()
    await offlineDb.operations.where('user_id').equals(userId).delete()
  })
  offlineEvents.dispatchEvent(new Event('change'))
}
