import { describe, expect, it } from 'vitest'
import type { GroceryItem, InventoryFilters, InventoryItem, Unit } from '../types/database'
import {
  convertQuantity,
  filterAndSortInventory,
  findDuplicate,
  findGroceryDuplicate,
  formatJoinCode,
  groupActiveGroceries,
  isLowStock,
  normalizedQuantity,
} from './inventory'

function item(
  id: string,
  name: string,
  quantity: number,
  unit: Unit,
  overrides: Partial<InventoryItem> = {},
): InventoryItem {
  return {
    id,
    household_id: 'household-1',
    name,
    quantity,
    unit,
    category_id: null,
    location_id: null,
    notes: null,
    low_stock_threshold: null,
    created_by: 'user-1',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    version: 1,
    category: null,
    location: null,
    ...overrides,
  }
}

function grocery(id: string, name: string, overrides: Partial<GroceryItem> = {}): GroceryItem {
  return {
    id,
    household_id: 'household-1',
    inventory_item_id: null,
    name,
    quantity: null,
    unit: null,
    category_id: null,
    notes: null,
    source: 'manual',
    status: 'active',
    stocked: false,
    created_by: 'user-1',
    completed_by: null,
    completed_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    version: 1,
    category: null,
    inventory_item: null,
    ...overrides,
  }
}

const emptyFilters: InventoryFilters = {
  search: '',
  categoryIds: [],
  locationIds: [],
  units: [],
  stock: 'all',
}

describe('quantity conversion', () => {
  it.each([
    [1000, 'g', 'kg', 1],
    [1.25, 'kg', 'g', 1250],
    [750, 'ml', 'l', 0.75],
    [2, 'l', 'ml', 2000],
  ] as const)('converts %s %s to %s', (amount, from, to, expected) => {
    expect(convertQuantity(amount, from, to)).toBe(expected)
  })

  it('rejects incompatible conversions', () => {
    expect(convertQuantity(2, 'piece', 'package')).toBeNull()
    expect(convertQuantity(2, 'kg', 'l')).toBeNull()
  })

  it('normalizes compatible quantities', () => {
    expect(normalizedQuantity(item('1', 'Flour', 1, 'kg'))).toEqual({ group: 0, quantity: 1000 })
    expect(normalizedQuantity(item('2', 'Milk', 1.5, 'l'))).toEqual({ group: 1, quantity: 1500 })
  })
})

describe('inventory search and filters', () => {
  const inventory = [
    item('1', 'Basmati rice', 1, 'kg', {
      category_id: 'pantry',
      location_id: 'cupboard',
      notes: 'Long grain',
      category: { id: 'pantry', name: 'Pantry' },
      location: { id: 'cupboard', name: 'Cupboard' },
    }),
    item('2', 'Milk', 0, 'l', {
      category_id: 'dairy',
      location_id: 'fridge',
      category: { id: 'dairy', name: 'Dairy' },
      location: { id: 'fridge', name: 'Fridge' },
    }),
    item('3', 'Eggs', 6, 'piece', {
      category_id: 'dairy',
      location_id: 'fridge',
      notes: 'Free range',
      category: { id: 'dairy', name: 'Dairy' },
      location: { id: 'fridge', name: 'Fridge' },
    }),
  ]

  it('searches names and notes case-insensitively', () => {
    expect(filterAndSortInventory(inventory, { ...emptyFilters, search: 'LONG' }, { field: 'name', direction: 'asc' }).map((entry) => entry.name)).toEqual(['Basmati rice'])
  })

  it('combines category, location, unit, and stock filters', () => {
    const result = filterAndSortInventory(
      inventory,
      {
        search: '',
        categoryIds: ['dairy'],
        locationIds: ['fridge'],
        units: ['piece'],
        stock: 'in-stock',
      },
      { field: 'name', direction: 'asc' },
    )
    expect(result.map((entry) => entry.name)).toEqual(['Eggs'])
  })

  it('keeps and filters zero-stock items', () => {
    const result = filterAndSortInventory(inventory, { ...emptyFilters, stock: 'out-of-stock' }, { field: 'name', direction: 'asc' })
    expect(result.map((entry) => entry.name)).toEqual(['Milk'])
  })

  it('identifies and filters configured low stock, including zero thresholds', () => {
    const configured = item('4', 'Oil', 0, 'l', { low_stock_threshold: 0 })
    expect(isLowStock(configured)).toBe(true)
    expect(isLowStock(item('5', 'Salt', 0, 'g'))).toBe(false)
    const result = filterAndSortInventory([...inventory, configured], { ...emptyFilters, stock: 'low-stock' }, { field: 'name', direction: 'asc' })
    expect(result.map((entry) => entry.name)).toEqual(['Oil'])
  })

  it('sorts every supported field and direction deterministically', () => {
    expect(filterAndSortInventory(inventory, emptyFilters, { field: 'name', direction: 'desc' })[0].name).toBe('Milk')
    expect(filterAndSortInventory(inventory, emptyFilters, { field: 'category', direction: 'asc' })[0].name).toBe('Eggs')
    expect(filterAndSortInventory(inventory, emptyFilters, { field: 'location', direction: 'asc' })[0].name).toBe('Basmati rice')
    expect(filterAndSortInventory(inventory, emptyFilters, { field: 'updated_at', direction: 'asc' })).toHaveLength(3)
    expect(filterAndSortInventory(inventory, emptyFilters, { field: 'quantity', direction: 'asc' }).map((entry) => entry.name)).toEqual(['Basmati rice', 'Milk', 'Eggs'])
  })
})

describe('grocery helpers', () => {
  const groceries = [
    grocery('1', 'Milk', { category_id: 'dairy', category: { id: 'dairy', name: 'Dairy' } }),
    grocery('2', 'Apples', { category_id: 'produce', category: { id: 'produce', name: 'Produce' } }),
    grocery('3', 'Bananas', { category_id: 'produce', category: { id: 'produce', name: 'Produce' } }),
    grocery('4', 'Old bread', { status: 'purchased', completed_at: '2026-01-02T00:00:00Z', completed_by: 'user-1' }),
    grocery('5', 'Soap'),
  ]

  it('detects active free-form duplicates case-insensitively', () => {
    expect(findGroceryDuplicate(groceries, ' milk ')?.id).toBe('1')
    expect(findGroceryDuplicate(groceries, 'Old bread')).toBeUndefined()
  })

  it('groups active entries by category, sorts names, and puts uncategorized last', () => {
    const groups = groupActiveGroceries(groceries)
    expect(groups.map((group) => group.name)).toEqual(['Dairy', 'Produce', 'Uncategorized'])
    expect(groups[1].items.map((entry) => entry.name)).toEqual(['Apples', 'Bananas'])
  })
})

describe('duplicate and join-code helpers', () => {
  const inventory = [item('1', 'Brown rice', 500, 'g')]

  it('warns on normalized duplicate names while respecting exclusions', () => {
    expect(findDuplicate(inventory, '  BROWN RICE  ')?.id).toBe('1')
    expect(findDuplicate(inventory, 'Brown rice', '1')).toBeUndefined()
  })

  it('formats join codes for sharing', () => {
    expect(formatJoinCode('abcde fghij')).toBe('ABCDE-FGHIJ')
  })
})
