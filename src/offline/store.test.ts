import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import type { InventoryItem, OfflineOperation } from '../types/database'
import { applyConflictDraft } from './sync'
import {
  CACHE_MAX_AGE,
  enqueueOperation,
  isSnapshotFresh,
  listOperations,
  offlineDb,
  projectInventory,
} from './store'

const baseItem: InventoryItem = {
  id: 'item-1', household_id: 'house-1', name: 'Rice', quantity: 1, unit: 'kg',
  category_id: null, location_id: null, notes: null, low_stock_threshold: null,
  barcode: null, brand: null, image_url: null, nutrition: null, expires_on: null,
  created_by: 'user-1', created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z', version: 1, category: null, location: null,
}

function operation(overrides: Partial<OfflineOperation>): OfflineOperation {
  return {
    id: crypto.randomUUID(), user_id: 'user-1', household_id: 'house-1',
    kind: 'inventory.update', entity_type: 'inventory', entity_id: 'item-1',
    payload: {
      id: 'item-1', expected_version: 1, name: 'Rice', quantity: 2, unit: 'kg',
      category_id: null, location_id: null, notes: null, low_stock_threshold: null,
    },
    status: 'pending', created_at: new Date().toISOString(), attempts: 0,
    error_code: null, error_message: null, latest: null, ...overrides,
  }
}

beforeEach(async () => {
  await offlineDb.snapshots.clear()
  await offlineDb.operations.clear()
})

describe('offline snapshots and projections', () => {
  it('expires snapshots after seven days', () => {
    const now = Date.now()
    expect(isSnapshotFresh(now - CACHE_MAX_AGE, now)).toBe(true)
    expect(isSnapshotFresh(now - CACHE_MAX_AGE - 1, now)).toBe(false)
  })

  it('projects edits, purchases, and deletes in order', () => {
    const edited = operation({})
    const purchased = operation({
      kind: 'grocery.complete', entity_type: 'grocery', entity_id: 'grocery-1',
      payload: {
        id: 'grocery-1', expected_version: 1, stock_action: 'existing', quantity: 500,
        unit: 'g', target_inventory_item_id: 'item-1', linked_inventory_item_id: 'item-1',
      },
    })
    const result = projectInventory([baseItem], [edited, purchased])
    expect(result[0].quantity).toBe(2.5)
    expect(result[0].local_sync_status).toBe('pending')
    expect(projectInventory([baseItem], [operation({ kind: 'inventory.delete' })])).toEqual([])
  })

  it('coalesces create-edit and cancels create-delete', async () => {
    const created = operation({
      kind: 'inventory.create', entity_id: 'new-item',
      payload: { id: 'new-item', name: 'Beans', quantity: 1, unit: 'package', category_id: null, location_id: null, notes: null, low_stock_threshold: null },
    })
    await enqueueOperation(created)
    await enqueueOperation(operation({
      kind: 'inventory.update', entity_id: 'new-item',
      payload: { id: 'new-item', expected_version: 1, name: 'Black beans', quantity: 2, unit: 'package', category_id: null, location_id: null, notes: null, low_stock_threshold: null },
    }))
    expect((await listOperations('user-1', 'house-1'))[0].payload.name).toBe('Black beans')
    await enqueueOperation(operation({
      kind: 'inventory.delete', entity_id: 'new-item',
      payload: { id: 'new-item', expected_version: 1 },
    }))
    expect(await listOperations('user-1', 'house-1')).toEqual([])
  })

  it('keeps operations isolated by user', async () => {
    await enqueueOperation(operation({}))
    await enqueueOperation(operation({ id: crypto.randomUUID(), user_id: 'user-2' }))
    expect(await listOperations('user-1')).toHaveLength(1)
    expect(await listOperations('user-2')).toHaveLength(1)
  })

  it('reapplies a conflicting draft against the latest version', async () => {
    const conflict = operation({
      status: 'conflict',
      latest: { id: 'item-1', name: 'Server rice', quantity: 3, unit: 'kg', version: 4 },
    })
    await offlineDb.operations.add(conflict)
    await applyConflictDraft(conflict)
    const [resolved] = await listOperations('user-1')
    expect(resolved.status).toBe('pending')
    expect(resolved.payload.expected_version).toBe(4)
    expect(resolved.latest).toBeNull()
  })

  it('resolves a delete conflict when the server record is already gone', async () => {
    const conflict = operation({ kind: 'inventory.delete', status: 'conflict', latest: null })
    await offlineDb.operations.add(conflict)
    await applyConflictDraft(conflict)
    expect(await listOperations('user-1')).toEqual([])
  })
})
