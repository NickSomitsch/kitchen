import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import type { GroceryItem, InventoryItem } from '../types/database'
import { createGroceryItem } from '../api/kitchen'
import { GroceryItemForm } from './GroceryItemForm'

vi.mock('../api/kitchen', async (importOriginal) => {
  const original = await importOriginal<typeof import('../api/kitchen')>()
  return {
    ...original,
    createGroceryItem: vi.fn().mockResolvedValue({ grocery_item_id: 'new', created: true }),
    updateGroceryItem: vi.fn().mockResolvedValue(undefined),
  }
})

const inventory: InventoryItem = {
  id: 'inventory-1', household_id: 'household-1', name: 'Milk', quantity: 1, unit: 'l',
  category_id: null, location_id: null, notes: null, low_stock_threshold: .5,
  created_by: 'user-1', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  version: 1, category: null, location: null,
}

function grocery(overrides: Partial<GroceryItem> = {}): GroceryItem {
  return {
    id: 'grocery-1', household_id: 'household-1', inventory_item_id: null, name: 'Bread',
    quantity: null, unit: null, category_id: null, notes: null, source: 'manual', status: 'active',
    stocked: false, created_by: 'user-1', completed_by: null, completed_at: null,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', version: 1,
    category: null, inventory_item: null, ...overrides,
  }
}

function renderForm(item?: GroceryItem, groceries: GroceryItem[] = []) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <GroceryItemForm householdId="household-1" groceries={groceries} inventory={[inventory]} categories={[]} item={item} onClose={vi.fn()} onExisting={vi.fn()} />
    </QueryClientProvider>,
  )
}

describe('GroceryItemForm', () => {
  it('warns about active free-form duplicates without blocking intentional additions', async () => {
    const user = userEvent.setup()
    renderForm(undefined, [grocery()])
    await user.type(screen.getByLabelText(/Name/), ' bread ')
    expect(screen.getByText(/already exists/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add to groceries' })).toBeEnabled()
  })

  it('keeps automatic entries linked to their inventory item', () => {
    renderForm(grocery({
      inventory_item_id: inventory.id,
      name: inventory.name,
      source: 'low_stock',
      inventory_item: { id: inventory.id, name: inventory.name, quantity: inventory.quantity, unit: inventory.unit, low_stock_threshold: inventory.low_stock_threshold },
    }))
    expect(screen.getByLabelText(/Link to inventory/)).toBeDisabled()
    expect(screen.getByLabelText(/Name/)).toBeDisabled()
  })

  it('populates required fields when linking a new grocery to inventory', async () => {
    const user = userEvent.setup()
    renderForm()
    await user.selectOptions(screen.getByLabelText(/Link to inventory/), inventory.id)
    expect(screen.getByLabelText(/Name/)).toHaveValue('Milk')
    await user.click(screen.getByRole('button', { name: 'Add to groceries' }))
    await waitFor(() => expect(createGroceryItem).toHaveBeenCalledWith(expect.objectContaining({
      inventory_item_id: inventory.id,
      name: inventory.name,
    })))
  })
})
