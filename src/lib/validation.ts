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

export const itemSchema = z.object({
  name: trimmedText(1, 120, 'Name'),
  quantity: z
    .number({ error: 'Enter a quantity.' })
    .finite()
    .min(0, 'Quantity cannot be negative.')
    .max(999_999_999.999, 'Quantity is too large.')
    .refine(
      (value) => Math.abs(value * 1000 - Math.round(value * 1000)) < Number.EPSILON * 1000,
      'Use no more than three decimal places.',
    ),
  unit: z.enum(['g', 'kg', 'ml', 'l', 'piece', 'package']),
  categoryId: z.string(),
  locationId: z.string(),
  notes: z.string().max(500, 'Notes must be 500 characters or fewer.'),
})

export const householdNameSchema = trimmedText(1, 80, 'Household name')
export const taxonomyNameSchema = trimmedText(1, 60, 'Name')

export type ItemFormValues = z.infer<typeof itemSchema>

