import { Filter, RotateCcw, Search, SlidersHorizontal } from 'lucide-react'
import { UNITS } from '../lib/inventory'
import type {
  Category,
  InventoryFilters as InventoryFiltersValue,
  InventorySort,
  StorageLocation,
  Unit,
} from '../types/database'
import { Button } from './ui'

function CheckboxMenu({
  label,
  options,
  selected,
  onChange,
}: {
  label: string
  options: { value: string; label: string }[]
  selected: string[]
  onChange: (values: string[]) => void
}) {
  return (
    <details className="filter-menu">
      <summary className={selected.length ? 'has-value' : ''}>
        {label}{selected.length ? ` · ${selected.length}` : ''}
      </summary>
      <div className="filter-popover">
        {options.map((option) => (
          <label key={option.value}>
            <input
              type="checkbox"
              checked={selected.includes(option.value)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...selected, option.value]
                    : selected.filter((value) => value !== option.value),
                )
              }
            />
            <span>{option.label}</span>
          </label>
        ))}
        {!options.length ? <p className="filter-empty">No options yet.</p> : null}
      </div>
    </details>
  )
}

export function InventoryFilters({
  filters,
  sort,
  categories,
  locations,
  onFiltersChange,
  onSortChange,
  onClear,
  activeCount,
}: {
  filters: InventoryFiltersValue
  sort: InventorySort
  categories: Category[]
  locations: StorageLocation[]
  onFiltersChange: (filters: InventoryFiltersValue) => void
  onSortChange: (sort: InventorySort) => void
  onClear: () => void
  activeCount: number
}) {
  return (
    <section className="inventory-tools" aria-label="Search, filter, and sort inventory">
      <label className="search-box">
        <Search size={19} />
        <input
          type="search"
          placeholder="Search your kitchen…"
          value={filters.search}
          onChange={(event) => onFiltersChange({ ...filters, search: event.target.value })}
        />
      </label>
      <div className="filter-row">
        <span className="filter-label"><Filter size={16} /> Filters</span>
        <CheckboxMenu
          label="Category"
          options={categories.map((category) => ({ value: category.id, label: category.name }))}
          selected={filters.categoryIds}
          onChange={(categoryIds) => onFiltersChange({ ...filters, categoryIds })}
        />
        <CheckboxMenu
          label="Location"
          options={locations.map((location) => ({ value: location.id, label: location.name }))}
          selected={filters.locationIds}
          onChange={(locationIds) => onFiltersChange({ ...filters, locationIds })}
        />
        <CheckboxMenu
          label="Unit"
          options={UNITS.map((unit) => ({ value: unit.value, label: unit.label }))}
          selected={filters.units}
          onChange={(units) => onFiltersChange({ ...filters, units: units as Unit[] })}
        />
        <label className="select-control compact">
          <span className="sr-only">Stock status</span>
          <select
            value={filters.stock}
            onChange={(event) =>
              onFiltersChange({
                ...filters,
                stock: event.target.value as InventoryFiltersValue['stock'],
              })
            }
          >
            <option value="all">All stock</option>
            <option value="in-stock">In stock</option>
            <option value="out-of-stock">Out of stock</option>
          </select>
        </label>
        <div className="toolbar-spacer" />
        {activeCount ? (
          <Button variant="ghost" onClick={onClear} className="clear-filter">
            <RotateCcw size={15} /> Clear {activeCount}
          </Button>
        ) : null}
        <label className="sort-control">
          <SlidersHorizontal size={16} />
          <span className="sr-only">Sort inventory</span>
          <select
            value={`${sort.field}:${sort.direction}`}
            onChange={(event) => {
              const [field, direction] = event.target.value.split(':') as [
                InventorySort['field'],
                InventorySort['direction'],
              ]
              onSortChange({ field, direction })
            }}
          >
            <option value="name:asc">Name A–Z</option>
            <option value="name:desc">Name Z–A</option>
            <option value="quantity:asc">Quantity low–high</option>
            <option value="quantity:desc">Quantity high–low</option>
            <option value="category:asc">Category A–Z</option>
            <option value="location:asc">Location A–Z</option>
            <option value="updated_at:desc">Recently updated</option>
            <option value="updated_at:asc">Least recently updated</option>
          </select>
        </label>
      </div>
    </section>
  )
}

