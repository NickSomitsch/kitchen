import { describe, expect, it } from 'vitest'
import type { InventoryFilters, InventoryItem, Unit } from '../types/database'
import {
  convertQuantity,
  filterAndSortInventory,
  findDuplicate,
  formatJoinCode,
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
    created_by: 'user-1',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    version: 1,
    category: null,
    location: null,
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

  it('sorts every supported field and direction deterministically', () => {
    expect(filterAndSortInventory(inventory, emptyFilters, { field: 'name', direction: 'desc' })[0].name).toBe('Milk')
    expect(filterAndSortInventory(inventory, emptyFilters, { field: 'category', direction: 'asc' })[0].name).toBe('Eggs')
    expect(filterAndSortInventory(inventory, emptyFilters, { field: 'location', direction: 'asc' })[0].name).toBe('Basmati rice')
    expect(filterAndSortInventory(inventory, emptyFilters, { field: 'updated_at', direction: 'asc' })).toHaveLength(3)
    expect(filterAndSortInventory(inventory, emptyFilters, { field: 'quantity', direction: 'asc' }).map((entry) => entry.name)).toEqual(['Basmati rice', 'Milk', 'Eggs'])
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

