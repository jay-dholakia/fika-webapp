import { getMarketBySlug } from '@/lib/markets'

/** Snap a calendar YYYY-MM-DD (from `<input type="date">`) to the Monday of that week (local). */
export function snapDatePickerValueToMondayYmd(ymd: string): string {
  const parts = ymd.trim().split('-').map(Number)
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return ymd
  const [y, mo, d] = parts
  const date = new Date(y, mo - 1, d)
  if (Number.isNaN(date.getTime())) return ymd
  const day = date.getDay()
  const delta = day === 0 ? -6 : 1 - day
  date.setDate(date.getDate() + delta)
  const yy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

/**
 * Rough filter: venue `city` vs static market city patterns (`lib/markets`).
 * When the slug has no patterns in code, returns true so admins still see venues (with a note from the API).
 */
export function venueCityLikelyInMarket(city: string | null | undefined, marketSlug: string): boolean {
  const m = getMarketBySlug(marketSlug)
  if (!m) return true
  if (!city?.trim()) return false
  const lower = city.trim().toLowerCase()
  return m.cityPatterns.some((p) => lower.includes(p))
}
