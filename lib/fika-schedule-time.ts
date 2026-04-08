/**
 * Fika slot → calendar date / UTC instant. Slot wall-clock is interpreted in the match market's IANA zone.
 */

import { DEFAULT_MARKET_IANA_TIMEZONE, getIanaTimezoneForMarketSlug } from '@/lib/market-timezones'
import { localDateTimeInTzToUtcMs } from '@/lib/wall-time-to-utc'

/** Fika date (YYYY-MM-DD) from week anchor Monday + slotId (e.g. wed_14_30). Uses same calendar math as before (UTC-based week). */
export function getFikaDateFromSlot(weekAnchorMonday: string, slotId: string): string {
  const monday = new Date(weekAnchorMonday + 'T12:00:00Z')
  const dayMap: Record<string, number> = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 }
  const dayPrefix = slotId.slice(0, 3).toLowerCase()
  const offset = dayMap[dayPrefix] ?? 2
  monday.setUTCDate(monday.getUTCDate() + offset)
  return monday.toISOString().slice(0, 10)
}

/**
 * Fika start instant in UTC. `marketTimeZone` is the match market IANA zone (e.g. from `getMatchMarketTimezoneFromProfileMarkets`).
 * Omit or pass undefined → America/Los_Angeles for backward compatibility.
 */
export function getFikaTimeMs(
  weekAnchorMonday: string,
  slotId: string,
  marketTimeZone?: string
): number | null {
  const tz = marketTimeZone ?? getIanaTimezoneForMarketSlug(null)
  const dateStr = getFikaDateFromSlot(weekAnchorMonday, slotId)
  const parts = slotId.split('_')
  const hour = parseInt(parts[1] ?? '14', 10)
  const min = parseInt(parts[2] ?? '0', 10)
  return localDateTimeInTzToUtcMs(dateStr, hour, min, tz)
}

/** Today's date (YYYY-MM-DD) in a given IANA timezone. */
export function getTodayYmdInTimezone(timeZone: string): string {
  return new Date().toLocaleDateString('en-CA', { timeZone })
}

/** Today's date (YYYY-MM-DD) in America/Los_Angeles — legacy PT product assumption. */
export function getTodayPT(): string {
  return getTodayYmdInTimezone('America/Los_Angeles')
}

/** True if Fika calendar date (from slot) equals "today" in the match market's zone. */
export function isFikaToday(weekAnchorMonday: string, slotId: string, marketTimeZone?: string): boolean {
  const tz = marketTimeZone ?? DEFAULT_MARKET_IANA_TIMEZONE
  return getFikaDateFromSlot(weekAnchorMonday, slotId) === getTodayYmdInTimezone(tz)
}

/** Coordination relay opens this long before Fika start (SMS ↔ match, web when enabled). */
export const RELAY_OPEN_BEFORE_MS = 90 * 60 * 1000

export function isInRelayWindow(weekAnchorMonday: string, slotId: string, marketTimeZone?: string): boolean {
  const ms = getFikaTimeMs(weekAnchorMonday, slotId, marketTimeZone)
  if (ms == null) return false
  const now = Date.now()
  const opensAt = ms - RELAY_OPEN_BEFORE_MS
  const closesAt = ms + 2 * 60 * 60 * 1000
  return now >= opensAt && now <= closesAt
}

export function isRelayClosed(weekAnchorMonday: string, slotId: string, marketTimeZone?: string): boolean {
  const ms = getFikaTimeMs(weekAnchorMonday, slotId, marketTimeZone)
  return ms != null && Date.now() > ms + 2 * 60 * 60 * 1000
}
