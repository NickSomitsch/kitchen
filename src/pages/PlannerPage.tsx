import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CalendarDays,
  ChefHat,
  ChevronLeft,
  ChevronRight,
  Plus,
  ShoppingCart,
  Trash2,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { Navigate } from 'react-router-dom'
import {
  addMealPlanToGroceries,
  deleteMealPlanEntry,
  fetchInventory,
  fetchMealPlan,
  fetchRecipes,
  logRecipeCooked,
  queryKeys,
  saveMealPlanEntry,
} from '../api/kitchen'
import { AppShell } from '../components/AppShell'
import { Button, ErrorNotice, FieldError, LoadingScreen, Modal } from '../components/ui'
import { useHousehold } from '../hooks/useHousehold'
import { getErrorMessage } from '../lib/errors'
import { toDateInput } from '../lib/expiry'
import { MEAL_SLOTS, matchRecipe } from '../lib/recipes'
import { mealPlanEntrySchema, type MealPlanEntryFormValues } from '../lib/validation'
import type { MealPlanEntry, MealSlot, Recipe } from '../types/database'

function startOfWeek(date: Date) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  // Monday-first weeks, which is how most meal plans are written.
  const offset = (start.getDay() + 6) % 7
  start.setDate(start.getDate() - offset)
  return start
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

const dayLabel = new Intl.DateTimeFormat('en', { weekday: 'short' })
const dateLabel = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short' })
const rangeLabel = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'long' })

function EntryForm({
  recipes,
  entry,
  plannedOn,
  slot,
  onSubmit,
  onClose,
  busy,
  error,
}: {
  recipes: Recipe[]
  entry?: MealPlanEntry
  plannedOn: string
  slot: MealSlot
  onSubmit: (values: MealPlanEntryFormValues) => void
  onClose: () => void
  busy: boolean
  error: unknown
}) {
  const { register, control, handleSubmit, formState: { errors } } = useForm<MealPlanEntryFormValues>({
    resolver: zodResolver(mealPlanEntrySchema),
    defaultValues: {
      plannedOn: entry?.planned_on ?? plannedOn,
      slot: entry?.slot ?? slot,
      recipeId: entry?.recipe_id ?? '',
      title: entry?.title ?? '',
      servings: entry?.servings?.toString() ?? '',
      notes: entry?.notes ?? '',
    },
  })
  const recipeId = useWatch({ control, name: 'recipeId' })

  return (
    <form className="item-form" onSubmit={handleSubmit(onSubmit)}>
      <div className="form-grid two-columns">
        <label className="field">
          <span>Date <b aria-hidden="true">*</b></span>
          <input type="date" {...register('plannedOn')} />
          <FieldError message={errors.plannedOn?.message} />
        </label>
        <label className="field">
          <span>Meal <b aria-hidden="true">*</b></span>
          <select {...register('slot')}>
            {MEAL_SLOTS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label className="field full-width">
          <span>Recipe</span>
          <select {...register('recipeId')}>
            <option value="">No recipe — write it in</option>
            {recipes.map((recipe) => (
              <option key={recipe.id} value={recipe.id}>{recipe.name}</option>
            ))}
          </select>
        </label>
        {!recipeId ? (
          <label className="field full-width">
            <span>What are you making? <b aria-hidden="true">*</b></span>
            <input {...register('title')} placeholder="e.g. Leftovers" autoComplete="off" />
            <FieldError message={errors.title?.message} />
          </label>
        ) : null}
        <label className="field">
          <span>Servings <small>Optional</small></span>
          <input inputMode="numeric" {...register('servings')} placeholder="Uses the recipe default" />
          <FieldError message={errors.servings?.message} />
        </label>
        <label className="field full-width">
          <span>Notes <small>Optional</small></span>
          <textarea rows={2} {...register('notes')} placeholder="Anything to remember…" />
          <FieldError message={errors.notes?.message} />
        </label>
      </div>
      {error ? <ErrorNotice message={getErrorMessage(error)} /> : null}
      <div className="modal-actions">
        <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="submit" busy={busy}>{entry ? 'Save meal' : 'Add to plan'}</Button>
      </div>
    </form>
  )
}

export function PlannerPage() {
  const household = useHousehold()
  const queryClient = useQueryClient()
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<MealPlanEntry | undefined>()
  const [target, setTarget] = useState<{ date: string; slot: MealSlot }>({
    date: toDateInput(new Date()),
    slot: 'dinner',
  })
  const [outcome, setOutcome] = useState('')

  const householdId = household.data?.household.id ?? ''
  const plan = useQuery({
    queryKey: queryKeys.mealPlan(householdId),
    queryFn: () => fetchMealPlan(householdId),
    enabled: Boolean(householdId),
  })
  const recipes = useQuery({
    queryKey: queryKeys.recipes(householdId),
    queryFn: () => fetchRecipes(householdId),
    enabled: Boolean(householdId),
  })
  const inventory = useQuery({
    queryKey: queryKeys.inventory(householdId),
    queryFn: () => fetchInventory(householdId),
    enabled: Boolean(householdId),
  })

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: queryKeys.mealPlan(householdId) })
    void queryClient.invalidateQueries({ queryKey: queryKeys.inventory(householdId) })
    void queryClient.invalidateQueries({ queryKey: queryKeys.groceries(householdId) })
    void queryClient.invalidateQueries({ queryKey: queryKeys.recipes(householdId) })
  }

  const save = useMutation({
    mutationFn: (values: MealPlanEntryFormValues) => saveMealPlanEntry({
      planned_on: values.plannedOn,
      slot: values.slot,
      recipe_id: values.recipeId || null,
      title: values.recipeId ? null : values.title.trim(),
      servings: values.servings ? Number(values.servings) : null,
      notes: values.notes.trim() || null,
    }, editing),
    onSuccess: () => {
      setEditorOpen(false)
      setEditing(undefined)
      refresh()
    },
  })

  const removal = useMutation({
    mutationFn: (entry: MealPlanEntry) => deleteMealPlanEntry(entry),
    onSuccess: () => {
      setEditorOpen(false)
      setEditing(undefined)
      refresh()
    },
  })

  const cook = useMutation({
    mutationFn: (entry: MealPlanEntry) =>
      logRecipeCooked(entry.recipe_id!, entry.servings, true, entry.id),
    onSuccess: (result) => {
      setOutcome(`Cooked. ${result.deducted} ${result.deducted === 1 ? 'ingredient' : 'ingredients'} taken out of inventory.`)
      refresh()
    },
  })

  const weekEnd = addDays(weekStart, 6)
  const shopWeek = useMutation({
    mutationFn: () => addMealPlanToGroceries(toDateInput(weekStart), toDateInput(weekEnd)),
    onSuccess: (result) => {
      setOutcome(
        result.added
          ? `Added ${result.added} ${result.added === 1 ? 'item' : 'items'} to the grocery list.`
          : 'This week is already covered by what you have.',
      )
      refresh()
    },
  })

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)),
    [weekStart],
  )
  const entriesByKey = useMemo(() => {
    const map = new Map<string, MealPlanEntry[]>()
    for (const entry of plan.data ?? []) {
      const key = `${entry.planned_on}:${entry.slot}`
      map.set(key, [...(map.get(key) ?? []), entry])
    }
    return map
  }, [plan.data])

  const allRecipes = useMemo(() => recipes.data ?? [], [recipes.data])
  const items = useMemo(() => inventory.data ?? [], [inventory.data])

  // How much of the week's cooking the kitchen can already cover.
  const weekReadiness = useMemo(() => {
    const planned = (plan.data ?? []).filter((entry) => {
      const date = entry.planned_on
      return date >= toDateInput(weekStart) && date <= toDateInput(weekEnd) && entry.recipe_id
    })
    if (!planned.length) return null
    let covered = 0
    let required = 0
    for (const entry of planned) {
      const recipe = allRecipes.find((candidate) => candidate.id === entry.recipe_id)
      if (!recipe) continue
      const match = matchRecipe(recipe, items, { servings: entry.servings })
      covered += match.covered
      required += match.required
    }
    return required ? { covered, required } : null
  }, [plan.data, allRecipes, items, weekStart, weekEnd])

  if (household.isLoading) return <LoadingScreen />
  if (household.isError) return <ErrorNotice message={getErrorMessage(household.error)} onRetry={() => void household.refetch()} />
  if (!household.data) return <Navigate to="/onboarding" replace />

  const today = toDateInput(new Date())

  function openSlot(date: string, slot: MealSlot) {
    setEditing(undefined)
    setTarget({ date, slot })
    setEditorOpen(true)
  }

  function openEntry(entry: MealPlanEntry) {
    setEditing(entry)
    setTarget({ date: entry.planned_on, slot: entry.slot })
    setEditorOpen(true)
  }

  return (
    <AppShell context={household.data}>
      <div className="page-container planner-page">
        <header className="page-heading">
          <div>
            <p className="eyebrow">The week ahead</p>
            <h1>Meal plan</h1>
            <p>
              {rangeLabel.format(weekStart)} – {rangeLabel.format(weekEnd)}
              {weekReadiness
                ? ` · ${weekReadiness.covered} of ${weekReadiness.required} ingredients in stock`
                : ''}
            </p>
          </div>
          <div className="heading-actions">
            <div className="week-nav">
              <button aria-label="Previous week" onClick={() => setWeekStart(addDays(weekStart, -7))}>
                <ChevronLeft size={18} />
              </button>
              <button onClick={() => setWeekStart(startOfWeek(new Date()))}>This week</button>
              <button aria-label="Next week" onClick={() => setWeekStart(addDays(weekStart, 7))}>
                <ChevronRight size={18} />
              </button>
            </div>
            <Button variant="secondary" busy={shopWeek.isPending} onClick={() => shopWeek.mutate()}>
              <ShoppingCart size={18} /> Shop this week
            </Button>
          </div>
        </header>

        {outcome ? <div className="notice notice-success" role="status"><p>{outcome}</p></div> : null}
        {shopWeek.error || cook.error || removal.error ? (
          <ErrorNotice message={getErrorMessage(shopWeek.error ?? cook.error ?? removal.error)} />
        ) : null}

        {plan.error || recipes.error ? (
          <ErrorNotice
            message={getErrorMessage(plan.error ?? recipes.error)}
            onRetry={() => { void plan.refetch(); void recipes.refetch() }}
          />
        ) : plan.isLoading ? (
          <div className="inventory-skeleton" aria-label="Loading the plan"><span /><span /><span /></div>
        ) : (
          <div className="planner-grid">
            {days.map((day) => {
              const date = toDateInput(day)
              return (
                <section key={date} className={`planner-day ${date === today ? 'is-today' : ''}`}>
                  <header>
                    <strong>{dayLabel.format(day)}</strong>
                    <span>{dateLabel.format(day)}</span>
                  </header>
                  {MEAL_SLOTS.map((slot) => {
                    const entries = entriesByKey.get(`${date}:${slot.value}`) ?? []
                    return (
                      <div className="planner-slot" key={slot.value}>
                        <p className="slot-label">{slot.label}</p>
                        {entries.map((entry) => (
                          <article key={entry.id} className={`planner-entry ${entry.cooked_at ? 'cooked' : ''}`}>
                            <button onClick={() => openEntry(entry)}>
                              <strong>{entry.recipe?.name ?? entry.title}</strong>
                              {entry.servings ? <small>{entry.servings} servings</small> : null}
                            </button>
                            {entry.recipe_id && !entry.cooked_at ? (
                              <button
                                className="entry-cook"
                                aria-label={`Mark ${entry.recipe?.name ?? entry.title} as cooked`}
                                title="Mark as cooked"
                                onClick={() => cook.mutate(entry)}
                              >
                                <ChefHat size={15} />
                              </button>
                            ) : null}
                          </article>
                        ))}
                        <button
                          className="planner-add"
                          aria-label={`Add ${slot.label.toLowerCase()} on ${dateLabel.format(day)}`}
                          onClick={() => openSlot(date, slot.value)}
                        >
                          <Plus size={15} />
                        </button>
                      </div>
                    )
                  })}
                </section>
              )
            })}
          </div>
        )}

        {!allRecipes.length ? (
          <section className="empty-state compact">
            <CalendarDays size={34} />
            <h2>Plans work best with recipes</h2>
            <p>Add a few recipes and the planner can shop for the whole week in one tap.</p>
          </section>
        ) : null}
      </div>

      <Modal
        open={editorOpen}
        onClose={() => { setEditorOpen(false); setEditing(undefined) }}
        title={editing ? 'Edit planned meal' : 'Plan a meal'}
        description="Planned recipes can fill the grocery list for the whole week at once."
      >
        <EntryForm
          key={editing?.id ?? `${target.date}:${target.slot}`}
          recipes={allRecipes}
          entry={editing}
          plannedOn={target.date}
          slot={target.slot}
          busy={save.isPending}
          error={save.error}
          onSubmit={(values) => save.mutate(values)}
          onClose={() => { setEditorOpen(false); setEditing(undefined) }}
        />
        {editing ? (
          <div className="modal-actions destructive-row">
            <Button
              variant="ghost"
              className="danger-text"
              busy={removal.isPending}
              onClick={() => editing && removal.mutate(editing)}
            >
              <Trash2 size={17} /> Remove from plan
            </Button>
          </div>
        ) : null}
      </Modal>
    </AppShell>
  )
}
