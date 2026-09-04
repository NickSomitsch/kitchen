import type { InventoryItem } from '../types/database'

/** Items within this many days of their date are surfaced as "use soon". */
export const USE_SOON_DAYS = 5

export type ExpiryState = 'none' | 'expired' | 'today' | 'soon' | 'later'

/** Parses a `YYYY-MM-DD` column as a local calendar day, never a UTC instant. */
export function parseLocalDate(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return null
  const date = new Date(year, month - 1, day)
  return Number.isNaN(date.getTime()) ? null : date
}

export function toDateInput(date: Date) {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

/** Whole days from today until the given date. Negative once the date has passed. */
export function daysUntil(value: string, today = new Date()) {
  const date = parseLocalDate(value)
  if (!date) return null
  return Math.round((startOfDay(date).getTime() - startOfDay(today).getTime()) / 86_400_000)
}

export function expiryState(
  item: Pick<InventoryItem, 'expires_on'>,
  today = new Date(),
): ExpiryState {
  if (!item.expires_on) return 'none'
  const days = daysUntil(item.expires_on, today)
  if (days === null) return 'none'
  if (days < 0) return 'expired'
  if (days === 0) return 'today'
  if (days <= USE_SOON_DAYS) return 'soon'
  return 'later'
}

export function isExpiringSoon(item: Pick<InventoryItem, 'expires_on'>, today = new Date()) {
  const state = expiryState(item, today)
  return state === 'expired' || state === 'today' || state === 'soon'
}

export function formatExpiry(value: string, today = new Date()) {
  const days = daysUntil(value, today)
  if (days === null) return 'No date'
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days === -1) return 'Yesterday'
  if (days < 0) return `${Math.abs(days)} days ago`
  if (days <= 30) return `In ${days} days`
  const date = parseLocalDate(value)
  return date
    ? new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' }).format(date)
    : 'No date'
}

/** Everything that needs eating, soonest first. */
export function expiringItems(items: InventoryItem[], today = new Date()) {
  return items
    .filter((item) => item.quantity > 0 && isExpiringSoon(item, today))
    .sort((left, right) => (left.expires_on ?? '').localeCompare(right.expires_on ?? ''))
}
