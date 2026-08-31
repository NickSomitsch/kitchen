import type {
  InventoryFilters,
  InventoryItem,
  InventorySort,
  Unit,
} from '../types/database'

export const UNITS: { value: Unit; label: string; shortLabel: string }[] = [
  { value: 'g', label: 'Grams', shortLabel: 'g' },
  { value: 'kg', label: 'Kilograms', shortLabel: 'kg' },
  { value: 'ml', label: 'Millilitres', shortLabel: 'ml' },
  { value: 'l', label: 'Litres', shortLabel: 'l' },
  { value: 'piece', label: 'Pieces', shortLabel: 'pcs' },
  { value: 'package', label: 'Packages', shortLabel: 'pkg' },
]

type UnitGroup = 'mass' | 'volume' | 'piece' | 'package'

export function getUnitGroup(unit: Unit): UnitGroup {
  if (unit === 'g' || unit === 'kg') return 'mass'
  if (unit === 'ml' || unit === 'l') return 'volume'
  return unit
}

export function convertQuantity(quantity: number, from: Unit, to: Unit): number | null {
  if (from === to) return quantity
  if (from === 'g' && to === 'kg') return quantity / 1000
  if (from === 'kg' && to === 'g') return quantity * 1000
  if (from === 'ml' && to === 'l') return quantity / 1000
  if (from === 'l' && to === 'ml') return quantity * 1000
  return null
}

export function normalizedQuantity(item: Pick<InventoryItem, 'quantity' | 'unit'>) {
  switch (item.unit) {
    case 'kg':
      return { group: 0, quantity: item.quantity * 1000 }
    case 'g':
      return { group: 0, quantity: item.quantity }
    case 'l':
      return { group: 1, quantity: item.quantity * 1000 }
    case 'ml':
      return { group: 1, quantity: item.quantity }
    case 'piece':
      return { group: 2, quantity: item.quantity }
    case 'package':
      return { group: 3, quantity: item.quantity }
  }
}

export function formatQuantity(quantity: number, unit: Unit) {
  const amount = new Intl.NumberFormat('en', {
    maximumFractionDigits: 3,
  }).format(quantity)
  const unitLabel = UNITS.find((candidate) => candidate.value === unit)?.shortLabel ?? unit
  return `${amount} ${unitLabel}`
}

export function formatJoinCode(code: string) {
  const normalized = code.replace(/[^A-Z0-9]/gi, '').toUpperCase()
  return normalized.length > 5
    ? `${normalized.slice(0, 5)}-${normalized.slice(5, 10)}`
    : normalized
}

export function findDuplicate(
  items: InventoryItem[],
  name: string,
  excludedId?: string,
) {
  const normalized = name.trim().toLocaleLowerCase()
  if (!normalized) return undefined
  return items.find(
    (item) => item.id !== excludedId && item.name.trim().toLocaleLowerCase() === normalized,
  )
}

function compareText(left: string | null | undefined, right: string | null | undefined) {
  return (left ?? '').localeCompare(right ?? '', undefined, { sensitivity: 'base' })
}

export function filterAndSortInventory(
  items: InventoryItem[],
  filters: InventoryFilters,
  sort: InventorySort,
) {
  const search = filters.search.trim().toLocaleLowerCase()
  const filtered = items.filter((item) => {
    if (
      search &&
      !item.name.toLocaleLowerCase().includes(search) &&
      !item.notes?.toLocaleLowerCase().includes(search)
    ) {
      return false
    }
    if (filters.categoryIds.length && !filters.categoryIds.includes(item.category_id ?? '')) {
      return false
    }
    if (filters.locationIds.length && !filters.locationIds.includes(item.location_id ?? '')) {
      return false
    }
    if (filters.units.length && !filters.units.includes(item.unit)) return false
    if (filters.stock === 'in-stock' && item.quantity === 0) return false
    if (filters.stock === 'out-of-stock' && item.quantity !== 0) return false
    return true
  })

  return filtered.sort((left, right) => {
    let result = 0
    switch (sort.field) {
      case 'name':
        result = compareText(left.name, right.name)
        break
      case 'category':
        result = compareText(left.category?.name, right.category?.name)
        break
      case 'location':
        result = compareText(left.location?.name, right.location?.name)
        break
      case 'updated_at':
        result = new Date(left.updated_at).getTime() - new Date(right.updated_at).getTime()
        break
      case 'quantity': {
        const leftValue = normalizedQuantity(left)
        const rightValue = normalizedQuantity(right)
        result = leftValue.group - rightValue.group || leftValue.quantity - rightValue.quantity
        break
      }
    }
    if (result === 0) result = compareText(left.name, right.name)
    return sort.direction === 'asc' ? result : -result
  })
}

