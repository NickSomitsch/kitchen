import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  CalendarPlus,
  ChefHat,
  Check,
  Clock,
  ExternalLink,
  Heart,
  Minus,
  Pencil,
  Plus,
  ShoppingCart,
  Trash2,
  Users,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import {
  addRecipeToGroceries,
  logRecipeCooked,
  queryKeys,
  setRecipeFavorite,
} from '../api/kitchen'
import { RecipeArt } from './RecipeArt'
import { getErrorMessage } from '../lib/errors'
import { formatExpiry } from '../lib/expiry'
import { formatQuantity } from '../lib/inventory'
import { coverageLabel, matchRecipe, missingIngredients } from '../lib/recipes'
import type { Household, IngredientMatch, InventoryItem, Recipe } from '../types/database'
import { Button, ErrorNotice } from './ui'

function ingredientAmount(match: IngredientMatch, scale: number) {
  const { quantity, unit } = match.ingredient
  if (quantity === null || unit === null) return 'as needed'
  return formatQuantity(Math.round(quantity * scale * 1000) / 1000, unit)
}

function coverageNote(match: IngredientMatch) {
  if (match.coverage === 'missing') return 'Not in stock'
  if (match.coverage === 'short' && match.shortfall !== null && match.ingredient.unit) {
    return `Short ${formatQuantity(match.shortfall, match.ingredient.unit)}`
  }
  if (match.incomparable && match.item) {
    return `${formatQuantity(match.item.quantity, match.item.unit)} on hand — amount not comparable`
  }
  return match.item ? `${formatQuantity(match.item.quantity, match.item.unit)} on hand` : 'In stock'
}

export function RecipeDetail({
  householdId,
  recipe,
  inventory,
  household,
  onEdit,
  onDelete,
  onPlan,
}: {
  householdId: string
  recipe: Recipe
  inventory: InventoryItem[]
  household: Household
  onEdit: () => void
  onDelete: () => void
  onPlan: (recipe: Recipe, servings: number) => void
}) {
  const queryClient = useQueryClient()
  const [servings, setServings] = useState(recipe.servings)
  const [outcome, setOutcome] = useState('')
  const [consume, setConsume] = useState(true)

  const match = useMemo(
    () => matchRecipe(recipe, inventory, {
      servings,
      avoidIngredients: household.avoid_ingredients,
      dietTags: household.diet_tags,
    }),
    [recipe, inventory, servings, household],
  )
  const scale = servings / Math.max(recipe.servings, 1)
  const missing = missingIngredients(match)

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: queryKeys.recipes(householdId) })
    void queryClient.invalidateQueries({ queryKey: queryKeys.inventory(householdId) })
    void queryClient.invalidateQueries({ queryKey: queryKeys.groceries(householdId) })
  }

  const shop = useMutation({
    mutationFn: () => addRecipeToGroceries(recipe.id, servings),
    onSuccess: (result) => {
      setOutcome(
        result.added
          ? `Added ${result.added} ${result.added === 1 ? 'item' : 'items'} to the grocery list.`
          : 'Everything is already in stock or on the list.',
      )
      refresh()
    },
  })

  const cook = useMutation({
    mutationFn: () => logRecipeCooked(recipe.id, servings, consume),
    onSuccess: (result) => {
      setOutcome(
        consume
          ? `Cooked. ${result.deducted} ${result.deducted === 1 ? 'ingredient was' : 'ingredients were'} taken out of inventory${result.unmatched ? `, ${result.unmatched} could not be matched` : ''}.`
          : 'Marked as cooked.',
      )
      refresh()
    },
  })

  const favorite = useMutation({
    mutationFn: () => setRecipeFavorite(recipe.id, !recipe.is_favorite),
    onSuccess: refresh,
  })

  const error = shop.error ?? cook.error ?? favorite.error

  return (
    <div className="recipe-detail">
      {match.conflicts.length ? (
        <div className="notice notice-warning" role="alert">
          <AlertTriangle size={18} />
          <div>
            <strong>Contains something your household avoids</strong>
            <p>Matches: {match.conflicts.join(', ')}.</p>
          </div>
        </div>
      ) : null}

      <header className="recipe-detail-head">
        {recipe.image_url ? (
          <img src={recipe.image_url} alt="" loading="lazy" referrerPolicy="no-referrer" />
        ) : (
          <RecipeArt
            className="recipe-detail-art"
            name={recipe.name}
            tags={recipe.tags}
            ingredients={recipe.ingredients.map((ingredient) => ingredient.name)}
          />
        )}
        <div>
          {recipe.description ? <p className="recipe-description">{recipe.description}</p> : null}
          <ul className="recipe-facts">
            <li><Users size={15} /> Serves {recipe.servings}</li>
            {match.totalMinutes !== null ? <li><Clock size={15} /> {match.totalMinutes} min</li> : null}
            {recipe.last_cooked_at ? (
              <li><ChefHat size={15} /> Last cooked {new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short' }).format(new Date(recipe.last_cooked_at))}</li>
            ) : null}
            {recipe.source_url ? (
              <li>
                <a href={recipe.source_url} target="_blank" rel="noreferrer noopener">
                  <ExternalLink size={15} /> Source
                </a>
              </li>
            ) : null}
          </ul>
          {recipe.tags.length ? (
            <ul className="tag-list">
              {recipe.tags.map((tag) => <li key={tag}><span className="soft-chip">{tag}</span></li>)}
            </ul>
          ) : null}
        </div>
      </header>

      <section className="coverage-panel">
        <div className="coverage-headline">
          <div
            className="coverage-ring"
            style={{ '--coverage': `${Math.round(match.coverage * 100)}` } as React.CSSProperties}
            role="img"
            aria-label={coverageLabel(match)}
          >
            <span>{Math.round(match.coverage * 100)}%</span>
          </div>
          <div>
            <strong>{coverageLabel(match)}</strong>
            {match.rescues.length ? (
              <p className="rescue-line">
                Uses {match.rescues.length} {match.rescues.length === 1 ? 'item' : 'items'} nearing
                its date: {match.rescues.map((item) => item.name).join(', ')}.
              </p>
            ) : (
              <p className="muted-line">Scaled for {servings} {servings === 1 ? 'serving' : 'servings'}.</p>
            )}
          </div>
        </div>
        <div className="servings-stepper">
          <button type="button" aria-label="Fewer servings" onClick={() => setServings((value) => Math.max(1, value - 1))}>
            <Minus size={16} />
          </button>
          <span><strong>{servings}</strong> servings</span>
          <button type="button" aria-label="More servings" onClick={() => setServings((value) => Math.min(100, value + 1))}>
            <Plus size={16} />
          </button>
        </div>
      </section>

      <ul className="ingredient-check">
        {match.matches.map((entry) => (
          <li key={entry.ingredient.id} className={`coverage-${entry.coverage}`}>
            <span className="coverage-mark" aria-hidden="true">
              {entry.coverage === 'stocked' ? <Check size={14} /> : entry.coverage === 'short' ? <Minus size={14} /> : <Plus size={14} />}
            </span>
            <span className="ingredient-line">
              <strong>{entry.ingredient.name}</strong>
              {entry.ingredient.optional ? <small className="soft-chip">optional</small> : null}
              <span>{ingredientAmount(entry, scale)}</span>
            </span>
            <span className="coverage-note">
              {coverageNote(entry)}
              {entry.item?.expires_on ? ` · ${formatExpiry(entry.item.expires_on)}` : ''}
            </span>
          </li>
        ))}
      </ul>

      {recipe.instructions ? (
        <section className="recipe-method">
          <h3>Method</h3>
          <p>{recipe.instructions}</p>
        </section>
      ) : null}

      {outcome ? <div className="notice notice-success" role="status"><p>{outcome}</p></div> : null}
      {error ? <ErrorNotice message={getErrorMessage(error)} /> : null}

      <label className="check-row consume-toggle">
        <input type="checkbox" checked={consume} onChange={(event) => setConsume(event.target.checked)} />
        <span>
          <strong>Take ingredients out of inventory when cooked</strong>
          <small>Matched amounts are subtracted, which can trigger your low-stock rules.</small>
        </span>
      </label>

      <div className="recipe-actions">
        <Button variant="ghost" onClick={() => favorite.mutate()} busy={favorite.isPending}>
          <Heart size={17} fill={recipe.is_favorite ? 'currentColor' : 'none'} />
          {recipe.is_favorite ? 'Favourited' : 'Favourite'}
        </Button>
        <Button variant="ghost" onClick={onEdit}><Pencil size={17} /> Edit</Button>
        <Button variant="ghost" className="danger-text" onClick={onDelete}><Trash2 size={17} /> Delete</Button>
        <div className="toolbar-spacer" />
        <Button variant="secondary" onClick={() => onPlan(recipe, servings)}>
          <CalendarPlus size={17} /> Plan it
        </Button>
        <Button
          variant="secondary"
          busy={shop.isPending}
          disabled={!missing.length}
          onClick={() => shop.mutate()}
        >
          <ShoppingCart size={17} />
          {missing.length ? `Shop ${missing.length} missing` : 'Nothing missing'}
        </Button>
        <Button busy={cook.isPending} onClick={() => cook.mutate()}>
          <ChefHat size={17} /> Cooked it
        </Button>
      </div>
    </div>
  )
}
