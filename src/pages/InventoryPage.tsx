import {
  Archive,
  CirclePlus,
  MapPin,
  MoreHorizontal,
  PackageOpen,
  Pencil,
  ShoppingCart,
  Trash2,
} from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import {
  deleteInventoryItem,
  fetchCategories,
  fetchGroceries,
  fetchInventory,
  fetchLocations,
  queryKeys,
  createGroceryItem,
} from '../api/kitchen'
import { AppShell } from '../components/AppShell'
import { InventoryFilters } from '../components/InventoryFilters'
import { ItemForm } from '../components/ItemForm'
import { Button, ErrorNotice, LoadingScreen, Modal } from '../components/ui'
import { useHousehold } from '../hooks/useHousehold'
import { getErrorMessage } from '../lib/errors'
import { filterAndSortInventory, formatQuantity, isLowStock } from '../lib/inventory'
import type {
  InventoryFilters as InventoryFiltersValue,
  InventoryItem,
  InventorySort,
} from '../types/database'

const initialFilters: InventoryFiltersValue = {
  search: '',
  categoryIds: [],
  locationIds: [],
  units: [],
  stock: 'all',
}

function relativeDate(value: string) {
  const date = new Date(value)
  const today = new Date()
  const difference = Math.round((date.getTime() - today.getTime()) / 86_400_000)
  if (Math.abs(difference) < 1) return 'Today'
  return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(difference, 'day')
}

export function InventoryPage() {
  const household = useHousehold()
  const queryClient = useQueryClient()
  const [filters, setFilters] = useState(initialFilters)
  const [sort, setSort] = useState<InventorySort>({ field: 'name', direction: 'asc' })
  const [editingItem, setEditingItem] = useState<InventoryItem | undefined>()
  const [itemFormOpen, setItemFormOpen] = useState(false)
  const [deletingItem, setDeletingItem] = useState<InventoryItem | undefined>()

  const householdId = household.data?.household.id ?? ''
  const inventory = useQuery({
    queryKey: queryKeys.inventory(householdId),
    queryFn: () => fetchInventory(householdId),
    enabled: Boolean(householdId),
  })
  const categories = useQuery({
    queryKey: queryKeys.categories(householdId),
    queryFn: () => fetchCategories(householdId),
    enabled: Boolean(householdId),
  })
  const locations = useQuery({
    queryKey: queryKeys.locations(householdId),
    queryFn: () => fetchLocations(householdId),
    enabled: Boolean(householdId),
  })
  const groceries = useQuery({
    queryKey: queryKeys.groceries(householdId),
    queryFn: () => fetchGroceries(householdId),
    enabled: Boolean(householdId),
  })
  const deleteMutation = useMutation({
    mutationFn: (item: InventoryItem) => deleteInventoryItem(item),
    onSuccess: async () => {
      setDeletingItem(undefined)
      await queryClient.invalidateQueries({ queryKey: queryKeys.inventory(householdId) })
    },
  })
  const groceryMutation = useMutation({
    mutationFn: (item: InventoryItem) => createGroceryItem({
      inventory_item_id: item.id,
      name: item.name,
      quantity: null,
      unit: null,
      category_id: item.category_id,
      notes: null,
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.groceries(householdId) })
    },
  })

  const items = useMemo(() => inventory.data ?? [], [inventory.data])
  const visibleItems = useMemo(
    () => filterAndSortInventory(items, filters, sort),
    [items, filters, sort],
  )
  const activeFilterCount =
    filters.categoryIds.length + filters.locationIds.length + filters.units.length +
    (filters.stock === 'all' ? 0 : 1) + (filters.search.trim() ? 1 : 0)
  const outOfStock = items.filter((item) => item.quantity === 0).length
  const lowStock = items.filter(isLowStock).length
  const activeGroceryIds = new Set(
    (groceries.data ?? [])
      .filter((item) => item.status === 'active' && item.inventory_item_id)
      .map((item) => item.inventory_item_id),
  )

  if (household.isLoading) return <LoadingScreen />
  if (household.isError) return <ErrorNotice message={getErrorMessage(household.error)} onRetry={() => void household.refetch()} />
  if (!household.data) return <Navigate to="/onboarding" replace />

  const queryError = inventory.error ?? categories.error ?? locations.error ?? groceries.error
  const queriesLoading = inventory.isLoading || categories.isLoading || locations.isLoading || groceries.isLoading

  function openCreate() {
    setEditingItem(undefined)
    setItemFormOpen(true)
  }

  function openEdit(item: InventoryItem) {
    setEditingItem(item)
    setItemFormOpen(true)
  }

  return (
    <AppShell context={household.data}>
      <div className="page-container inventory-page">
        <header className="page-heading inventory-heading">
          <div>
            <p className="eyebrow">Kitchen overview</p>
            <h1>Inventory</h1>
            <p>{items.length} {items.length === 1 ? 'item' : 'items'} on hand{outOfStock ? ` · ${outOfStock} out of stock` : ''}{lowStock ? ` · ${lowStock} low stock` : ''}</p>
          </div>
          <Button onClick={openCreate}><CirclePlus size={18} /> Add item</Button>
        </header>

        <InventoryFilters
          filters={filters}
          sort={sort}
          categories={categories.data ?? []}
          locations={locations.data ?? []}
          onFiltersChange={setFilters}
          onSortChange={setSort}
          onClear={() => setFilters(initialFilters)}
          activeCount={activeFilterCount}
        />

        {queryError ? (
          <ErrorNotice message={getErrorMessage(queryError)} onRetry={() => {
            void inventory.refetch(); void categories.refetch(); void locations.refetch(); void groceries.refetch()
          }} />
        ) : queriesLoading ? (
          <div className="inventory-skeleton" aria-label="Loading inventory"><span /><span /><span /></div>
        ) : !items.length ? (
          <section className="empty-state">
            <div className="empty-illustration"><Archive size={31} /><span /></div>
            <p className="eyebrow">A fresh start</p>
            <h2>Your kitchen is ready to fill</h2>
            <p>Add the first item from your pantry, fridge, or freezer.</p>
            <Button onClick={openCreate}><CirclePlus size={18} /> Add your first item</Button>
          </section>
        ) : !visibleItems.length ? (
          <section className="empty-state compact">
            <PackageOpen size={34} />
            <h2>No items match</h2>
            <p>Try another search or clear your filters.</p>
            <Button variant="secondary" onClick={() => setFilters(initialFilters)}>Clear filters</Button>
          </section>
        ) : (
          <>
            <div className="inventory-table-wrap">
              <table className="inventory-table">
                <thead><tr><th>Item</th><th>Quantity</th><th>Category</th><th>Location</th><th>Updated</th><th><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {visibleItems.map((item) => (
                    <tr key={item.id} className={item.quantity === 0 ? 'out-row' : ''}>
                      <td><button className="item-name-button" onClick={() => openEdit(item)}><span className="item-avatar">{item.name.slice(0, 1).toUpperCase()}</span><span><strong>{item.name}</strong>{item.notes ? <small>{item.notes}</small> : null}</span></button></td>
                      <td><strong className="quantity-value">{formatQuantity(item.quantity, item.unit)}</strong>{item.quantity === 0 ? <span className="status-chip">Out of stock</span> : isLowStock(item) ? <span className="status-chip warning-chip">Low stock</span> : null}</td>
                      <td>{item.category ? <span className="soft-chip">{item.category.name}</span> : <span className="muted">—</span>}</td>
                      <td>{item.location ? <span className="location-value"><MapPin size={15} /> {item.location.name}</span> : <span className="muted">—</span>}</td>
                      <td><span className="updated-value">{relativeDate(item.updated_at)}</span></td>
                      <td><div className="row-actions"><button disabled={activeGroceryIds.has(item.id)} onClick={() => groceryMutation.mutate(item)} aria-label={activeGroceryIds.has(item.id) ? `${item.name} is on grocery list` : `Add ${item.name} to groceries`} title={activeGroceryIds.has(item.id) ? 'On grocery list' : 'Add to groceries'}><ShoppingCart size={17} /></button><button onClick={() => openEdit(item)} aria-label={`Edit ${item.name}`}><Pencil size={17} /></button><button className="danger-icon" onClick={() => setDeletingItem(item)} aria-label={`Delete ${item.name}`}><Trash2 size={17} /></button></div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="inventory-cards">
              {visibleItems.map((item) => (
                <article className={`inventory-card ${item.quantity === 0 ? 'out-card' : ''}`} key={item.id}>
                  <button className="card-main" onClick={() => openEdit(item)}>
                    <span className="item-avatar">{item.name.slice(0, 1).toUpperCase()}</span>
                    <span className="card-copy"><span className="card-title-line"><strong>{item.name}</strong>{isLowStock(item) ? <span className="status-dot" title="Low stock" /> : null}</span><span>{item.category?.name ?? 'Uncategorised'} · {item.location?.name ?? 'No location'}</span></span>
                    <span className="card-quantity">{formatQuantity(item.quantity, item.unit)}{item.quantity === 0 ? <small>Out of stock</small> : isLowStock(item) ? <small>Low stock</small> : null}</span>
                  </button>
                  <details className="card-actions"><summary aria-label={`Actions for ${item.name}`}><MoreHorizontal size={19} /></summary><div><button disabled={activeGroceryIds.has(item.id)} onClick={() => groceryMutation.mutate(item)}><ShoppingCart size={16} /> {activeGroceryIds.has(item.id) ? 'On list' : 'Add to list'}</button><button onClick={() => openEdit(item)}><Pencil size={16} /> Edit</button><button className="danger-text" onClick={() => setDeletingItem(item)}><Trash2 size={16} /> Delete</button></div></details>
                </article>
              ))}
            </div>
          </>
        )}
      </div>

      <Modal open={itemFormOpen} onClose={() => setItemFormOpen(false)} title={editingItem ? 'Edit inventory item' : 'Add inventory item'} description={editingItem ? 'Update the details everyone in your household sees.' : 'Record something in your kitchen.'}>
        <ItemForm householdId={householdId} items={items} categories={categories.data ?? []} locations={locations.data ?? []} item={editingItem} onClose={() => setItemFormOpen(false)} onEditItem={(nextItem) => setEditingItem(nextItem)} />
      </Modal>

      <Modal open={Boolean(deletingItem)} onClose={() => setDeletingItem(undefined)} title={`Delete ${deletingItem?.name ?? 'item'}?`} description="This permanently removes the item for everyone in your household." size="small">
        {deleteMutation.isError ? <ErrorNotice message={getErrorMessage(deleteMutation.error)} /> : null}
        <div className="modal-actions"><Button variant="secondary" onClick={() => setDeletingItem(undefined)}>Keep item</Button><Button variant="danger" busy={deleteMutation.isPending} onClick={() => deletingItem && deleteMutation.mutate(deletingItem)}><Trash2 size={17} /> Delete permanently</Button></div>
      </Modal>
    </AppShell>
  )
}
