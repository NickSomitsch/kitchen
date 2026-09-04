import {
  Archive,
  Barcode,
  CalendarClock,
  Camera,
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
  lookupProduct,
  queryKeys,
  createGroceryItem,
} from '../api/kitchen'
import { AppShell } from '../components/AppShell'
import { BarcodeScannerModal } from '../components/BarcodeScanner'
import { InventoryFilters } from '../components/InventoryFilters'
import { ItemForm } from '../components/ItemForm'
import { PhotoScanModal } from '../components/PhotoScan'
import { Button, ErrorNotice, LoadingScreen, Modal } from '../components/ui'
import { useHousehold } from '../hooks/useHousehold'
import { getErrorMessage } from '../lib/errors'
import { expiringItems, expiryState, formatExpiry } from '../lib/expiry'
import { filterAndSortInventory, formatQuantity, isLowStock } from '../lib/inventory'
import { ProductNotFoundError } from '../lib/openfoodfacts'
import type {
  InventoryFilters as InventoryFiltersValue,
  InventoryItem,
  InventorySort,
  ProductFacts,
} from '../types/database'

const initialFilters: InventoryFiltersValue = {
  search: '',
  categoryIds: [],
  locationIds: [],
  units: [],
  stock: 'all',
  expiry: 'all',
}

function relativeDate(value: string) {
  const date = new Date(value)
  const today = new Date()
  const difference = Math.round((date.getTime() - today.getTime()) / 86_400_000)
  if (Math.abs(difference) < 1) return 'Today'
  return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(difference, 'day')
}

function ExpiryChip({ item }: { item: InventoryItem }) {
  if (!item.expires_on) return null
  const state = expiryState(item)
  if (state === 'later' || state === 'none') return null
  return (
    <span className={`status-chip expiry-chip expiry-${state}`}>
      <CalendarClock size={13} /> {formatExpiry(item.expires_on)}
    </span>
  )
}

export function InventoryPage() {
  const household = useHousehold()
  const queryClient = useQueryClient()
  const [filters, setFilters] = useState(initialFilters)
  const [sort, setSort] = useState<InventorySort>({ field: 'name', direction: 'asc' })
  const [editingItem, setEditingItem] = useState<InventoryItem | undefined>()
  const [prefill, setPrefill] = useState<ProductFacts | undefined>()
  const [itemFormOpen, setItemFormOpen] = useState(false)
  const [deletingItem, setDeletingItem] = useState<InventoryItem | undefined>()
  const [scannerOpen, setScannerOpen] = useState(false)
  const [photoOpen, setPhotoOpen] = useState(false)
  const [scanMessage, setScanMessage] = useState('')

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
    onSuccess: () => {
      setDeletingItem(undefined)
      void queryClient.invalidateQueries({ queryKey: queryKeys.inventory(householdId) })
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
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.groceries(householdId) })
    },
  })

  const items = useMemo(() => inventory.data ?? [], [inventory.data])

  // A scanned barcode either opens the item you already own or starts a prefilled one.
  const scanLookup = useMutation({
    mutationFn: (barcode: string) => lookupProduct(householdId, barcode),
    onSuccess: (facts) => {
      const known = items.find((item) => item.barcode === facts.barcode)
      if (known) {
        setScanMessage(`${known.name} is already in your kitchen. Update it below.`)
        setPrefill(undefined)
        setEditingItem(known)
      } else {
        setScanMessage('')
        setEditingItem(undefined)
        setPrefill(facts)
      }
      setItemFormOpen(true)
    },
    onError: (error, barcode) => {
      const known = items.find((item) => item.barcode === barcode)
      if (known) {
        setScanMessage(`${known.name} is already in your kitchen. Update it below.`)
        setEditingItem(known)
        setPrefill(undefined)
        setItemFormOpen(true)
        return
      }
      setScanMessage(
        error instanceof ProductNotFoundError
          ? 'That barcode is not in Open Food Facts yet. Add the details yourself and it will be remembered.'
          : getErrorMessage(error),
      )
      setEditingItem(undefined)
      setPrefill({
        barcode,
        name: '',
        brand: null,
        image_url: null,
        package_quantity: null,
        package_unit: null,
        nutrition: null,
        ingredients_text: null,
        allergens: [],
        source: 'manual',
        origin: 'network',
      })
      setItemFormOpen(true)
    },
  })

  const visibleItems = useMemo(
    () => filterAndSortInventory(items, filters, sort),
    [items, filters, sort],
  )
  const useSoon = useMemo(() => expiringItems(items), [items])
  const activeFilterCount =
    filters.categoryIds.length + filters.locationIds.length + filters.units.length +
    (filters.stock === 'all' ? 0 : 1) + (filters.expiry === 'all' ? 0 : 1) +
    (filters.search.trim() ? 1 : 0)
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
    setPrefill(undefined)
    setScanMessage('')
    setItemFormOpen(true)
  }

  function openEdit(item: InventoryItem) {
    setEditingItem(item)
    setPrefill(undefined)
    setScanMessage('')
    setItemFormOpen(true)
  }

  return (
    <AppShell context={household.data}>
      <div className="page-container inventory-page">
        <header className="page-heading inventory-heading">
          <div>
            <p className="eyebrow">Kitchen overview</p>
            <h1>Inventory</h1>
            <p>{items.length} {items.length === 1 ? 'item' : 'items'} on hand{outOfStock ? ` · ${outOfStock} out of stock` : ''}{lowStock ? ` · ${lowStock} low stock` : ''}{useSoon.length ? ` · ${useSoon.length} to use soon` : ''}</p>
          </div>
          <div className="heading-actions">
            <Button variant="secondary" busy={scanLookup.isPending} onClick={() => setScannerOpen(true)}>
              <Barcode size={18} /> Scan
            </Button>
            <Button variant="secondary" onClick={() => setPhotoOpen(true)}>
              <Camera size={18} /> Photo
            </Button>
            <Button onClick={openCreate}><CirclePlus size={18} /> Add item</Button>
          </div>
        </header>

        {useSoon.length ? (
          <section className="use-soon" aria-label="Items to use soon">
            <header>
              <h2><CalendarClock size={17} /> Use soon</h2>
              <button
                className="text-button"
                onClick={() => setFilters({ ...initialFilters, expiry: 'expiring' })}
              >
                Show all {useSoon.length}
              </button>
            </header>
            <ul>
              {useSoon.slice(0, 8).map((item) => (
                <li key={item.id}>
                  <button className={`use-soon-card expiry-${expiryState(item)}`} onClick={() => openEdit(item)}>
                    <strong>{item.name}</strong>
                    <span>{formatQuantity(item.quantity, item.unit)}</span>
                    <small>{item.expires_on ? formatExpiry(item.expires_on) : ''}</small>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

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
            <p>Scan a barcode, photograph a shelf, or add the first item by hand.</p>
            <div className="empty-actions">
              <Button variant="secondary" onClick={() => setScannerOpen(true)}><Barcode size={18} /> Scan a barcode</Button>
              <Button onClick={openCreate}><CirclePlus size={18} /> Add your first item</Button>
            </div>
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
                <thead><tr><th>Item</th><th>Quantity</th><th>Category</th><th>Location</th><th>Best before</th><th>Updated</th><th><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {visibleItems.map((item) => (
                    <tr key={item.id} className={item.quantity === 0 ? 'out-row' : ''}>
                      <td><button className="item-name-button" onClick={() => openEdit(item)}>{item.image_url ? <img className="item-avatar item-photo" src={item.image_url} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="item-avatar">{item.name.slice(0, 1).toUpperCase()}</span>}<span><strong>{item.name}</strong>{item.local_sync_status ? <small className={`sync-chip sync-chip-${item.local_sync_status}`}>{item.local_sync_status === 'pending' ? 'Pending sync' : item.local_sync_status}</small> : item.brand ? <small>{item.brand}</small> : item.notes ? <small>{item.notes}</small> : null}</span></button></td>
                      <td><strong className="quantity-value">{formatQuantity(item.quantity, item.unit)}</strong>{item.quantity === 0 ? <span className="status-chip">Out of stock</span> : isLowStock(item) ? <span className="status-chip warning-chip">Low stock</span> : null}</td>
                      <td>{item.category ? <span className="soft-chip">{item.category.name}</span> : <span className="muted">—</span>}</td>
                      <td>{item.location ? <span className="location-value"><MapPin size={15} /> {item.location.name}</span> : <span className="muted">—</span>}</td>
                      <td>{item.expires_on ? <span className={`expiry-value expiry-${expiryState(item)}`}>{formatExpiry(item.expires_on)}</span> : <span className="muted">—</span>}</td>
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
                    {item.image_url ? <img className="item-avatar item-photo" src={item.image_url} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="item-avatar">{item.name.slice(0, 1).toUpperCase()}</span>}
                    <span className="card-copy"><span className="card-title-line"><strong>{item.name}</strong>{isLowStock(item) ? <span className="status-dot" title="Low stock" /> : null}</span><span>{item.local_sync_status ? 'Pending sync · ' : ''}{item.category?.name ?? 'Uncategorised'} · {item.location?.name ?? 'No location'}</span><ExpiryChip item={item} /></span>
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
        {scanMessage ? <div className="notice notice-warning" role="status"><div><p>{scanMessage}</p></div></div> : null}
        <ItemForm
          key={editingItem?.id ?? prefill?.barcode ?? 'new'}
          householdId={householdId}
          items={items}
          categories={categories.data ?? []}
          locations={locations.data ?? []}
          item={editingItem}
          prefill={prefill}
          onClose={() => setItemFormOpen(false)}
          onEditItem={(nextItem) => { setPrefill(undefined); setEditingItem(nextItem) }}
        />
      </Modal>

      <BarcodeScannerModal
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onDetected={(barcode) => {
          setScannerOpen(false)
          scanLookup.mutate(barcode)
        }}
      />

      <PhotoScanModal
        open={photoOpen}
        householdId={householdId}
        categories={categories.data ?? []}
        locations={locations.data ?? []}
        onClose={() => setPhotoOpen(false)}
      />

      <Modal open={Boolean(deletingItem)} onClose={() => setDeletingItem(undefined)} title={`Delete ${deletingItem?.name ?? 'item'}?`} description="This permanently removes the item for everyone in your household." size="small">
        {deleteMutation.isError ? <ErrorNotice message={getErrorMessage(deleteMutation.error)} /> : null}
        <div className="modal-actions"><Button variant="secondary" onClick={() => setDeletingItem(undefined)}>Keep item</Button><Button variant="danger" busy={deleteMutation.isPending} onClick={() => deletingItem && deleteMutation.mutate(deletingItem)}><Trash2 size={17} /> Delete permanently</Button></div>
      </Modal>
    </AppShell>
  )
}
