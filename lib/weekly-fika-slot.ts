import { AVAILABILITY_DAYS } from '@/lib/availability-slots'

const AVAIL_DAY = new Set<string>(AVAILABILITY_DAYS)

/**
 * Map session Fika wall time (UTC instant) into a Wed–Sat availability slot id (e.g. wed_14_30).
 * Uses `ianaTz` for local weekday and clock. Returns null if the local day is outside Wed–Sat.
 */
export function availabilitySlotIdFromUtcInTimezone(utcIso: string, ianaTz: string): string | null {
  const d = new Date(utcIso)
  if (Number.isNaN(d.getTime())) return null

  const weekdayLong = new Intl.DateTimeFormat('en-US', {
    timeZone: ianaTz,
    weekday: 'long',
  })
    .format(d)
    .toLowerCase()

  const dayMap: Record<string, string> = {
    wednesday: 'wed',
    thursday: 'thu',
    friday: 'fri',
    saturday: 'sat',
  }
  const dayPrefix = dayMap[weekdayLong]
  if (!dayPrefix || !AVAIL_DAY.has(dayPrefix)) return null

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: ianaTz,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d)

  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 'NaN')
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 'NaN')
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null

  let totalMinutes = hour * 60 + minute
  totalMinutes = Math.floor(totalMinutes / 30) * 30
  totalMinutes = Math.max(9 * 60, Math.min(18 * 60 + 30, totalMinutes))

  const fh = Math.floor(totalMinutes / 60)
  const fm = totalMinutes % 60
  const block = `${String(fh).padStart(2, '0')}_${fm === 30 ? '30' : '00'}`
  return `${dayPrefix}_${block}`
}
