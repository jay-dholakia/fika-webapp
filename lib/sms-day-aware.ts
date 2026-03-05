/**
 * Day-aware SMS: timezone from user location, phrase for "next Monday" (tomorrow / Monday / next Monday).
 */

import { find as geoFind } from 'geo-tz'

/**
 * Get IANA timezone (e.g. America/Los_Angeles) from lat/lng. Returns null if invalid or lookup fails.
 */
export function getTimezoneFromLatLng(lat: number | null | undefined, lng: number | null | undefined): string | null {
  if (lat == null || lng == null || typeof lat !== 'number' || typeof lng !== 'number') return null
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null
  try {
    const zones = geoFind(lat, lng)
    return Array.isArray(zones) && zones.length > 0 ? zones[0] : null
  } catch {
    return null
  }
}

/**
 * Day of week (0 = Sunday, 6 = Saturday) in the given IANA timezone for "now".
 */
function getDayOfWeekInTimezone(timezone: string): number {
  const now = new Date()
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false })
  const parts = formatter.formatToParts(now)
  const weekday = parts.find((p) => p.type === 'weekday')?.value
  const days: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return weekday != null && weekday in days ? days[weekday] : now.getUTCDay()
}

/**
 * Returns a phrase for "when we'll check in next Monday" that speaks as if we know the user's day.
 * - Sunday (user) → "tomorrow" (Monday is tomorrow)
 * - Saturday (user) → "Monday" (in 2 days)
 * - Otherwise → "next Monday"
 * Pass null timezone to fall back to "next Monday".
 */
export function getNextMondayPhrase(timezone: string | null): string {
  if (!timezone || typeof timezone !== 'string') return 'next Monday'
  const day = getDayOfWeekInTimezone(timezone)
  if (day === 0) return 'tomorrow' // Sunday → Monday is tomorrow
  if (day === 6) return 'Monday'   // Saturday → Monday in 2 days
  return 'next Monday'
}
