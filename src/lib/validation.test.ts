import { describe, expect, it } from 'vitest'
import { itemSchema } from './validation'

const validItem = {
  name: 'Flour',
  quantity: 1.25,
  unit: 'kg' as const,
  categoryId: '',
  locationId: '',
  notes: '',
}

describe('item validation', () => {
  it('accepts zero and three decimal places', () => {
    expect(itemSchema.safeParse({ ...validItem, quantity: 0 }).success).toBe(true)
    expect(itemSchema.safeParse({ ...validItem, quantity: 1.234 }).success).toBe(true)
  })

  it('rejects negative, over-precise, and oversized quantities', () => {
    expect(itemSchema.safeParse({ ...validItem, quantity: -1 }).success).toBe(false)
    expect(itemSchema.safeParse({ ...validItem, quantity: 1.2345 }).success).toBe(false)
    expect(itemSchema.safeParse({ ...validItem, quantity: 1_000_000_000 }).success).toBe(false)
  })

  it('rejects blank names and long notes', () => {
    expect(itemSchema.safeParse({ ...validItem, name: '   ' }).success).toBe(false)
    expect(itemSchema.safeParse({ ...validItem, notes: 'x'.repeat(501) }).success).toBe(false)
  })
})

