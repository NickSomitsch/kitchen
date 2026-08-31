import { z } from 'zod'

const trimmedText = (minimum: number, maximum: number, label: string) =>
  z
    .string()
    .trim()
    .min(minimum, `${label} is required.`)
    .max(maximum, `${label} must be ${maximum} characters or fewer.`)

export const authSchema = z.object({
  displayName: z.string().trim().max(80).optional(),
  email: z.email('Enter a valid email address.'),
  password: z.string().min(8, 'Password must be at least 8 characters.'),
})

const inventoryQuantity = z
  .number({ error: 'Enter a quantity.' })
  .finite()
  .min(0, 'Quantity cannot be negative.')
  .max(999_999_999.999, 'Quantity is too large.')
  .refine(
    (value) => Math.abs(value * 1000 - Math.round(value * 1000)) < Number.EPSILON * 1000,
    'Use no more than three decimal places.',
  )

export const itemSchema = z.object({
  name: trimmedText(1, 120, 'Name'),
  quantity: inventoryQuantity,
  unit: z.enum(['g', 'kg', 'ml', 'l', 'piece', 'package']),
  categoryId: z.string(),
  locationId: z.string(),
  notes: z.string().max(500, 'Notes must be 500 characters or fewer.'),
  lowStockEnabled: z.boolean(),
  lowStockThreshold: inventoryQuantity,
}).superRefine((value, context) => {
  if (value.lowStockEnabled && !Number.isFinite(value.lowStockThreshold)) {
    context.addIssue({
      code: 'custom',
      path: ['lowStockThreshold'],
      message: 'Enter a low-stock threshold.',
    })
  }
})

const optionalPositiveQuantity = z.string().trim().refine((value) => {
  if (!value) return true
  if (!/^\d+(\.\d{1,3})?$/.test(value)) return false
  const quantity = Number(value)
  return quantity > 0 && quantity <= 999_999_999.999
}, 'Enter a positive quantity with no more than three decimal places.')

export const groceryItemSchema = z.object({
  inventoryItemId: z.string(),
  name: trimmedText(1, 120, 'Name'),
  quantity: optionalPositiveQuantity,
  unit: z.enum(['g', 'kg', 'ml', 'l', 'piece', 'package']),
  categoryId: z.string(),
  notes: z.string().max(500, 'Notes must be 500 characters or fewer.'),
})

export const purchaseSchema = z.object({
  stockAction: z.enum(['none', 'existing', 'new']),
  quantity: optionalPositiveQuantity,
  unit: z.enum(['g', 'kg', 'ml', 'l', 'piece', 'package']),
  targetInventoryItemId: z.string(),
  locationId: z.string(),
}).superRefine((value, context) => {
  if (value.stockAction !== 'none' && !value.quantity) {
    context.addIssue({ code: 'custom', path: ['quantity'], message: 'Enter the purchased quantity.' })
  }
  if (value.stockAction === 'existing' && !value.targetInventoryItemId) {
    context.addIssue({ code: 'custom', path: ['targetInventoryItemId'], message: 'Choose an inventory item.' })
  }
})

export const householdNameSchema = trimmedText(1, 80, 'Household name')
export const taxonomyNameSchema = trimmedText(1, 60, 'Name')

export type ItemFormValues = z.infer<typeof itemSchema>
export type GroceryItemFormValues = z.infer<typeof groceryItemSchema>
export type PurchaseFormValues = z.infer<typeof purchaseSchema>
