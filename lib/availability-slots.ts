/**
 * Doodle-style availability for the week after batch_week.
 * Slots: Mon–Sun × 30-minute increments from 9am to 7pm (20 slots per day).
 * Slot id format: day_HH_MM (e.g. mon_09_00, mon_18_30).
 */

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const

// 9am to 7pm in 30-min increments (9:00, 9:30, ... 18:30; 7pm is end of last slot)
const HALF_HOUR_SLOTS: { id: string; label: string }[] = (() => {
  const out: { id: string; label: string }[] = []
  for (let h = 9; h <= 18; h++) {
    for (const m of ['00', '30']) {
      const id = `${h.toString().padStart(2, '0')}_${m}`
      let label: string
      if (h === 12 && m === '00') label = '12p'
      else if (h === 12 && m === '30') label = '12:30'
      else if (h > 12) label = m === '00' ? `${h - 12}p` : `${h - 12}:30`
      else if (h === 9 && m === '00') label = '9a'
      else if (h === 9 && m === '30') label = '9:30'
      else label = m === '00' ? `${h}a` : `${h}:30`
      out.push({ id, label })
    }
  }
  return out
})()

export const AVAILABILITY_SLOT_IDS: string[] = DAYS.flatMap((day) =>
  HALF_HOUR_SLOTS.map((s) => `${day}_${s.id}`)
)

const DAY_LABELS: Record<string, string> = {
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun',
}

const SLOT_BY_ID = new Map(HALF_HOUR_SLOTS.map((s) => [s.id, s]))

export function getAvailabilitySlotLabel(slotId: string): string {
  const parts = slotId.split('_')
  const day = parts[0]
  const blockId = parts.slice(1).join('_') // e.g. 09_00 or 18_30
  const slot = SLOT_BY_ID.get(blockId)
  const dayLabel = day ? DAY_LABELS[day] ?? day : ''
  return slot ? `${dayLabel} ${slot.label}` : slotId
}

/** Group slot IDs by day for display. */
export function groupSlotsByDay(slotIds: string[]): { day: string; slots: string[] }[] {
  return DAYS.map((day) => ({
    day: DAY_LABELS[day] ?? day,
    slots: slotIds.filter((id) => id.startsWith(day + '_')),
  }))
}

/** Day labels in order (Mon–Sun) for column headers. */
export const AVAILABILITY_DAY_LABELS: string[] = DAYS.map((d) => DAY_LABELS[d] ?? d)

/** Time-slot rows for the y-axis (9a–6:30p). */
export const AVAILABILITY_TIME_ROWS: { id: string; label: string }[] = [...HALF_HOUR_SLOTS]

/** Slot id for a grid cell: dayIndex 0–6, timeIndex 0–19. */
export function getAvailabilitySlotId(dayIndex: number, timeIndex: number): string {
  const day = DAYS[dayIndex]
  const time = HALF_HOUR_SLOTS[timeIndex]
  return day && time ? `${day}_${time.id}` : ''
}

/** Monday of the week after batch_week (YYYY-MM-DD). */
export function getNextWeekMonday(batchWeek: string): string {
  const d = new Date(batchWeek + 'T12:00:00')
  d.setDate(d.getDate() + 7)
  return d.toISOString().slice(0, 10)
}

/** Monday of the week we're setting availability for (same week the label shows). One day before "next" Monday. */
function getAvailabilityWeekMonday(batchWeek: string): string {
  const d = new Date(batchWeek + 'T12:00:00')
  d.setDate(d.getDate() + 6)
  return d.toISOString().slice(0, 10)
}

/** Sunday 6pm (local) of the availability week. Editing locks at this time before the intro run. */
export function getAvailabilityLockDate(nextWeekMonday: string): Date {
  const d = new Date(nextWeekMonday + 'T12:00:00')
  d.setDate(d.getDate() + 6) // Sunday
  d.setHours(18, 0, 0, 0)
  return d
}

/** True when availability for that week can no longer be edited (Sunday 6pm has passed). */
export function isAvailabilityLocked(batchWeek: string): boolean {
  const availabilityMonday = getAvailabilityWeekMonday(batchWeek)
  const lockAt = getAvailabilityLockDate(availabilityMonday)
  return new Date() >= lockAt
}

/** Human-readable date range for the availability week (e.g. "Mar 2 – 8"). */
export function formatNextWeekRange(batchWeek: string): string {
  const mon = new Date(getAvailabilityWeekMonday(batchWeek) + 'T12:00:00')
  const sun = new Date(mon)
  sun.setDate(sun.getDate() + 6)
  const monStr = mon.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const sunStr = sun.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${monStr} – ${sunStr}`
}
