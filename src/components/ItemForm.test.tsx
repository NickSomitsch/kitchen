import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import type { InventoryItem } from '../types/database'
import { ItemForm } from './ItemForm'

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}))

vi.mock('../api/kitchen', async (importOriginal) => {
  const original = await importOriginal<typeof import('../api/kitchen')>()
  return {
    ...original,
    createInventoryItem: vi.fn().mockResolvedValue(undefined),
    updateInventoryItem: vi.fn().mockResolvedValue(undefined),
  }
})

function inventoryItem(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id: 'item-1',
    household_id: 'household-1',
    name: 'Flour',
    quantity: 1,
    unit: 'kg',
    category_id: null,
    location_id: null,
    notes: null,
    created_by: 'user-1',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    version: 1,
    category: null,
    location: null,
    ...overrides,
  }
}

function renderForm(item?: InventoryItem, items = item ? [item] : []) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ItemForm
        householdId="household-1"
        items={items}
        categories={[]}
        locations={[]}
        item={item}
        onClose={vi.fn()}
        onEditItem={vi.fn()}
      />
    </QueryClientProvider>,
  )
}

describe('ItemForm', () => {
  it('converts compatible units while editing', async () => {
    const user = userEvent.setup()
    renderForm(inventoryItem())
    await user.selectOptions(screen.getByLabelText(/Unit/), 'g')
    expect(screen.getByLabelText(/Quantity/)).toHaveValue(1000)
  })

  it('clears quantity when changing to an incompatible unit family', async () => {
    const user = userEvent.setup()
    renderForm(inventoryItem({ quantity: 2, unit: 'piece' }))
    await user.selectOptions(screen.getByLabelText(/Unit/), 'kg')
    expect(screen.getByLabelText(/Quantity/)).toHaveValue(null)
  })

  it('warns about duplicate names without blocking the form', async () => {
    const user = userEvent.setup()
    renderForm(undefined, [inventoryItem()])
    await user.clear(screen.getByLabelText(/Item name/))
    await user.type(screen.getByLabelText(/Item name/), ' FLOUR ')
    expect(screen.getByText(/already exists/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Add to inventory/ })).toBeEnabled()
  })
})

