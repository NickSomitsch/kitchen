import type { Json, OfflineOperation, OfflineOperationKind } from '../types/database'
import { canReachSupabase, currentAccessToken, currentUserId, isNetworkError } from './cache'
import {
  enqueueOperation,
  listOperations,
  offlineEvents,
  removeOperation,
  updateOperation,
} from './store'

class CommandError extends Error {
  code: string
  latest: Record<string, Json> | null

  constructor(code: string, message: string, latest: Record<string, Json> | null = null) {
    super(message)
    this.code = code
    this.latest = latest
  }
}

function apiConfiguration() {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined
  const token = currentAccessToken()
  if (!url || !key || !token) throw new Error('Your session must be refreshed before synchronization.')
  return {
    url,
    headers: {
      apikey: key,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  }
}

async function responseJson(response: Response) {
  const body = await response.json().catch(() => null) as { code?: string; message?: string; details?: string } | Json
  if (!response.ok) {
    const error = body as { code?: string; message?: string; details?: string }
    let latest: Record<string, Json> | null = null
    if (error.details) {
      try {
        const parsed = JSON.parse(error.details) as Json
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) latest = parsed as Record<string, Json>
      } catch {
        // Error details from older deployments are plain text and remain optional.
      }
    }
    throw new CommandError(error.code ?? String(response.status), error.message ?? 'Synchronization failed.', latest)
  }
  return body as Json
}

export async function queueCommand(
  householdId: string,
  kind: OfflineOperationKind,
  entityId: string,
  payload: Record<string, Json>,
) {
  const userId = await currentUserId()
  if (!userId) throw new Error('You must be signed in.')
  const operation: OfflineOperation = {
    id: crypto.randomUUID(),
    user_id: userId,
    household_id: householdId,
    kind,
    entity_type: kind.startsWith('inventory.') ? 'inventory' : 'grocery',
    entity_id: entityId,
    payload,
    status: 'pending',
    created_at: new Date().toISOString(),
    attempts: 0,
    error_code: null,
    error_message: null,
    latest: null,
  }
  await enqueueOperation(operation)
  offlineEvents.dispatchEvent(new Event('sync-request'))
  return operation
}

async function fetchLatest(operation: OfflineOperation) {
  const table = operation.entity_type === 'inventory' ? 'inventory_items' : 'grocery_items'
  const api = apiConfiguration()
  const controller = new AbortController()
  const abortTimeout = window.setTimeout(() => controller.abort(), 4_000)
  let hardTimeout: number | null = null
  try {
    const request = fetch(
      `${api.url}/rest/v1/${table}?id=eq.${encodeURIComponent(operation.entity_id)}&select=*`,
      { headers: api.headers, cache: 'no-store', signal: controller.signal },
    ).then(responseJson)
    const data = await Promise.race([
      request,
      new Promise<never>((_, reject) => {
        hardTimeout = window.setTimeout(() => reject(new Error('Latest record network timeout.')), 5_000)
      }),
    ])
    const rows = Array.isArray(data) ? data : []
    const latest = rows[0]
    return latest && typeof latest === 'object' && !Array.isArray(latest)
      ? latest as Record<string, Json>
      : null
  } finally {
    window.clearTimeout(abortTimeout)
    if (hardTimeout !== null) window.clearTimeout(hardTimeout)
  }
}

async function execute(operation: OfflineOperation) {
  const api = apiConfiguration()
  const controller = new AbortController()
  const abortTimeout = window.setTimeout(() => controller.abort(), 4_000)
  let hardTimeout: number | null = null
  try {
    const request = fetch(`${api.url}/rest/v1/rpc/apply_kitchen_command_v2`, {
      method: 'POST',
      headers: api.headers,
      cache: 'no-store',
      signal: controller.signal,
      body: JSON.stringify({
        operation_id: operation.id,
        command_type: operation.kind,
        request: operation.payload,
      }),
    }).then(responseJson)
    const data = await Promise.race([
      request,
      new Promise<never>((_, reject) => {
        hardTimeout = window.setTimeout(() => reject(new Error('Command network timeout.')), 5_000)
      }),
    ])
    return data
  } finally {
    window.clearTimeout(abortTimeout)
    if (hardTimeout !== null) window.clearTimeout(hardTimeout)
  }
}

async function updateDependentVersions(
  completed: OfflineOperation,
  result: Json,
) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return
  const resultObject = result as Record<string, Json>
  const operations = await listOperations(completed.user_id, completed.household_id)
  const entityVersion = resultObject.version
  if (typeof entityVersion === 'number') {
    for (const operation of operations) {
      if (operation.id === completed.id || operation.status !== 'pending') continue
      if (operation.entity_type === completed.entity_type && operation.entity_id === completed.entity_id) {
        await updateOperation(operation.id, {
          payload: { ...operation.payload, expected_version: entityVersion },
        })
      }
    }
  }
  const inventoryId = resultObject.inventory_item_id
  const inventoryVersion = resultObject.inventory_version
  if (typeof inventoryId === 'string' && typeof inventoryVersion === 'number') {
    for (const operation of operations) {
      if (operation.status !== 'pending') continue
      if (operation.entity_type === 'inventory' && operation.entity_id === inventoryId) {
        await updateOperation(operation.id, {
          payload: { ...operation.payload, expected_version: inventoryVersion },
        })
      }
    }
  }
}

let activeSync: Promise<void> | null = null
let retryTimer: number | null = null

function scheduleSyncRetry() {
  if (retryTimer !== null) return
  retryTimer = window.setTimeout(() => {
    retryTimer = null
    offlineEvents.dispatchEvent(new Event('sync-request'))
  }, 3_000)
}

export function syncPendingOperations(userId: string) {
  if (activeSync) return activeSync
  activeSync = runSync(userId).finally(() => {
    activeSync = null
    offlineEvents.dispatchEvent(new Event('change'))
  })
  return activeSync
}

async function runSync(userId: string) {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    scheduleSyncRetry()
    return
  }
  if (!await canReachSupabase()) {
    scheduleSyncRetry()
    return
  }
  const operations = await listOperations(userId)
  const blockedEntities = new Set(
    operations
      .filter((operation) => operation.status === 'conflict' || operation.status === 'failed')
      .map((operation) => `${operation.entity_type}:${operation.entity_id}`),
  )

  for (const operation of operations) {
    if (operation.status === 'conflict' || operation.status === 'failed') continue
    const entityKey = `${operation.entity_type}:${operation.entity_id}`
    if (blockedEntities.has(entityKey)) continue
    await updateOperation(operation.id, {
      status: 'syncing',
      attempts: operation.attempts + 1,
      error_code: null,
      error_message: null,
    })
    try {
      const result = await execute(operation)
      await updateDependentVersions(operation, result)
      await removeOperation(operation.id)
    } catch (error) {
      const code = error instanceof CommandError ? error.code : ''
      if (code === '40001' || code === 'PT409' || code === 'P0002') {
        await updateOperation(operation.id, {
          status: 'conflict',
          error_code: code,
          error_message: error instanceof Error ? error.message : 'This item changed.',
          latest: error instanceof CommandError ? error.latest : null,
        })
        blockedEntities.add(entityKey)
        if (error instanceof CommandError && error.latest) continue
        try {
          const latest = await fetchLatest(operation)
          await updateOperation(operation.id, { latest })
        } catch {
          // The conflict remains reviewable; a later retry can fetch the latest record.
        }
        continue
      }
      if (isNetworkError(error)) {
        await updateOperation(operation.id, { status: 'pending' })
        scheduleSyncRetry()
        break
      }
      await updateOperation(operation.id, {
        status: 'failed',
        error_code: code || 'unknown',
        error_message: error instanceof Error ? error.message : 'The change could not be synchronized.',
      })
      blockedEntities.add(entityKey)
    }
  }
}

export async function retryOperation(operation: OfflineOperation) {
  await updateOperation(operation.id, {
    status: 'pending',
    error_code: null,
    error_message: null,
    latest: null,
  })
  offlineEvents.dispatchEvent(new Event('sync-request'))
}

export async function applyConflictDraft(operation: OfflineOperation) {
  if (!operation.latest) {
    if (operation.kind !== 'inventory.update' && operation.kind !== 'grocery.update') {
      await removeOperation(operation.id)
      return
    }
    const createKind = operation.entity_type === 'inventory' ? 'inventory.create' : 'grocery.create'
    await removeOperation(operation.id)
    await queueCommand(
      operation.household_id,
      createKind,
      operation.entity_id,
      { ...operation.payload, id: operation.entity_id },
    )
    return
  }
  const latestVersion = operation.latest.version
  await updateOperation(operation.id, {
    payload: { ...operation.payload, expected_version: latestVersion },
    status: 'pending',
    error_code: null,
    error_message: null,
    latest: null,
  })
  offlineEvents.dispatchEvent(new Event('sync-request'))
}
