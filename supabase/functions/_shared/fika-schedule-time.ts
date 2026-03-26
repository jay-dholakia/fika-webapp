/** Same as lib/fika-schedule-time.ts — keep in sync for Deno Edge. */

import { localDateTimeInTzToUtcMs } from './wall-time-to-utc.ts'
import { getIanaTimezoneForMarketSlug } from './market-timezones.ts'

export function getFikaDateFromSlot(weekAnchorMonday: string, slotId: string): string {
  const monday = new Date(weekAnchorMonday + 'T12:00:00Z')
  const dayMap: Record<string, number> = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 }
  const dayPrefix = slotId.slice(0, 3).toLowerCase()
  const offset = dayMap[dayPrefix] ?? 2
  monday.setUTCDate(monday.getUTCDate() + offset)
  return monday.toISOString().slice(0, 10)
}

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

export function getTodayYmdInTimezone(timeZone: string): string {
  return new Date().toLocaleDateString('en-CA', { timeZone })
}
