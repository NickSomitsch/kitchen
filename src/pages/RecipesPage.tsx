import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  CalendarClock,
  ChefHat,
  CirclePlus,
  Clock,
  Heart,
  Search,
  Sparkles,
  Trash2,
  Users,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import {
  deleteRecipe,
  fetchInventory,
  fetchRecipes,
  queryKeys,
  saveMealPlanEntry,
} from '../api/kitchen'
import { AppShell } from '../components/AppShell'
import { RecipeArt } from '../components/RecipeArt'
import { RecipeDetail } from '../components/RecipeDetail'
import { RecipeForm } from '../components/RecipeForm'
import { RecipeSuggestions } from '../components/RecipeSuggestions'
import { Button, ErrorNotice, LoadingScreen, Modal } from '../components/ui'
import { useHousehold } from '../hooks/useHousehold'
import { getErrorMessage } from '../lib/errors'
import { toDateInput } from '../lib/expiry'
import { collectTags, coverageLabel, emptyRecipeFilters, rankRecipes } from '../lib/recipes'
import type { Recipe, RecipeMatch, RecipeSortField } from '../types/database'

function RecipeCard({ match, onOpen }: { match: RecipeMatch; onOpen: () => void }) {
  const { recipe } = match
  const percent = Math.round(match.coverage * 100)
  return (
    <article className={`recipe-card ${match.conflicts.length ? 'has-conflict' : ''}`}>
      <button onClick={onOpen}>
        {recipe.image_url ? (
          <img src={recipe.image_url} alt="" loading="lazy" referrerPolicy="no-referrer" />
        ) : (
          <RecipeArt
            name={recipe.name}
            tags={recipe.tags}
            ingredients={recipe.ingredients.map((ingredient) => ingredient.name)}
          />
        )}
        <span className="recipe-card-body">
          <span className="recipe-card-title">
            <strong>{recipe.name}</strong>
            {recipe.is_favorite ? <Heart size={15} fill="currentColor" aria-label="Favourite" /> : null}
          </span>
          <span className={`coverage-bar coverage-${percent === 100 ? 'full' : percent >= 60 ? 'most' : 'few'}`}>
            <span style={{ width: `${percent}%` }} />
          </span>
          <span className="recipe-card-meta">
            {coverageLabel(match)}
            {match.totalMinutes !== null ? <> · <Clock size={13} /> {match.totalMinutes} min</> : null}
            {' '}· <Users size={13} /> {recipe.servings}
          </span>
          {match.rescues.length ? (
            <span className="recipe-card-rescue">
              <CalendarClock size={13} /> Uses {match.rescues.map((item) => item.name).join(', ')}
            </span>
          ) : null}
          {match.conflicts.length ? (
            <span className="recipe-card-conflict">
              <AlertTriangle size={13} /> Contains {match.conflicts.join(', ')}
            </span>
          ) : null}
        </span>
      </button>
    </article>
  )
}

export function RecipesPage() {
  const household = useHousehold()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [filters, setFilters] = useState(emptyRecipeFilters)
  const [sort, setSort] = useState<RecipeSortField>('match')
  const [openRecipeId, setOpenRecipeId] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Recipe | undefined>()
  const [deleting, setDeleting] = useState<Recipe | undefined>()
  const [suggestOpen, setSuggestOpen] = useState(false)

  const householdId = household.data?.household.id ?? ''
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

  const removal = useMutation({
    mutationFn: (recipe: Recipe) => deleteRecipe(recipe),
    onSuccess: () => {
      setDeleting(undefined)
      setOpenRecipeId(null)
      void queryClient.invalidateQueries({ queryKey: queryKeys.recipes(householdId) })
    },
  })

  // "Plan it" drops the recipe onto today's dinner, then hands over to the planner.
  const planToday = useMutation({
    mutationFn: ({ recipe, servings }: { recipe: Recipe; servings: number }) => saveMealPlanEntry({
      planned_on: toDateInput(new Date()),
      slot: 'dinner',
      recipe_id: recipe.id,
      title: null,
      servings,
      notes: null,
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.mealPlan(householdId) })
      setOpenRecipeId(null)
      navigate('/planner')
    },
  })

  const allRecipes = useMemo(() => recipes.data ?? [], [recipes.data])
  const items = useMemo(() => inventory.data ?? [], [inventory.data])
  const availableTags = useMemo(() => collectTags(allRecipes), [allRecipes])
  const ranked = useMemo(
    () => rankRecipes(allRecipes, items, filters, sort, household.data?.household),
    [allRecipes, items, filters, sort, household.data?.household],
  )
  const openMatch = ranked.find((match) => match.recipe.id === openRecipeId)
    ?? (openRecipeId
      ? rankRecipes(allRecipes.filter((recipe) => recipe.id === openRecipeId), items, emptyRecipeFilters, 'match', household.data?.household)[0]
      : undefined)

  if (household.isLoading) return <LoadingScreen />
  if (household.isError) return <ErrorNotice message={getErrorMessage(household.error)} onRetry={() => void household.refetch()} />
  if (!household.data) return <Navigate to="/onboarding" replace />

  const readyCount = ranked.filter((match) => match.coverage === 1).length

  return (
    <AppShell context={household.data}>
      <div className="page-container recipes-page">
        <header className="page-heading">
          <div>
            <p className="eyebrow">Cook from what you have</p>
            <h1>Recipes</h1>
            <p>
              {allRecipes.length} {allRecipes.length === 1 ? 'recipe' : 'recipes'}
              {readyCount ? ` · ${readyCount} you can cook right now` : ''}
            </p>
          </div>
          <div className="heading-actions">
            <Button
              variant={suggestOpen ? 'secondary' : 'primary'}
              onClick={() => setSuggestOpen((open) => !open)}
            >
              <Sparkles size={18} /> What can I cook?
            </Button>
            <Button variant="secondary" onClick={() => { setEditing(undefined); setFormOpen(true) }}>
              <CirclePlus size={18} /> Add recipe
            </Button>
          </div>
        </header>

        {suggestOpen && household.data ? (
          <RecipeSuggestions
            householdId={householdId}
            inventory={items}
            household={household.data.household}
            onSaved={() => void recipes.refetch()}
          />
        ) : null}

        <section className="inventory-tools" aria-label="Search and filter recipes">
          <label className="search-box">
            <Search size={19} />
            <input
              type="search"
              placeholder="Search recipes and ingredients…"
              value={filters.search}
              onChange={(event) => setFilters({ ...filters, search: event.target.value })}
            />
          </label>
          <div className="filter-row">
            <button
              className={`toggle-chip ${filters.readyOnly ? 'active' : ''}`}
              onClick={() => setFilters({ ...filters, readyOnly: !filters.readyOnly })}
            >
              Ready to cook
            </button>
            <button
              className={`toggle-chip ${filters.favoritesOnly ? 'active' : ''}`}
              onClick={() => setFilters({ ...filters, favoritesOnly: !filters.favoritesOnly })}
            >
              <Heart size={14} /> Favourites
            </button>
            <label className="select-control compact">
              <span className="sr-only">Maximum time</span>
              <select
                value={filters.maxMinutes ?? ''}
                onChange={(event) => setFilters({
                  ...filters,
                  maxMinutes: event.target.value ? Number(event.target.value) : null,
                })}
              >
                <option value="">Any time</option>
                <option value="15">Under 15 min</option>
                <option value="30">Under 30 min</option>
                <option value="60">Under 60 min</option>
              </select>
            </label>
            {availableTags.length ? (
              <label className="select-control compact">
                <span className="sr-only">Tag</span>
                <select
                  value={filters.tags[0] ?? ''}
                  onChange={(event) => setFilters({
                    ...filters,
                    tags: event.target.value ? [event.target.value] : [],
                  })}
                >
                  <option value="">Any tag</option>
                  {availableTags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
                </select>
              </label>
            ) : null}
            <div className="toolbar-spacer" />
            <label className="sort-control">
              <span className="sr-only">Sort recipes</span>
              <select value={sort} onChange={(event) => setSort(event.target.value as RecipeSortField)}>
                <option value="match">Best match</option>
                <option value="name">Name A–Z</option>
                <option value="time">Quickest first</option>
                <option value="recent">Recently updated</option>
              </select>
            </label>
          </div>
        </section>

        {recipes.error || inventory.error ? (
          <ErrorNotice
            message={getErrorMessage(recipes.error ?? inventory.error)}
            onRetry={() => { void recipes.refetch(); void inventory.refetch() }}
          />
        ) : recipes.isLoading || inventory.isLoading ? (
          <div className="inventory-skeleton" aria-label="Loading recipes"><span /><span /><span /></div>
        ) : !allRecipes.length ? (
          <section className="empty-state">
            <div className="empty-illustration"><ChefHat size={31} /><span /></div>
            <p className="eyebrow">Nothing saved yet</p>
            <h2>See what your kitchen can make</h2>
            <p>
              Kitchen can suggest dishes from what you already have, favouring anything
              close to its date. Keep the ones you like and they join your own recipes.
            </p>
            <div className="empty-actions">
              <Button onClick={() => setSuggestOpen(true)}>
                <Sparkles size={18} /> Suggest meals
              </Button>
              <Button variant="secondary" onClick={() => { setEditing(undefined); setFormOpen(true) }}>
                <CirclePlus size={18} /> Add one myself
              </Button>
            </div>
          </section>
        ) : !ranked.length ? (
          <section className="empty-state compact">
            <Search size={34} />
            <h2>No recipes match</h2>
            <p>Try a different search or clear the filters.</p>
            <Button variant="secondary" onClick={() => setFilters(emptyRecipeFilters)}>Clear filters</Button>
          </section>
        ) : (
          <div className="recipe-grid">
            {ranked.map((match) => (
              <RecipeCard
                key={match.recipe.id}
                match={match}
                onOpen={() => setOpenRecipeId(match.recipe.id)}
              />
            ))}
          </div>
        )}
      </div>

      <Modal
        open={Boolean(openMatch)}
        onClose={() => setOpenRecipeId(null)}
        title={openMatch?.recipe.name ?? 'Recipe'}
        size="large"
      >
        {openMatch && household.data ? (
          <RecipeDetail
            householdId={householdId}
            recipe={openMatch.recipe}
            inventory={items}
            household={household.data.household}
            onEdit={() => { setEditing(openMatch.recipe); setOpenRecipeId(null); setFormOpen(true) }}
            onDelete={() => { setDeleting(openMatch.recipe); setOpenRecipeId(null) }}
            onPlan={(recipe, servings) => planToday.mutate({ recipe, servings })}
          />
        ) : null}
      </Modal>

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? 'Edit recipe' : 'Add a recipe'}
        description="Ingredients are matched against your inventory by name."
        size="large"
      >
        <RecipeForm
          key={editing?.id ?? 'new'}
          householdId={householdId}
          inventory={items}
          recipe={editing}
          onClose={() => setFormOpen(false)}
        />
      </Modal>

      <Modal
        open={Boolean(deleting)}
        onClose={() => setDeleting(undefined)}
        title={`Delete ${deleting?.name ?? 'recipe'}?`}
        description="This removes the recipe and its ingredients for everyone in your household."
        size="small"
      >
        {removal.isError ? <ErrorNotice message={getErrorMessage(removal.error)} /> : null}
        <div className="modal-actions">
          <Button variant="secondary" onClick={() => setDeleting(undefined)}>Keep recipe</Button>
          <Button variant="danger" busy={removal.isPending} onClick={() => deleting && removal.mutate(deleting)}>
            <Trash2 size={17} /> Delete permanently
          </Button>
        </div>
      </Modal>
    </AppShell>
  )
}
