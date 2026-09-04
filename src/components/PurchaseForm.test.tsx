import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import type { GroceryItem, InventoryItem } from '../types/database'
import { PurchaseForm } from './PurchaseForm'

vi.mock('../api/kitchen', async (importOriginal) => {
  const original = await importOriginal<typeof import('../api/kitchen')>()
  return { ...original, completeGroceryItem: vi.fn().mockResolvedValue({ completed_grocery_item_id: 'grocery-1', stocked_inventory_item_id: 'inventory-1' }) }
})

const inventory: InventoryItem = {
  id: 'inventory-1', household_id: 'household-1', name: 'Milk', quantity: .25, unit: 'l',
  category_id: null, location_id: null, notes: null, low_stock_threshold: .5,
  barcode: null, brand: null, image_url: null, nutrition: null, expires_on: null,
  created_by: 'user-1', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  version: 1, category: null, location: null,
}
const grocery: GroceryItem = {
  id: 'grocery-1', household_id: 'household-1', inventory_item_id: inventory.id, name: inventory.name,
  quantity: null, unit: null, category_id: null, notes: null, source: 'low_stock', status: 'active',
  stocked: false, created_by: 'user-1', completed_by: null, completed_at: null,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', version: 1,
  category: null,
  inventory_item: { id: inventory.id, name: inventory.name, quantity: inventory.quantity, unit: inventory.unit, low_stock_threshold: inventory.low_stock_threshold },
}

function renderForm() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <PurchaseForm householdId="household-1" item={grocery} inventory={[inventory]} locations={[]} onClose={vi.fn()} />
    </QueryClientProvider>,
  )
}

describe('PurchaseForm', () => {
  it('defaults linked groceries to stocking the existing inventory item', () => {
    renderForm()
    expect(screen.getByRole('radio', { name: /Add to existing inventory/ })).toBeChecked()
    expect(screen.getByLabelText(/Inventory item/)).toHaveValue(inventory.id)
  })

  it('allows completing without stocking and hides quantity fields', async () => {
    const user = userEvent.setup()
    renderForm()
    await user.click(screen.getByRole('radio', { name: /Complete without stocking/ }))
    expect(screen.queryByLabelText(/Purchased quantity/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mark purchased' })).toBeEnabled()
  })
})
