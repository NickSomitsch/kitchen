import { isExpiringSoon } from './expiry'
import { convertQuantity } from './inventory'
import type {
  Household,
  IngredientMatch,
  InventoryItem,
  Recipe,
  RecipeFilters,
  RecipeIngredientRow,
  RecipeMatch,
  RecipeSortField,
} from '../types/database'

export const MEAL_SLOTS = [
  { value: 'breakfast', label: 'Breakfast' },
  { value: 'lunch', label: 'Lunch' },
  { value: 'dinner', label: 'Dinner' },
  { value: 'snack', label: 'Snack' },
] as const

export const RECIPE_TAG_SUGGESTIONS = [
  'vegetarian', 'vegan', 'quick', 'batch cook', 'one pot', 'freezer friendly',
  'breakfast', 'lunch', 'dinner', 'dessert', 'comfort food', 'high protein',
]

function normalize(value: string) {
  return value.trim().toLocaleLowerCase()
}

/**
 * Mirrors `public.match_inventory_item`: an explicit link wins, otherwise the
 * ingredient name is compared to inventory names ignoring case and padding.
 */
export function matchInventoryItem(
  ingredient: Pick<RecipeIngredientRow, 'name' | 'inventory_item_id'>,
  inventory: InventoryItem[],
) {
  if (ingredient.inventory_item_id) {
    const linked = inventory.find((item) => item.id === ingredient.inventory_item_id)
    if (linked) return linked
  }
  const name = normalize(ingredient.name)
  const candidates = inventory.filter((item) => normalize(item.name) === name)
  if (!candidates.length) return null
  return [...candidates].sort((left, right) => right.quantity - left.quantity)[0]
}

export function matchIngredient(
  ingredient: RecipeIngredientRow,
  inventory: InventoryItem[],
  scale = 1,
): IngredientMatch {
  const item = matchInventoryItem(ingredient, inventory)
  if (!item || item.quantity <= 0) {
    return { ingredient, coverage: 'missing', item, shortfall: null, incomparable: false }
  }
  if (ingredient.quantity === null || ingredient.unit === null) {
    // Without a stated amount, anything on hand counts as covered.
    return { ingredient, coverage: 'stocked', item, shortfall: null, incomparable: false }
  }
  const needed = ingredient.quantity * scale
  const available = convertQuantity(item.quantity, item.unit, ingredient.unit)
  if (available === null) {
    // Pieces cannot be weighed against grams; report it rather than guess.
    return { ingredient, coverage: 'stocked', item, shortfall: null, incomparable: true }
  }
  if (available >= needed) {
    return { ingredient, coverage: 'stocked', item, shortfall: null, incomparable: false }
  }
  return {
    ingredient,
    coverage: 'short',
    item,
    shortfall: Math.round((needed - available) * 1000) / 1000,
    incomparable: false,
  }
}

function findConflicts(recipe: Recipe, avoid: string[]) {
  const terms = avoid.map(normalize).filter(Boolean)
  if (!terms.length) return []
  const haystacks = recipe.ingredients.map((ingredient) => normalize(ingredient.name))
  return terms.filter((term) => haystacks.some((name) => name.includes(term)))
}

export function totalMinutes(recipe: Pick<Recipe, 'prep_minutes' | 'cook_minutes'>) {
  if (recipe.prep_minutes === null && recipe.cook_minutes === null) return null
  return (recipe.prep_minutes ?? 0) + (recipe.cook_minutes ?? 0)
}

export interface MatchOptions {
  servings?: number | null
  avoidIngredients?: string[]
  dietTags?: string[]
  today?: Date
}

/**
 * Scores a recipe against what is actually in the kitchen. The headline number is
 * plain ingredient coverage; the bonuses only break ties between close matches.
 */
export function matchRecipe(
  recipe: Recipe,
  inventory: InventoryItem[],
  options: MatchOptions = {},
): RecipeMatch {
  const today = options.today ?? new Date()
  const scale = options.servings
    ? options.servings / Math.max(recipe.servings, 1)
    : 1
  const matches = recipe.ingredients.map((ingredient) => matchIngredient(ingredient, inventory, scale))
  const requiredMatches = matches.filter((match) => !match.ingredient.optional)
  const required = requiredMatches.length
  const covered = requiredMatches.filter((match) => match.coverage === 'stocked').length
  const coverage = required ? covered / required : 1

  const rescues = matches
    .filter((match) => match.item && match.coverage !== 'missing' && isExpiringSoon(match.item, today))
    .map((match) => match.item as InventoryItem)
  const conflicts = findConflicts(recipe, options.avoidIngredients ?? [])
  const minutes = totalMinutes(recipe)

  // Coverage is the headline number, out of 100. Bonuses only break ties between
  // close matches, and a conflict is heavy enough to always sort last.
  let score = coverage * 100
  score += Math.min(rescues.length * 6, 18)
  if (recipe.is_favorite) score += 4
  if (minutes !== null && minutes <= 30) score += 3
  const dietTags = (options.dietTags ?? []).map(normalize)
  if (dietTags.length && recipe.tags.some((tag) => dietTags.includes(normalize(tag)))) score += 5
  if (recipe.last_cooked_at) {
    const daysSince = (today.getTime() - new Date(recipe.last_cooked_at).getTime()) / 86_400_000
    if (daysSince < 7) score -= 5
  }
  if (conflicts.length) score -= 1000

  return {
    recipe,
    matches,
    required,
    covered,
    coverage,
    rescues,
    totalMinutes: minutes,
    conflicts,
    score: Math.round(score * 100) / 100,
  }
}

export const emptyRecipeFilters: RecipeFilters = {
  search: '',
  tags: [],
  maxMinutes: null,
  favoritesOnly: false,
  readyOnly: false,
  hideConflicts: true,
}

export function rankRecipes(
  recipes: Recipe[],
  inventory: InventoryItem[],
  filters: RecipeFilters,
  sort: RecipeSortField,
  household?: Pick<Household, 'avoid_ingredients' | 'diet_tags'>,
  today = new Date(),
): RecipeMatch[] {
  const search = normalize(filters.search)
  const scored = recipes.map((recipe) => matchRecipe(recipe, inventory, {
    avoidIngredients: household?.avoid_ingredients ?? [],
    dietTags: household?.diet_tags ?? [],
    today,
  }))

  const visible = scored.filter((match) => {
    const { recipe } = match
    if (search) {
      const haystack = [
        recipe.name,
        recipe.description ?? '',
        ...recipe.tags,
        ...recipe.ingredients.map((ingredient) => ingredient.name),
      ].join(' ').toLocaleLowerCase()
      if (!haystack.includes(search)) return false
    }
    if (filters.tags.length && !filters.tags.every((tag) => recipe.tags.includes(tag))) return false
    if (filters.favoritesOnly && !recipe.is_favorite) return false
    if (filters.readyOnly && match.coverage < 1) return false
    if (filters.hideConflicts && match.conflicts.length) return false
    if (filters.maxMinutes !== null) {
      if (match.totalMinutes === null || match.totalMinutes > filters.maxMinutes) return false
    }
    return true
  })

  return visible.sort((left, right) => {
    switch (sort) {
      case 'name':
        return left.recipe.name.localeCompare(right.recipe.name, undefined, { sensitivity: 'base' })
      case 'time': {
        const leftTime = left.totalMinutes ?? Number.MAX_SAFE_INTEGER
        const rightTime = right.totalMinutes ?? Number.MAX_SAFE_INTEGER
        return leftTime - rightTime
          || left.recipe.name.localeCompare(right.recipe.name, undefined, { sensitivity: 'base' })
      }
      case 'recent':
        return new Date(right.recipe.updated_at).getTime() - new Date(left.recipe.updated_at).getTime()
      case 'match':
      default:
        return right.score - left.score
          || left.recipe.name.localeCompare(right.recipe.name, undefined, { sensitivity: 'base' })
    }
  })
}

/** The ingredients a shopping trip would need to cover, in list order. */
export function missingIngredients(match: RecipeMatch) {
  return match.matches.filter(
    (entry) => entry.coverage === 'missing' || entry.coverage === 'short',
  )
}

export function coverageLabel(match: RecipeMatch) {
  if (!match.required) return 'No required ingredients'
  if (match.covered === match.required) {
    return `All ${match.required} ingredient${match.required === 1 ? '' : 's'} in stock`
  }
  return `${match.covered} of ${match.required} ingredients in stock`
}

export function collectTags(recipes: Recipe[]) {
  const counts = new Map<string, number>()
  for (const recipe of recipes) {
    for (const tag of recipe.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([tag]) => tag)
}
