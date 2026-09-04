import type { NutritionFormValues } from './validation'
import type { Nutrition, Unit } from '../types/database'

export const NUTRIENT_FIELDS = [
  { key: 'energy_kcal', label: 'Energy', suffix: 'kcal' },
  { key: 'fat', label: 'Fat', suffix: 'g' },
  { key: 'saturated_fat', label: 'of which saturates', suffix: 'g' },
  { key: 'carbohydrates', label: 'Carbohydrate', suffix: 'g' },
  { key: 'sugars', label: 'of which sugars', suffix: 'g' },
  { key: 'fibre', label: 'Fibre', suffix: 'g' },
  { key: 'proteins', label: 'Protein', suffix: 'g' },
  { key: 'salt', label: 'Salt', suffix: 'g' },
] as const

export type NutrientKey = (typeof NUTRIENT_FIELDS)[number]['key']

function toField(value: number | null) {
  return value === null || value === undefined ? '' : String(value)
}

export function nutritionToForm(
  nutrition: Nutrition | null,
  unit?: Unit,
): NutritionFormValues {
  const basis = nutrition?.basis ?? (unit === 'ml' || unit === 'l' ? 'ml' : 'g')
  return {
    basis,
    energy_kcal: toField(nutrition?.energy_kcal ?? null),
    fat: toField(nutrition?.fat ?? null),
    saturated_fat: toField(nutrition?.saturated_fat ?? null),
    carbohydrates: toField(nutrition?.carbohydrates ?? null),
    sugars: toField(nutrition?.sugars ?? null),
    fibre: toField(nutrition?.fibre ?? null),
    proteins: toField(nutrition?.proteins ?? null),
    salt: toField(nutrition?.salt ?? null),
    serving_size: nutrition?.serving_size ?? '',
  }
}

function toNumber(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Turns the editable fields back into a stored panel. Editing any value marks the
 * panel as the household's own, because it no longer matches the community record.
 */
export function nutritionFromForm(
  values: NutritionFormValues,
  previous: Nutrition | null,
): Nutrition | null {
  const numbers = {
    energy_kcal: toNumber(values.energy_kcal),
    fat: toNumber(values.fat),
    saturated_fat: toNumber(values.saturated_fat),
    carbohydrates: toNumber(values.carbohydrates),
    sugars: toNumber(values.sugars),
    fibre: toNumber(values.fibre),
    proteins: toNumber(values.proteins),
    salt: toNumber(values.salt),
  }
  const servingSize = values.serving_size.trim() || null
  if (Object.values(numbers).every((value) => value === null) && !servingSize) return null

  const unchanged = previous
    && (Object.keys(numbers) as NutrientKey[]).every((key) => (previous[key] ?? null) === numbers[key])
    && (previous.serving_size ?? null) === servingSize
    && previous.basis === values.basis

  return {
    ...numbers,
    basis: values.basis,
    per: 100,
    serving_size: servingSize,
    nutriscore: previous?.nutriscore ?? null,
    source: unchanged ? (previous?.source ?? 'manual') : 'manual',
    updated_at: unchanged && previous ? previous.updated_at : new Date().toISOString(),
  }
}

export function formatNutrient(value: number | null, suffix: string) {
  if (value === null) return '—'
  return `${new Intl.NumberFormat('en', { maximumFractionDigits: 2 }).format(value)} ${suffix}`
}

export function hasNutrition(nutrition: Nutrition | null): nutrition is Nutrition {
  if (!nutrition) return false
  return NUTRIENT_FIELDS.some((field) => nutrition[field.key] !== null)
}

/** Rough energy for a whole item, when the unit can be compared to the panel's basis. */
export function itemEnergy(
  quantity: number,
  unit: Unit,
  nutrition: Nutrition | null,
): number | null {
  if (!nutrition || nutrition.energy_kcal === null) return null
  const base = nutrition.basis === 'ml'
    ? unit === 'ml' ? quantity : unit === 'l' ? quantity * 1000 : null
    : unit === 'g' ? quantity : unit === 'kg' ? quantity * 1000 : null
  if (base === null) return null
  return Math.round((base / nutrition.per) * nutrition.energy_kcal)
}
