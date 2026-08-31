import {
  Check,
  CirclePlus,
  Clock3,
  Pencil,
  RotateCcw,
  ShoppingBasket,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import {
  clearGroceryHistory,
  createGroceryItem,
  deleteGroceryItem,
  fetchCategories,
  fetchGroceries,
  fetchInventory,
  fetchLocations,
  queryKeys,
  repeatGroceryItem,
  updateInventoryItem,
} from '../api/kitchen'
import { AppShell } from '../components/AppShell'
import { GroceryItemForm } from '../components/GroceryItemForm'
import { PurchaseForm } from '../components/PurchaseForm'
import { Button, ErrorNotice, LoadingScreen, Modal } from '../components/ui'
import { useHousehold } from '../hooks/useHousehold'
import { getErrorMessage } from '../lib/errors'
import { findGroceryDuplicate, formatQuantity, groupActiveGroceries, isLowStock } from '../lib/inventory'
import type { GroceryItem } from '../types/database'

function relativeDate(value: string) {
  const difference = Math.round((new Date(value).getTime() - Date.now()) / 86_400_000)
  if (Math.abs(difference) < 1) return 'Today'
  return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(difference, 'day')
}

export function GroceryPage() {
  const household = useHousehold()
  const queryClient = useQueryClient()
  const householdId = household.data?.household.id ?? ''
  const [quickName, setQuickName] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<GroceryItem>()
  const [purchasingItem, setPurchasingItem] = useState<GroceryItem>()
  const [deletingItem, setDeletingItem] = useState<GroceryItem>()
  const [clearHistoryOpen, setClearHistoryOpen] = useState(false)

  const groceries = useQuery({
    queryKey: queryKeys.groceries(householdId),
    queryFn: () => fetchGroceries(householdId),
    enabled: Boolean(householdId),
  })
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

  const allItems = useMemo(() => groceries.data ?? [], [groceries.data])
  const activeGroups = useMemo(() => groupActiveGroceries(allItems), [allItems])
  const activeItems = allItems.filter((item) => item.status === 'active')
  const completedItems = allItems
    .filter((item) => item.status === 'purchased')
    .sort((left, right) => new Date(right.completed_at ?? 0).getTime() - new Date(left.completed_at ?? 0).getTime())
  const lowStockCount = activeItems.filter((item) => item.source === 'low_stock' || (item.inventory_item && isLowStock(item.inventory_item))).length
  const quickDuplicate = findGroceryDuplicate(allItems, quickName)

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.groceries(householdId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.inventory(householdId) }),
    ])
  }

  const quickAdd = useMutation({
    mutationFn: () => createGroceryItem({
      inventory_item_id: null,
      name: quickName.trim(),
      quantity: null,
      unit: null,
      category_id: null,
      notes: null,
    }),
    onSuccess: async () => {
      setQuickName('')
      await refresh()
    },
  })
  const deleteMutation = useMutation({
    mutationFn: async (item: GroceryItem) => {
      if (item.source === 'low_stock' && item.status === 'active') {
        const inventoryItem = (inventory.data ?? []).find((candidate) => candidate.id === item.inventory_item_id)
        if (!inventoryItem) throw new Error('The linked inventory item is no longer available.')
        await updateInventoryItem(inventoryItem, {
          name: inventoryItem.name,
          quantity: inventoryItem.quantity,
          unit: inventoryItem.unit,
          category_id: inventoryItem.category_id,
          location_id: inventoryItem.location_id,
          notes: inventoryItem.notes,
          low_stock_threshold: null,
        })
        return
      }
      await deleteGroceryItem(item)
    },
    onSuccess: async () => {
      setDeletingItem(undefined)
      await refresh()
    },
  })
  const repeatMutation = useMutation({
    mutationFn: repeatGroceryItem,
    onSuccess: refresh,
  })
  const clearMutation = useMutation({
    mutationFn: clearGroceryHistory,
    onSuccess: async () => {
      setClearHistoryOpen(false)
      await refresh()
    },
  })

  if (household.isLoading) return <LoadingScreen />
  if (household.isError) return <ErrorNotice message={getErrorMessage(household.error)} onRetry={() => void household.refetch()} />
  if (!household.data) return <Navigate to="/onboarding" replace />

  const queryError = groceries.error ?? inventory.error ?? categories.error ?? locations.error
  const isLoading = groceries.isLoading || inventory.isLoading || categories.isLoading || locations.isLoading

  function openCreate() {
    setEditingItem(undefined)
    setFormOpen(true)
  }

  function openExisting(id: string) {
    const existing = allItems.find((item) => item.id === id)
    if (existing) {
      setEditingItem(existing)
      setFormOpen(true)
    }
  }

  return (
    <AppShell context={household.data}>
      <div className="page-container grocery-page">
        <header className="page-heading grocery-heading">
          <div>
            <p className="eyebrow">Shared shopping</p>
            <h1>Groceries</h1>
            <p>{activeItems.length} active {activeItems.length === 1 ? 'item' : 'items'}{lowStockCount ? ` · ${lowStockCount} from low stock` : ''}</p>
          </div>
          <Button onClick={openCreate}><CirclePlus size={18} /> Add details</Button>
        </header>

        <form className="quick-add" onSubmit={(event) => {
          event.preventDefault()
          if (quickName.trim()) quickAdd.mutate()
        }}>
          <ShoppingBasket size={20} />
          <label className="sr-only" htmlFor="quick-grocery">Quick-add grocery</label>
          <input id="quick-grocery" value={quickName} maxLength={120} onChange={(event) => setQuickName(event.target.value)} placeholder="Quick add an item…" />
          <Button type="submit" busy={quickAdd.isPending} disabled={!quickName.trim()}>Add</Button>
        </form>
        {quickDuplicate ? (
          <div className="quick-duplicate"><span>“{quickDuplicate.name}” is already active.</span><button onClick={() => openExisting(quickDuplicate.id)}>Open it</button><span>or add another intentionally.</span></div>
        ) : null}
        {quickAdd.isError ? <ErrorNotice message={getErrorMessage(quickAdd.error)} /> : null}

        {queryError ? (
          <ErrorNotice message={getErrorMessage(queryError)} onRetry={() => {
            void groceries.refetch(); void inventory.refetch(); void categories.refetch(); void locations.refetch()
          }} />
        ) : isLoading ? (
          <div className="inventory-skeleton" aria-label="Loading grocery list"><span /><span /><span /></div>
        ) : !activeItems.length ? (
          <section className="empty-state compact grocery-empty">
            <ShoppingBasket size={38} />
            <h2>Your grocery list is clear</h2>
            <p>Add something you need, or configure a low-stock rule in Inventory.</p>
            <Button onClick={openCreate}><CirclePlus size={18} /> Add your first grocery</Button>
          </section>
        ) : (
          <div className="grocery-groups">
            {activeGroups.map((group) => (
              <section className="grocery-group" key={group.id ?? 'uncategorized'}>
                <header><h2>{group.name}</h2><span>{group.items.length}</span></header>
                <div className="grocery-list">
                  {group.items.map((item) => (
                    <article className="grocery-row" key={item.id}>
                      <button className="purchase-check" onClick={() => setPurchasingItem(item)} aria-label={`Mark ${item.name} purchased`}><Check size={19} /></button>
                      <button className="grocery-main" onClick={() => { setEditingItem(item); setFormOpen(true) }}>
                        <span className="grocery-title"><strong>{item.name}</strong>{item.source === 'low_stock' ? <span className="auto-chip"><Sparkles size={12} /> Automatic</span> : null}</span>
                        <span>{item.quantity && item.unit ? formatQuantity(item.quantity, item.unit) : 'Amount not set'}{item.notes ? ` · ${item.notes}` : ''}</span>
                      </button>
                      <div className="grocery-actions">
                        <button onClick={() => { setEditingItem(item); setFormOpen(true) }} aria-label={`Edit ${item.name}`}><Pencil size={17} /></button>
                        <button className="danger-icon" onClick={() => setDeletingItem(item)} aria-label={item.source === 'low_stock' ? `Disable low-stock rule for ${item.name}` : `Delete ${item.name}`}><Trash2 size={17} /></button>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}

        {completedItems.length ? (
          <details className="grocery-history">
            <summary><span><Clock3 size={18} /> Recently purchased</span><b>{completedItems.length}</b></summary>
            <div className="history-toolbar"><p>Completed items stay here until your household clears them.</p><Button variant="ghost" onClick={() => setClearHistoryOpen(true)}><Trash2 size={15} /> Clear history</Button></div>
            <div className="history-list">
              {completedItems.map((item) => (
                <article key={item.id}>
                  <div><strong>{item.name}</strong><span>{item.quantity && item.unit ? formatQuantity(item.quantity, item.unit) : 'No amount'} · {item.stocked ? 'Added to inventory' : 'Not stocked'} · {relativeDate(item.completed_at ?? item.updated_at)}</span></div>
                  <button onClick={() => repeatMutation.mutate(item)} disabled={repeatMutation.isPending}><RotateCcw size={16} /> Add again</button>
                  <button className="danger-icon" onClick={() => setDeletingItem(item)} aria-label={`Permanently delete ${item.name}`}><Trash2 size={16} /></button>
                </article>
              ))}
            </div>
          </details>
        ) : null}
      </div>

      <Modal open={formOpen} onClose={() => setFormOpen(false)} title={editingItem ? 'Edit grocery item' : 'Add grocery item'} description={editingItem?.source === 'low_stock' ? 'This entry is managed by its inventory threshold; you can set the amount and notes.' : 'Add something for everyone in your household to see.'}>
        <GroceryItemForm
          householdId={householdId}
          groceries={allItems}
          inventory={inventory.data ?? []}
          categories={categories.data ?? []}
          item={editingItem}
          onClose={() => setFormOpen(false)}
          onExisting={openExisting}
        />
      </Modal>

      <Modal open={Boolean(purchasingItem)} onClose={() => setPurchasingItem(undefined)} title={`Purchased ${purchasingItem?.name ?? 'item'}?`} description="Review the amount and decide whether to update your inventory.">
        {purchasingItem ? <PurchaseForm householdId={householdId} item={purchasingItem} inventory={inventory.data ?? []} locations={locations.data ?? []} onClose={() => setPurchasingItem(undefined)} /> : null}
      </Modal>

      <Modal open={Boolean(deletingItem)} onClose={() => setDeletingItem(undefined)} title={deletingItem?.source === 'low_stock' && deletingItem.status === 'active' ? `Disable ${deletingItem?.name ?? ''} low-stock rule?` : `Delete ${deletingItem?.name ?? 'item'}?`} description={deletingItem?.source === 'low_stock' && deletingItem.status === 'active' ? 'This turns off the threshold and removes its automatic grocery entry.' : 'This permanently removes the grocery entry for everyone.'} size="small">
        {deleteMutation.isError ? <ErrorNotice message={getErrorMessage(deleteMutation.error)} /> : null}
        <div className="modal-actions"><Button variant="secondary" onClick={() => setDeletingItem(undefined)}>Cancel</Button><Button variant="danger" busy={deleteMutation.isPending} onClick={() => deletingItem && deleteMutation.mutate(deletingItem)}><Trash2 size={17} /> {deletingItem?.source === 'low_stock' && deletingItem.status === 'active' ? 'Disable rule' : 'Delete permanently'}</Button></div>
      </Modal>

      <Modal open={clearHistoryOpen} onClose={() => setClearHistoryOpen(false)} title="Clear purchase history?" description={`This permanently removes ${completedItems.length} completed ${completedItems.length === 1 ? 'entry' : 'entries'} for everyone.`} size="small">
        {clearMutation.isError ? <ErrorNotice message={getErrorMessage(clearMutation.error)} /> : null}
        <div className="modal-actions"><Button variant="secondary" onClick={() => setClearHistoryOpen(false)}>Keep history</Button><Button variant="danger" busy={clearMutation.isPending} onClick={() => clearMutation.mutate()}><Trash2 size={17} /> Clear permanently</Button></div>
      </Modal>
    </AppShell>
  )
}
