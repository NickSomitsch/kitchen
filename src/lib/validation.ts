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

/** A date input value: either empty, or a calendar day the database will accept. */
const optionalDate = z.string().trim().refine(
  (value) => !value || (/^\d{4}-\d{2}-\d{2}$/.test(value) && value >= '1900-01-01' && value <= '2200-01-01'),
  'Enter a valid date.',
)

const optionalNutrient = z.string().trim().refine((value) => {
  if (!value) return true
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return false
  return Number(value) <= 100_000
}, 'Enter a number with up to two decimal places.')

export const nutritionSchema = z.object({
  basis: z.enum(['g', 'ml']),
  energy_kcal: optionalNutrient,
  fat: optionalNutrient,
  saturated_fat: optionalNutrient,
  carbohydrates: optionalNutrient,
  sugars: optionalNutrient,
  fibre: optionalNutrient,
  proteins: optionalNutrient,
  salt: optionalNutrient,
  serving_size: z.string().trim().max(60, 'Serving size must be 60 characters or fewer.'),
})

export const itemSchema = z.object({
  name: trimmedText(1, 120, 'Name'),
  quantity: inventoryQuantity,
  unit: z.enum(['g', 'kg', 'ml', 'l', 'piece', 'package']),
  categoryId: z.string(),
  locationId: z.string(),
  notes: z.string().max(500, 'Notes must be 500 characters or fewer.'),
  lowStockEnabled: z.boolean(),
  lowStockThreshold: inventoryQuantity,
  expiresOn: optionalDate,
  barcode: z.string().trim().refine(
    (value) => !value || /^\d{6,14}$/.test(value),
    'A barcode is 6 to 14 digits.',
  ),
  brand: z.string().trim().max(120, 'Brand must be 120 characters or fewer.'),
  imageUrl: z.string().trim().max(500),
  nutrition: nutritionSchema,
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
  expiresOn: optionalDate,
}).superRefine((value, context) => {
  if (value.stockAction !== 'none' && !value.quantity) {
    context.addIssue({ code: 'custom', path: ['quantity'], message: 'Enter the purchased quantity.' })
  }
  if (value.stockAction === 'existing' && !value.targetInventoryItemId) {
    context.addIssue({ code: 'custom', path: ['targetInventoryItemId'], message: 'Choose an inventory item.' })
  }
})

const optionalMinutes = z.string().trim().refine((value) => {
  if (!value) return true
  if (!/^\d{1,4}$/.test(value)) return false
  return Number(value) <= 6000
}, 'Enter whole minutes up to 6000.')

export const recipeIngredientSchema = z.object({
  name: trimmedText(1, 120, 'Ingredient name'),
  quantity: optionalPositiveQuantity,
  unit: z.enum(['g', 'kg', 'ml', 'l', 'piece', 'package']),
  optional: z.boolean(),
  inventoryItemId: z.string(),
})

export const recipeSchema = z.object({
  name: trimmedText(1, 160, 'Recipe name'),
  description: z.string().max(1000, 'Description must be 1000 characters or fewer.'),
  instructions: z.string().max(20_000, 'Instructions must be 20000 characters or fewer.'),
  servings: z
    .number({ error: 'Enter the number of servings.' })
    .int('Servings must be a whole number.')
    .min(1, 'A recipe serves at least one.')
    .max(100, 'Servings must be 100 or fewer.'),
  prepMinutes: optionalMinutes,
  cookMinutes: optionalMinutes,
  sourceUrl: z.string().trim().max(500).refine(
    (value) => !value || /^https?:\/\/\S+$/.test(value),
    'Enter a link that starts with http:// or https://.',
  ),
  imageUrl: z.string().trim().max(500).refine(
    (value) => !value || /^https?:\/\/\S+$/.test(value),
    'Enter a link that starts with http:// or https://.',
  ),
  tags: z.array(z.string().trim().min(1).max(40)).max(20, 'Use 20 tags or fewer.'),
  ingredients: z.array(recipeIngredientSchema)
    .min(1, 'Add at least one ingredient.')
    .max(60, 'A recipe can hold at most 60 ingredients.'),
})

export const mealPlanEntrySchema = z.object({
  plannedOn: z.string().trim().min(1, 'Choose a date.'),
  slot: z.enum(['breakfast', 'lunch', 'dinner', 'snack']),
  recipeId: z.string(),
  title: z.string().trim().max(160, 'Title must be 160 characters or fewer.'),
  servings: z.string().trim().refine(
    (value) => !value || (/^\d{1,3}$/.test(value) && Number(value) >= 1 && Number(value) <= 100),
    'Servings must be between 1 and 100.',
  ),
  notes: z.string().max(500, 'Notes must be 500 characters or fewer.'),
}).superRefine((value, context) => {
  if (!value.recipeId && !value.title.trim()) {
    context.addIssue({ code: 'custom', path: ['title'], message: 'Choose a recipe or enter a title.' })
  }
})

export const householdNameSchema = trimmedText(1, 80, 'Household name')
export const taxonomyNameSchema = trimmedText(1, 60, 'Name')

export type ItemFormValues = z.infer<typeof itemSchema>
export type GroceryItemFormValues = z.infer<typeof groceryItemSchema>
export type PurchaseFormValues = z.infer<typeof purchaseSchema>
export type NutritionFormValues = z.infer<typeof nutritionSchema>
export type RecipeFormValues = z.infer<typeof recipeSchema>
export type RecipeIngredientFormValues = z.infer<typeof recipeIngredientSchema>
export type MealPlanEntryFormValues = z.infer<typeof mealPlanEntrySchema>
