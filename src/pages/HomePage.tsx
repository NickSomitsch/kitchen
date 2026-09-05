import { useQuery } from '@tanstack/react-query'
import {
  ArrowRight,
  Boxes,
  CalendarClock,
  Check,
  ChefHat,
  Clock,
  PackageOpen,
  ShoppingCart,
  Sparkles,
  Users,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import {
  fetchCategories,
  fetchGroceries,
  fetchInventory,
  fetchLocations,
  fetchRecipes,
  queryKeys,
} from '../api/kitchen'
import { AppShell } from '../components/AppShell'
import { GroceryItemForm } from '../components/GroceryItemForm'
import { RecipeArt } from '../components/RecipeArt'
import { PurchaseForm } from '../components/PurchaseForm'
import { ErrorNotice, LoadingScreen, Modal } from '../components/ui'
import { useHousehold } from '../hooks/useHousehold'
import { getErrorMessage } from '../lib/errors'
import { expiringItems, expiryState, formatExpiry } from '../lib/expiry'
import { formatQuantity, groupActiveGroceries, isLowStock } from '../lib/inventory'
import { coverageLabel, emptyRecipeFilters, rankRecipes } from '../lib/recipes'
import type { GroceryItem, InventoryItem } from '../types/database'

type InventoryView = 'recent' | 'expiring'

// Enough to be useful at a glance without turning the overview into a second list.
const GROCERY_PREVIEW = 5

function greeting(now = new Date()) {
  const hour = now.getHours()
  if (hour < 5) return 'Still up'
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

function ItemRow({ item, view }: { item: InventoryItem; view: InventoryView }) {
  const state = expiryState(item)
  return (
    <li>
      {item.image_url ? (
        <img className="item-avatar item-photo" src={item.image_url} alt="" loading="lazy" referrerPolicy="no-referrer" />
      ) : (
        <span className="item-avatar">{item.name.slice(0, 1).toUpperCase()}</span>
      )}
      <span className="overview-row-copy">
        <strong>{item.name}</strong>
        <small>{item.category?.name ?? 'Uncategorised'}{item.location ? ` · ${item.location.name}` : ''}</small>
      </span>
      <span className="overview-row-value">
        {formatQuantity(item.quantity, item.unit)}
        {view === 'expiring' && item.expires_on ? (
          <small className={`expiry-${state}`}>{formatExpiry(item.expires_on)}</small>
        ) : isLowStock(item) ? <small className="expiry-soon">Low stock</small> : null}
      </span>
    </li>
  )
}

export function HomePage() {
  const household = useHousehold()
  const [view, setView] = useState<InventoryView>('recent')
  const [formOpen, setFormOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<GroceryItem>()
  const [purchasingItem, setPurchasingItem] = useState<GroceryItem>()

  const householdId = household.data?.household.id ?? ''
  const enabled = Boolean(householdId)
  const inventory = useQuery({
    queryKey: queryKeys.inventory(householdId),
    queryFn: () => fetchInventory(householdId),
    enabled,
  })
  const groceries = useQuery({
    queryKey: queryKeys.groceries(householdId),
    queryFn: () => fetchGroceries(householdId),
    enabled,
  })
  const recipes = useQuery({
    queryKey: queryKeys.recipes(householdId),
    queryFn: () => fetchRecipes(householdId),
    enabled,
  })
  const categories = useQuery({
    queryKey: queryKeys.categories(householdId),
    queryFn: () => fetchCategories(householdId),
    enabled,
  })
  const locations = useQuery({
    queryKey: queryKeys.locations(householdId),
    queryFn: () => fetchLocations(householdId),
    enabled,
  })

  const items = useMemo(() => inventory.data ?? [], [inventory.data])
  const recent = useMemo(
    () => [...items]
      .sort((left, right) => right.created_at.localeCompare(left.created_at))
      .slice(0, 5),
    [items],
  )
  const soon = useMemo(() => expiringItems(items).slice(0, 5), [items])
  const activeGroceries = useMemo(
    () => (groceries.data ?? []).filter((entry) => entry.status === 'active'),
    [groceries.data],
  )
  // Grouped first so the order matches the grocery page, then flattened: the card
  // shows individual items because each one has to be tickable and editable.
  const groceryPreview = useMemo(
    () => groupActiveGroceries(groceries.data ?? [])
      .flatMap((group) => group.items)
      .slice(0, GROCERY_PREVIEW),
    [groceries.data],
  )
  // Ranked from saved recipes rather than generated, so opening the home page
  // never spends anyone's daily suggestion allowance.
  const topRecipes = useMemo(
    () => rankRecipes(
      recipes.data ?? [], items,
      { ...emptyRecipeFilters }, 'match', household.data?.household,
    ).slice(0, 2),
    [recipes.data, items, household.data?.household],
  )

  if (household.isLoading) return <LoadingScreen />
  if (household.isError) {
    return <ErrorNotice message={getErrorMessage(household.error)} onRetry={() => void household.refetch()} />
  }
  if (!household.data) return <Navigate to="/onboarding" replace />

  const shown = view === 'recent' ? recent : soon
  const loading = inventory.isLoading || groceries.isLoading || recipes.isLoading
    || categories.isLoading || locations.isLoading
  const queryError = inventory.error ?? groceries.error ?? recipes.error
    ?? categories.error ?? locations.error
  const lowStockCount = activeGroceries.filter((entry) => entry.source === 'low_stock').length
  const allGroceries = groceries.data ?? []

  function openGrocery(item: GroceryItem) {
    setEditingItem(item)
    setFormOpen(true)
  }

  function openExisting(id: string) {
    const existing = allGroceries.find((item) => item.id === id)
    if (existing) openGrocery(existing)
  }

  return (
    <AppShell context={household.data}>
      <div className="page-container home-page">
        <header className="page-heading">
          <div>
            <p className="eyebrow">{household.data.household.name}</p>
            <h1>{greeting()}, {household.data.profile.display_name.split(' ')[0]}</h1>
            <p>
              {items.length} {items.length === 1 ? 'item' : 'items'} on hand
              {soon.length ? ` · ${soon.length} to use soon` : ''}
              {activeGroceries.length ? ` · ${activeGroceries.length} to buy` : ''}
            </p>
          </div>
        </header>

        {queryError ? (
          <ErrorNotice message={getErrorMessage(queryError)} onRetry={() => {
            void inventory.refetch(); void groceries.refetch(); void recipes.refetch()
            void categories.refetch(); void locations.refetch()
          }} />
        ) : loading ? (
          <div className="inventory-skeleton" aria-label="Loading your kitchen"><span /><span /><span /></div>
        ) : (
          <div className="overview-grid">
            <section className="overview-card overview-wide">
              <header>
                <h2><Boxes size={17} /> Inventory</h2>
                <div className="overview-toggle" role="tablist" aria-label="Inventory view">
                  <button
                    role="tab"
                    aria-selected={view === 'recent'}
                    className={view === 'recent' ? 'active' : ''}
                    onClick={() => setView('recent')}
                  >
                    Recently added
                  </button>
                  <button
                    role="tab"
                    aria-selected={view === 'expiring'}
                    className={view === 'expiring' ? 'active' : ''}
                    onClick={() => setView('expiring')}
                  >
                    <CalendarClock size={14} /> Use soon
                    {soon.length ? <b className="nav-count">{soon.length}</b> : null}
                  </button>
                </div>
              </header>
              {shown.length ? (
                <ul className="overview-rows">
                  {shown.map((item) => <ItemRow key={item.id} item={item} view={view} />)}
                </ul>
              ) : (
                <p className="overview-empty">
                  {view === 'recent'
                    ? 'Nothing in your inventory yet. Scan a barcode or add an item to begin.'
                    : 'Nothing is close to its date. Add best-before dates to see them here.'}
                </p>
              )}
              <Link className="overview-link" to="/inventory">
                Open inventory <ArrowRight size={15} />
              </Link>
            </section>

            <section className="overview-card">
              <header>
                <h2><ShoppingCart size={17} /> Groceries</h2>
                {activeGroceries.length ? <span className="count-badge">{activeGroceries.length}</span> : null}
              </header>
              {activeGroceries.length ? (
                <>
                  <ul className="overview-groceries">
                    {groceryPreview.map((item) => (
                      <li key={item.id}>
                        <button
                          className="purchase-check"
                          onClick={() => setPurchasingItem(item)}
                          aria-label={`Mark ${item.name} purchased`}
                        >
                          <Check size={17} />
                        </button>
                        <button className="grocery-main" onClick={() => openGrocery(item)}>
                          <span className="grocery-title">
                            <strong>{item.name}</strong>
                            {item.source === 'low_stock' ? (
                              <span className="auto-chip"><Sparkles size={12} /> Automatic</span>
                            ) : null}
                            {item.local_sync_status ? (
                              <span className={`sync-chip sync-chip-${item.local_sync_status}`}>Pending sync</span>
                            ) : null}
                          </span>
                          <span>
                            {item.quantity && item.unit ? formatQuantity(item.quantity, item.unit) : 'Amount not set'}
                            {item.category?.name ? ` · ${item.category.name}` : ''}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  {activeGroceries.length > groceryPreview.length ? (
                    <p className="overview-note">
                      {activeGroceries.length - groceryPreview.length} more on the full list.
                    </p>
                  ) : null}
                  {lowStockCount ? (
                    <p className="overview-note">
                      {lowStockCount} added automatically by your low-stock rules.
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="overview-empty">Your grocery list is empty. Nice.</p>
              )}
              <Link className="overview-link" to="/grocery">
                Open grocery list <ArrowRight size={15} />
              </Link>
            </section>

            <section className="overview-card">
              <header>
                <h2><ChefHat size={17} /> Cook tonight</h2>
              </header>
              {topRecipes.length ? (
                <ul className="overview-recipes">
                  {topRecipes.map((match) => (
                    <li key={match.recipe.id}>
                      <Link to="/recipes">
                        <RecipeArt
                          className="overview-recipe-art"
                          name={match.recipe.name}
                          tags={match.recipe.tags}
                          ingredients={match.recipe.ingredients.map((ingredient) => ingredient.name)}
                        />
                        <strong>{match.recipe.name}</strong>
                        <span className={`coverage-bar coverage-${match.coverage === 1 ? 'full' : match.coverage >= 0.6 ? 'most' : 'few'}`}>
                          <span style={{ width: `${Math.round(match.coverage * 100)}%` }} />
                        </span>
                        <small>
                          {coverageLabel(match)}
                          {match.totalMinutes !== null ? <> · <Clock size={12} /> {match.totalMinutes} min</> : null}
                          {' '}· <Users size={12} /> {match.recipe.servings}
                        </small>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="overview-empty-action">
                  <p className="overview-empty">
                    No recipes saved yet. Kitchen can suggest some from what you have.
                  </p>
                  <Link className="button button-secondary" to="/recipes">
                    <Sparkles size={16} /> Suggest meals
                  </Link>
                </div>
              )}
              <Link className="overview-link" to="/recipes">
                Open recipes <ArrowRight size={15} />
              </Link>
            </section>

            {!items.length ? (
              <section className="overview-card overview-wide overview-cta">
                <PackageOpen size={26} />
                <div>
                  <strong>Your kitchen is empty</strong>
                  <p>Scan a barcode, photograph a shelf, or add the first item by hand.</p>
                </div>
                <Link className="button button-primary" to="/inventory">Start filling it</Link>
              </section>
            ) : null}
          </div>
        )}
      </div>

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editingItem ? 'Edit grocery item' : 'Add grocery item'}
        description={editingItem?.source === 'low_stock'
          ? 'This entry is managed by its inventory threshold; you can set the amount and notes.'
          : 'Add something for everyone in your household to see.'}
      >
        <GroceryItemForm
          householdId={householdId}
          groceries={allGroceries}
          inventory={items}
          categories={categories.data ?? []}
          item={editingItem}
          onClose={() => setFormOpen(false)}
          onExisting={openExisting}
        />
      </Modal>

      <Modal
        open={Boolean(purchasingItem)}
        onClose={() => setPurchasingItem(undefined)}
        title={`Purchased ${purchasingItem?.name ?? 'item'}?`}
        description="Review the amount and decide whether to update your inventory."
      >
        {purchasingItem ? (
          <PurchaseForm
            householdId={householdId}
            item={purchasingItem}
            inventory={items}
            locations={locations.data ?? []}
            onClose={() => setPurchasingItem(undefined)}
          />
        ) : null}
      </Modal>
    </AppShell>
  )
}
