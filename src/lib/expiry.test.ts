import { describe, expect, it } from 'vitest'
import {
  daysUntil,
  expiringItems,
  expiryState,
  formatExpiry,
  isExpiringSoon,
  parseLocalDate,
  toDateInput,
} from './expiry'
import type { InventoryItem } from '../types/database'

const today = new Date(2026, 8, 4)

function item(expiresOn: string | null, overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id: expiresOn ?? 'none', household_id: 'house-1', name: 'Milk', quantity: 1, unit: 'l',
    category_id: null, location_id: null, notes: null, low_stock_threshold: null,
    barcode: null, brand: null, image_url: null, nutrition: null, expires_on: expiresOn,
    created_by: 'user-1', created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z', version: 1, category: null, location: null,
    ...overrides,
  }
}

describe('expiry dates', () => {
  it('reads a date column as a local day, not a UTC instant', () => {
    const parsed = parseLocalDate('2026-09-04')
    expect(parsed?.getFullYear()).toBe(2026)
    expect(parsed?.getMonth()).toBe(8)
    expect(parsed?.getDate()).toBe(4)
    expect(toDateInput(parsed!)).toBe('2026-09-04')
  })

  it('counts whole days in both directions', () => {
    expect(daysUntil('2026-09-04', today)).toBe(0)
    expect(daysUntil('2026-09-07', today)).toBe(3)
    expect(daysUntil('2026-09-01', today)).toBe(-3)
    expect(daysUntil('not-a-date', today)).toBeNull()
  })

  it('classifies each date against the use-soon window', () => {
    expect(expiryState(item(null), today)).toBe('none')
    expect(expiryState(item('2026-09-01'), today)).toBe('expired')
    expect(expiryState(item('2026-09-04'), today)).toBe('today')
    expect(expiryState(item('2026-09-09'), today)).toBe('soon')
    expect(expiryState(item('2026-09-10'), today)).toBe('later')
  })

  it('treats expired, today, and soon as needing attention', () => {
    expect(isExpiringSoon(item('2026-09-01'), today)).toBe(true)
    expect(isExpiringSoon(item('2026-09-09'), today)).toBe(true)
    expect(isExpiringSoon(item('2026-09-10'), today)).toBe(false)
    expect(isExpiringSoon(item(null), today)).toBe(false)
  })

  it('lists what needs eating soonest first and skips empty items', () => {
    const items = [
      item('2026-09-09', { id: 'soon' }),
      item('2026-09-01', { id: 'expired' }),
      item('2026-12-01', { id: 'later' }),
      item('2026-09-02', { id: 'empty', quantity: 0 }),
      item(null, { id: 'undated' }),
    ]
    expect(expiringItems(items, today).map((entry) => entry.id)).toEqual(['expired', 'soon'])
  })

  it('describes nearby dates in words', () => {
    expect(formatExpiry('2026-09-04', today)).toBe('Today')
    expect(formatExpiry('2026-09-05', today)).toBe('Tomorrow')
    expect(formatExpiry('2026-09-03', today)).toBe('Yesterday')
    expect(formatExpiry('2026-08-30', today)).toBe('5 days ago')
    expect(formatExpiry('2026-09-14', today)).toBe('In 10 days')
    expect(formatExpiry('2027-03-01', today)).toMatch(/Mar.*2027/)
  })
})
