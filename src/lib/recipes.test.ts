import { describe, expect, it } from 'vitest'
import {
  coverageLabel,
  emptyRecipeFilters,
  matchIngredient,
  matchInventoryItem,
  matchRecipe,
  missingIngredients,
  rankRecipes,
  totalMinutes,
} from './recipes'
import type {
  InventoryItem,
  Recipe,
  RecipeIngredientRow,
  Unit,
} from '../types/database'

const today = new Date(2026, 8, 4)

function item(
  name: string,
  quantity: number,
  unit: Unit,
  overrides: Partial<InventoryItem> = {},
): InventoryItem {
  return {
    id: `item-${name}`, household_id: 'house-1', name, quantity, unit,
    category_id: null, location_id: null, notes: null, low_stock_threshold: null,
    barcode: null, brand: null, image_url: null, nutrition: null, expires_on: null,
    created_by: 'user-1', created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z', version: 1, category: null, location: null,
    ...overrides,
  }
}

function ingredient(
  name: string,
  quantity: number | null,
  unit: Unit | null,
  overrides: Partial<RecipeIngredientRow> = {},
): RecipeIngredientRow {
  return {
    id: `ing-${name}`, household_id: 'house-1', recipe_id: 'recipe-1',
    inventory_item_id: null, name, quantity, unit, optional: false, position: 0,
    created_at: '2026-01-01T00:00:00Z', ...overrides,
  }
}

function recipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: 'recipe-1', household_id: 'house-1', name: 'Tomato pasta',
    description: null, instructions: null, servings: 2,
    prep_minutes: 10, cook_minutes: 15, source_url: null, image_url: null,
    tags: [], is_favorite: false, last_cooked_at: null, created_by: 'user-1',
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', version: 1,
    ingredients: [ingredient('Pasta', 200, 'g'), ingredient('Tomatoes', 400, 'g')],
    ...overrides,
  }
}

describe('ingredient matching', () => {
  it('prefers an explicit link, then falls back to the name', () => {
    const linked = item('Penne', 1, 'kg', { id: 'linked' })
    const named = item('Pasta', 500, 'g')
    const inventory = [linked, named]
    expect(matchInventoryItem({ name: 'Pasta', inventory_item_id: 'linked' }, inventory)?.id)
      .toBe('linked')
    expect(matchInventoryItem({ name: '  pasta ', inventory_item_id: null }, inventory)?.id)
      .toBe(named.id)
    expect(matchInventoryItem({ name: 'Basil', inventory_item_id: null }, inventory)).toBeNull()
  })

  it('picks the fullest item when several share a name', () => {
    const inventory = [
      item('Rice', 200, 'g', { id: 'small' }),
      item('Rice', 900, 'g', { id: 'big' }),
    ]
    expect(matchInventoryItem({ name: 'Rice', inventory_item_id: null }, inventory)?.id).toBe('big')
  })

  it('converts across compatible units before comparing', () => {
    const match = matchIngredient(ingredient('Pasta', 200, 'g'), [item('Pasta', 1, 'kg')])
    expect(match.coverage).toBe('stocked')
  })

  it('reports the shortfall in the ingredient unit', () => {
    const match = matchIngredient(ingredient('Pasta', 500, 'g'), [item('Pasta', 0.2, 'kg')])
    expect(match.coverage).toBe('short')
    expect(match.shortfall).toBe(300)
  })

  it('counts an unmeasurable pairing as stocked but flags it', () => {
    const match = matchIngredient(ingredient('Tomatoes', 400, 'g'), [item('Tomatoes', 3, 'piece')])
    expect(match.coverage).toBe('stocked')
    expect(match.incomparable).toBe(true)
  })

  it('treats an empty item as missing', () => {
    expect(matchIngredient(ingredient('Pasta', 200, 'g'), [item('Pasta', 0, 'g')]).coverage)
      .toBe('missing')
  })

  it('counts any amount as enough when the recipe states none', () => {
    expect(matchIngredient(ingredient('Salt', null, null), [item('Salt', 5, 'g')]).coverage)
      .toBe('stocked')
  })

  it('scales the requirement with the serving count', () => {
    const single = matchIngredient(ingredient('Pasta', 200, 'g'), [item('Pasta', 300, 'g')], 1)
    const double = matchIngredient(ingredient('Pasta', 200, 'g'), [item('Pasta', 300, 'g')], 2)
    expect(single.coverage).toBe('stocked')
    expect(double.coverage).toBe('short')
    expect(double.shortfall).toBe(100)
  })
})

describe('recipe scoring', () => {
  it('reports coverage over required ingredients only', () => {
    const match = matchRecipe(
      recipe({
        ingredients: [
          ingredient('Pasta', 200, 'g'),
          ingredient('Tomatoes', 400, 'g'),
          ingredient('Basil', 5, 'g', { id: 'basil', optional: true }),
        ],
      }),
      [item('Pasta', 500, 'g')],
      { today },
    )
    expect(match.required).toBe(2)
    expect(match.covered).toBe(1)
    expect(match.coverage).toBe(0.5)
    expect(coverageLabel(match)).toBe('1 of 2 ingredients in stock')
  })

  it('reads naturally for a single ingredient', () => {
    const single = matchRecipe(
      recipe({ ingredients: [ingredient('Pasta', 200, 'g')] }),
      [item('Pasta', 500, 'g')],
      { today },
    )
    expect(coverageLabel(single)).toBe('All 1 ingredient in stock')
  })

  it('rewards recipes that use up items nearing their date', () => {
    const expiring = [
      item('Pasta', 500, 'g'),
      item('Tomatoes', 500, 'g', { expires_on: '2026-09-06' }),
    ]
    const fresh = [item('Pasta', 500, 'g'), item('Tomatoes', 500, 'g')]
    const withRescue = matchRecipe(recipe(), expiring, { today })
    const without = matchRecipe(recipe(), fresh, { today })
    expect(withRescue.rescues).toHaveLength(1)
    expect(withRescue.score).toBeGreaterThan(without.score)
  })

  it('flags and sinks recipes containing an avoided ingredient', () => {
    const match = matchRecipe(recipe(), [item('Pasta', 500, 'g'), item('Tomatoes', 500, 'g')], {
      avoidIngredients: ['tomato'],
      today,
    })
    expect(match.conflicts).toEqual(['tomato'])
    expect(match.score).toBeLessThan(0)
  })

  it('adds prep and cook time together', () => {
    expect(totalMinutes({ prep_minutes: 10, cook_minutes: 15 })).toBe(25)
    expect(totalMinutes({ prep_minutes: null, cook_minutes: 15 })).toBe(15)
    expect(totalMinutes({ prep_minutes: null, cook_minutes: null })).toBeNull()
  })

  it('lists what a shopping trip would still need', () => {
    const match = matchRecipe(recipe(), [item('Pasta', 100, 'g')], { today })
    expect(missingIngredients(match).map((entry) => entry.ingredient.name))
      .toEqual(['Pasta', 'Tomatoes'])
  })
})

describe('ranking and filtering', () => {
  const stocked = recipe({ id: 'stocked', name: 'Ready pasta' })
  const empty = recipe({
    id: 'empty',
    name: 'Aubergine bake',
    prep_minutes: 30,
    cook_minutes: 45,
    tags: ['dinner'],
    ingredients: [ingredient('Aubergine', 2, 'piece', { id: 'aubergine' })],
  })
  const inventory = [item('Pasta', 500, 'g'), item('Tomatoes', 500, 'g')]

  it('puts the best-covered recipe first', () => {
    const ranked = rankRecipes([empty, stocked], inventory, emptyRecipeFilters, 'match', undefined, today)
    expect(ranked.map((match) => match.recipe.id)).toEqual(['stocked', 'empty'])
  })

  it('can show only what is cookable right now', () => {
    const ranked = rankRecipes(
      [empty, stocked], inventory,
      { ...emptyRecipeFilters, readyOnly: true }, 'match', undefined, today,
    )
    expect(ranked.map((match) => match.recipe.id)).toEqual(['stocked'])
  })

  it('filters on total time and searches ingredients too', () => {
    const quick = rankRecipes(
      [empty, stocked], inventory,
      { ...emptyRecipeFilters, maxMinutes: 30 }, 'match', undefined, today,
    )
    expect(quick.map((match) => match.recipe.id)).toEqual(['stocked'])

    const searched = rankRecipes(
      [empty, stocked], inventory,
      { ...emptyRecipeFilters, search: 'aubergine' }, 'match', undefined, today,
    )
    expect(searched.map((match) => match.recipe.id)).toEqual(['empty'])
  })

  it('hides conflicting recipes by default and shows them on request', () => {
    const household = { avoid_ingredients: ['tomatoes'], diet_tags: [] }
    expect(rankRecipes([stocked], inventory, emptyRecipeFilters, 'match', household, today))
      .toHaveLength(0)
    expect(rankRecipes(
      [stocked], inventory,
      { ...emptyRecipeFilters, hideConflicts: false }, 'match', household, today,
    )).toHaveLength(1)
  })

  it('sorts by name and by time when asked', () => {
    expect(rankRecipes([stocked, empty], inventory, emptyRecipeFilters, 'name', undefined, today)
      .map((match) => match.recipe.name)).toEqual(['Aubergine bake', 'Ready pasta'])
    expect(rankRecipes([empty, stocked], inventory, emptyRecipeFilters, 'time', undefined, today)
      .map((match) => match.recipe.id)).toEqual(['stocked', 'empty'])
  })
})
