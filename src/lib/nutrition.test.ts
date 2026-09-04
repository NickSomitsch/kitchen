import { describe, expect, it } from 'vitest'
import { hasNutrition, itemEnergy, nutritionFromForm, nutritionToForm } from './nutrition'
import type { Nutrition } from '../types/database'

const panel: Nutrition = {
  basis: 'g', per: 100, energy_kcal: 539, fat: 30.9, saturated_fat: 10.6,
  carbohydrates: 57.5, sugars: 56.3, fibre: null, proteins: 6.3, salt: 0.11,
  serving_size: '15 g', nutriscore: 'e', source: 'openfoodfacts',
  updated_at: '2026-09-01T00:00:00Z',
}

describe('nutrition editing', () => {
  it('round-trips an unchanged panel and keeps its origin', () => {
    const restored = nutritionFromForm(nutritionToForm(panel), panel)
    expect(restored).toEqual(panel)
    expect(restored?.source).toBe('openfoodfacts')
    expect(restored?.updated_at).toBe(panel.updated_at)
  })

  it('marks an edited panel as the household’s own', () => {
    const form = { ...nutritionToForm(panel), salt: '0.5' }
    const edited = nutritionFromForm(form, panel)
    expect(edited?.salt).toBe(0.5)
    expect(edited?.source).toBe('manual')
    expect(edited?.updated_at).not.toBe(panel.updated_at)
    expect(edited?.nutriscore).toBe('e')
  })

  it('drops an entirely empty panel', () => {
    expect(nutritionFromForm(nutritionToForm(null), null)).toBeNull()
  })

  it('keeps a panel that only carries a serving size', () => {
    const form = { ...nutritionToForm(null), serving_size: '30 g' }
    expect(nutritionFromForm(form, null)?.serving_size).toBe('30 g')
  })

  it('defaults the basis from the item unit when no panel exists', () => {
    expect(nutritionToForm(null, 'l').basis).toBe('ml')
    expect(nutritionToForm(null, 'kg').basis).toBe('g')
    expect(nutritionToForm(null).basis).toBe('g')
  })

  it('knows when a panel has nothing worth showing', () => {
    expect(hasNutrition(panel)).toBe(true)
    expect(hasNutrition(null)).toBe(false)
    expect(hasNutrition({ ...panel, energy_kcal: null, fat: null, saturated_fat: null,
      carbohydrates: null, sugars: null, proteins: null, salt: null })).toBe(false)
  })

  it('estimates energy for a whole item only across comparable units', () => {
    expect(itemEnergy(400, 'g', panel)).toBe(2156)
    expect(itemEnergy(0.4, 'kg', panel)).toBe(2156)
    expect(itemEnergy(2, 'piece', panel)).toBeNull()
    expect(itemEnergy(1, 'l', { ...panel, basis: 'ml' })).toBe(5390)
    expect(itemEnergy(400, 'g', null)).toBeNull()
  })
})
