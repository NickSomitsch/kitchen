import { describe, expect, it } from 'vitest'
import { groceryItemSchema, itemSchema, purchaseSchema } from './validation'

const validItem = {
  name: 'Flour',
  quantity: 1.25,
  unit: 'kg' as const,
  categoryId: '',
  locationId: '',
  notes: '',
  lowStockEnabled: false,
  lowStockThreshold: 0,
  expiresOn: '',
  barcode: '',
  brand: '',
  imageUrl: '',
  nutrition: {
    basis: 'g' as const,
    energy_kcal: '',
    fat: '',
    saturated_fat: '',
    carbohydrates: '',
    sugars: '',
    fibre: '',
    proteins: '',
    salt: '',
    serving_size: '',
  },
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

describe('grocery validation', () => {
  const grocery = {
    inventoryItemId: '',
    name: 'Olive oil',
    quantity: '',
    unit: 'l' as const,
    categoryId: '',
    notes: '',
  }

  it('allows an omitted amount and validates positive three-decimal quantities', () => {
    expect(groceryItemSchema.safeParse(grocery).success).toBe(true)
    expect(groceryItemSchema.safeParse({ ...grocery, quantity: '1.125' }).success).toBe(true)
    expect(groceryItemSchema.safeParse({ ...grocery, quantity: '0' }).success).toBe(false)
    expect(groceryItemSchema.safeParse({ ...grocery, quantity: '1.2345' }).success).toBe(false)
  })

  it('requires purchase details only when stocking inventory', () => {
    expect(purchaseSchema.safeParse({ stockAction: 'none', quantity: '', unit: 'piece', targetInventoryItemId: '', locationId: '', expiresOn: '' }).success).toBe(true)
    expect(purchaseSchema.safeParse({ stockAction: 'existing', quantity: '', unit: 'piece', targetInventoryItemId: '', locationId: '', expiresOn: '' }).success).toBe(false)
    expect(purchaseSchema.safeParse({ stockAction: 'new', quantity: '2', unit: 'piece', targetInventoryItemId: '', locationId: '', expiresOn: '' }).success).toBe(true)
  })
})
