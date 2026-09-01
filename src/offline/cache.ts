import { supabase } from '../lib/supabase'
import type {
  Category,
  GroceryItem,
  HouseholdContext,
  InventoryItem,
  OfflineOperation,
  StorageLocation,
} from '../types/database'
import {
  clearOfflineUser,
  listOperations,
  projectGroceries,
  projectInventory,
  readLatestContext,
  readSnapshot,
  saveSnapshot,
  type SnapshotCollection,
} from './store'

export class OfflineCacheMissError extends Error {
  constructor() {
    super('Connect to the internet once to make this data available offline.')
    this.name = 'OfflineCacheMissError'
  }
}

let activeUserId: string | null = null
let activeAccessToken: string | null = null

export async function canReachSupabase(timeoutMs = 1_500) {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return false
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined
  if (!url || !key) return false
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    await fetch(`${url}/auth/v1/health`, {
      headers: { apikey: key },
      cache: 'no-store',
      signal: controller.signal,
    })
    return true
  } catch {
    return false
  } finally {
    window.clearTimeout(timeout)
  }
}

export function setOfflineUserId(userId: string | null) {
  activeUserId = userId
}

export function setOfflineAccessToken(accessToken: string | null) {
  activeAccessToken = accessToken
}

export function currentAccessToken() {
  return activeAccessToken
}

export function isNetworkError(error: unknown) {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true
  const message = error instanceof Error ? error.message.toLowerCase() : ''
  return message.includes('fetch')
    || message.includes('network')
    || message.includes('load failed')
    || message.includes('failed to fetch')
    || message.includes('abort')
    || message.includes('timeout')
}

function networkWithCachedFallback<T>(request: Promise<T>, hasCache: boolean) {
  if (!hasCache) return request
  return Promise.race([
    request,
    new Promise<T>((_, reject) => {
      window.setTimeout(() => reject(new Error('Network timeout while cached data is available.')), 1_500)
    }),
  ])
}

export async function currentUserId() {
  if (activeUserId) return activeUserId
  const cachedUser = localStorage.getItem('kitchen-offline-user-v1')
  if (cachedUser) {
    try {
      const parsed = JSON.parse(cachedUser) as { id?: unknown }
      if (typeof parsed.id === 'string') {
        activeUserId = parsed.id
        return activeUserId
      }
    } catch {
      localStorage.removeItem('kitchen-offline-user-v1')
    }
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) return null
  const { data } = await supabase.auth.getSession()
  activeUserId = data.session?.user.id ?? null
  return activeUserId
}

export async function cachedContext(
  userId: string,
  remote: () => Promise<HouseholdContext | null>,
) {
  const cached = await readLatestContext<HouseholdContext>(userId)
  if (typeof navigator === 'undefined' || navigator.onLine) {
    try {
      const value = await networkWithCachedFallback(remote(), Boolean(cached))
      if (!value) {
        await clearOfflineUser(userId)
        return null
      }
      await saveSnapshot(userId, value.household.id, 'context', value)
      return value
    } catch (error) {
      if (!isNetworkError(error)) throw error
    }
  }
  if (!cached) throw new OfflineCacheMissError()
  return cached
}

export async function cachedCollection<T>(
  householdId: string,
  collection: SnapshotCollection,
  remote: () => Promise<T>,
): Promise<T> {
  const userId = await currentUserId()
  if (!userId) throw new Error('You must be signed in.')
  let base = await readSnapshot<T>(userId, householdId, collection)
  if (typeof navigator === 'undefined' || navigator.onLine) {
    try {
      base = await networkWithCachedFallback(remote(), base !== null)
      await saveSnapshot(userId, householdId, collection, base)
    } catch (error) {
      if (!isNetworkError(error)) throw error
    }
  }
  if (base === null) throw new OfflineCacheMissError()
  return base
}

export async function projectedInventory(householdId: string, base: InventoryItem[]) {
  const userId = await currentUserId()
  if (!userId) return base
  const [operations, categories, locations] = await Promise.all([
    listOperations(userId, householdId),
    readSnapshot<Category[]>(userId, householdId, 'categories'),
    readSnapshot<StorageLocation[]>(userId, householdId, 'locations'),
  ])
  return projectInventory(base, operations, categories ?? [], locations ?? [])
}

export async function projectedGroceries(householdId: string, base: GroceryItem[]) {
  const userId = await currentUserId()
  if (!userId) return base
  const [operations, categories, inventoryBase, locations] = await Promise.all([
    listOperations(userId, householdId),
    readSnapshot<Category[]>(userId, householdId, 'categories'),
    readSnapshot<InventoryItem[]>(userId, householdId, 'inventory'),
    readSnapshot<StorageLocation[]>(userId, householdId, 'locations'),
  ])
  const inventory = projectInventory(inventoryBase ?? [], operations, categories ?? [], locations ?? [])
  return projectGroceries(base, operations, categories ?? [], inventory)
}

export function pendingStatus(operations: OfflineOperation[], entityId: string) {
  return operations.find((operation) => operation.entity_id === entityId)?.status
}
