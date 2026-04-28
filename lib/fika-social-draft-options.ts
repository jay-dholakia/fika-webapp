import { getMarketBySlug } from '@/lib/markets'
import { localDateTimeInTzToUtcMs } from '@/lib/wall-time-to-utc'

/**
 * Monday YYYY-MM-DD of the ISO (Mon–Sun) week that contains this Gregorian date.
 * Uses UTC date math so the same calendar day string always yields the same anchor regardless of browser TZ.
 */
export function mondayAnchorFromGregorianDateYmd(dateYmd: string): string | null {
  const t = dateYmd.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null
  const [y, mo, d] = t.split('-').map(Number)
  const date = new Date(Date.UTC(y, mo - 1, d))
  if (Number.isNaN(date.getTime())) return null
  const dow = date.getUTCDay()
  const delta = dow === 0 ? -6 : 1 - dow
  date.setUTCDate(date.getUTCDate() + delta)
  return date.toISOString().slice(0, 10)
}

/** Combine civil date + time interpreted in `ianaTz` → ISO timestamp for DB. */
export function fikaStartsAtIsoFromDateAndTimeInZone(dateYmd: string, timeHHmm: string, ianaTz: string): string | null {
  const trimmed = timeHHmm.trim()
  const m = /^(\d{1,2}):(\d{2})$/.exec(trimmed)
  if (!m) return null
  const hh = Number(m[1])
  const minute = Number(m[2])
  if (!Number.isFinite(hh) || !Number.isFinite(minute) || hh > 23 || minute > 59) return null
  const utcMs = localDateTimeInTzToUtcMs(dateYmd.trim(), hh, minute, ianaTz)
  if (utcMs == null) return null
  return new Date(utcMs).toISOString()
}

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
