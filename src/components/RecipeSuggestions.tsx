import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CalendarClock, Check, Clock, Minus, Plus, Sparkles, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import { RecognitionUnavailableError, queryKeys, saveRecipe, suggestRecipes } from '../api/kitchen'
import { getErrorMessage } from '../lib/errors'
import { coverageLabel, matchRecipe } from '../lib/recipes'
import type {
  Household,
  InventoryItem,
  Recipe,
  RecipeSuggestion,
  SuggestionResult,
} from '../types/database'
import { Button, ErrorNotice } from './ui'

/**
 * Shapes a suggestion like a saved recipe so the ordinary matcher can score it.
 * The model proposes the dish; coverage is measured here against real inventory.
 */
function asRecipe(suggestion: RecipeSuggestion, index: number): Recipe {
  const now = new Date().toISOString()
  return {
    id: `suggestion-${index}`,
    household_id: 'suggestion',
    name: suggestion.name,
    description: suggestion.description,
    instructions: suggestion.instructions,
    servings: suggestion.servings,
    prep_minutes: suggestion.prep_minutes,
    cook_minutes: suggestion.cook_minutes,
    source_url: null,
    image_url: null,
    tags: suggestion.tags,
    is_favorite: false,
    last_cooked_at: null,
    created_by: null,
    created_at: now,
    updated_at: now,
    version: 1,
    ingredients: suggestion.ingredients.map((ingredient, position) => ({
      id: `suggestion-${index}-${position}`,
      household_id: 'suggestion',
      recipe_id: `suggestion-${index}`,
      inventory_item_id: null,
      name: ingredient.name,
      quantity: ingredient.quantity,
      unit: ingredient.unit,
      optional: ingredient.optional,
      position,
      created_at: now,
    })),
  }
}

export function RecipeSuggestions({
  householdId,
  inventory,
  household,
  onSaved,
}: {
  householdId: string
  inventory: InventoryItem[]
  household: Household
  onSaved: () => void
}) {
  const queryClient = useQueryClient()
  const [servings, setServings] = useState(2)
  const [note, setNote] = useState('')
  const [result, setResult] = useState<SuggestionResult | null>(null)
  const [saved, setSaved] = useState<Set<string>>(new Set())
  const [unavailable, setUnavailable] = useState('')

  const ask = useMutation({
    mutationFn: () => suggestRecipes(servings, note),
    onSuccess: (value) => {
      setResult(value)
      setSaved(new Set())
      setUnavailable('')
    },
    onError: (error) => {
      if (error instanceof RecognitionUnavailableError) setUnavailable(error.message)
      setResult(null)
    },
  })

  const keep = useMutation({
    mutationFn: (suggestion: RecipeSuggestion) => saveRecipe({
      name: suggestion.name,
      description: suggestion.description,
      instructions: suggestion.instructions,
      servings: suggestion.servings,
      prep_minutes: suggestion.prep_minutes,
      cook_minutes: suggestion.cook_minutes,
      source_url: null,
      image_url: null,
      tags: suggestion.tags,
      ingredients: suggestion.ingredients.map((ingredient) => ({
        name: ingredient.name,
        quantity: ingredient.quantity,
        unit: ingredient.unit,
        optional: ingredient.optional,
        inventory_item_id: null,
      })),
    }),
    onSuccess: (_data, suggestion) => {
      setSaved((current) => new Set(current).add(suggestion.name))
      void queryClient.invalidateQueries({ queryKey: queryKeys.recipes(householdId) })
      onSaved()
    },
  })

  // Every number shown here is measured locally against the real inventory.
  const scored = useMemo(
    () => (result?.suggestions ?? []).map((suggestion, index) => ({
      suggestion,
      match: matchRecipe(asRecipe(suggestion, index), inventory, {
        avoidIngredients: household.avoid_ingredients,
        dietTags: household.diet_tags,
      }),
    })),
    [result, inventory, household],
  )

  const stocked = inventory.filter((item) => item.quantity > 0).length

  return (
    <section className="suggestions">
      <header className="suggestions-head">
        <div>
          <h2><Sparkles size={18} /> What can I cook?</h2>
          <p>
            Built from the {stocked} {stocked === 1 ? 'item' : 'items'} you have on hand,
            favouring anything close to its date. Nothing is saved until you keep it.
          </p>
        </div>
        <div className="suggestions-controls">
          <div className="servings-stepper">
            <button type="button" aria-label="Fewer servings" onClick={() => setServings((v) => Math.max(1, v - 1))}>
              <Minus size={16} />
            </button>
            <span><strong>{servings}</strong> {servings === 1 ? 'person' : 'people'}</span>
            <button type="button" aria-label="More servings" onClick={() => setServings((v) => Math.min(12, v + 1))}>
              <Plus size={16} />
            </button>
          </div>
          <Button busy={ask.isPending} onClick={() => ask.mutate()}>
            <Sparkles size={17} /> {result ? 'Suggest again' : 'Suggest meals'}
          </Button>
        </div>
      </header>

      <input
        className="suggestions-note"
        value={note}
        maxLength={200}
        placeholder="Anything specific? e.g. something quick, no oven, use up the spinach"
        aria-label="Extra instructions for the suggestions"
        onChange={(event) => setNote(event.target.value)}
      />

      {unavailable ? (
        <div className="notice notice-warning" role="alert">
          <div><strong>Suggestions are not set up</strong><p>{unavailable}</p></div>
        </div>
      ) : ask.isError && !unavailable ? (
        <ErrorNotice message={getErrorMessage(ask.error)} onRetry={() => ask.mutate()} />
      ) : null}

      {result?.notice ? <p className="scan-notice">{result.notice}</p> : null}
      {keep.isError ? <ErrorNotice message={getErrorMessage(keep.error)} /> : null}

      {ask.isPending ? (
        <div className="inventory-skeleton" aria-label="Thinking about your kitchen"><span /><span /></div>
      ) : null}

      {scored.length ? (
        <ul className="suggestion-list">
          {scored.map(({ suggestion, match }) => {
            const isSaved = saved.has(suggestion.name)
            return (
              <li key={suggestion.name} className={match.conflicts.length ? 'has-conflict' : ''}>
                <div className="suggestion-body">
                  <div className="suggestion-title">
                    <strong>{suggestion.name}</strong>
                    <span className="recipe-card-meta">
                      {match.totalMinutes !== null ? <><Clock size={13} /> {match.totalMinutes} min · </> : null}
                      <Users size={13} /> {suggestion.servings}
                    </span>
                  </div>
                  {suggestion.description ? <p>{suggestion.description}</p> : null}
                  <p className="suggestion-coverage">
                    <Check size={13} /> {coverageLabel(match)}
                    {match.rescues.length ? (
                      <span className="recipe-card-rescue">
                        <CalendarClock size={13} /> uses {match.rescues.map((item) => item.name).join(', ')}
                      </span>
                    ) : null}
                  </p>
                  <p className="suggestion-ingredients">
                    {suggestion.ingredients.map((ingredient) => ingredient.name).join(' · ')}
                  </p>
                </div>
                <Button
                  variant={isSaved ? 'ghost' : 'secondary'}
                  disabled={isSaved}
                  busy={keep.isPending && keep.variables?.name === suggestion.name}
                  onClick={() => keep.mutate(suggestion)}
                >
                  {isSaved ? <><Check size={16} /> Kept</> : 'Keep it'}
                </Button>
              </li>
            )
          })}
        </ul>
      ) : null}
    </section>
  )
}
