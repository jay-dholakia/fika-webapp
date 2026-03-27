import { getFikaTimeMs } from '@/lib/fika-schedule-time'
import { slotIdToDisplayTime } from '@/lib/sms-agent'

/** Pull a US 5-digit zip from venue fields (address often contains "CA 90016"). */
export function extractZipFromVenueParts(
  address: string | null | undefined,
  neighborhood: string | null | undefined,
  city: string | null | undefined
): string | null {
  const blob = [address, neighborhood, city].filter(Boolean).join(' ')
  const m = blob.match(/\b(\d{5})(?:-\d{4})?\b/)
  return m?.[1] ?? null
}

/** Venue line: "Name (90016)" with zip when available, else short area fallback. */
export function formatYoureAllSetVenueLine(
  venueName: string,
  address: string | null | undefined,
  neighborhood: string | null | undefined,
  city: string | null | undefined
): string {
  const zip = extractZipFromVenueParts(address, neighborhood, city)
  if (zip) return `${venueName} (${zip})`
  const area = neighborhood?.trim() || city?.trim()
  if (area) return `${venueName} (${area})`
  return venueName
}

/** Second line: "Mon (3/31) — 1pm" in the match market timezone. */
export function formatYoureAllSetDateLine(weekAnchorMonday: string, slotId: string, timeZone: string): string {
  const { time: timeStr } = slotIdToDisplayTime(slotId)
  const ms = getFikaTimeMs(weekAnchorMonday, slotId, timeZone)
  if (ms == null) {
    const { day } = slotIdToDisplayTime(slotId)
    const short = day.length >= 3 ? day[0]!.toUpperCase() + day.slice(1).toLowerCase() : day
    return `${short} — ${timeStr}`
  }
  const d = new Date(ms)
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone }).format(d)
  const monthDay = new Intl.DateTimeFormat('en-US', { month: 'numeric', day: 'numeric', timeZone }).format(d)
  return `${weekday} (${monthDay}) — ${timeStr}`
}
