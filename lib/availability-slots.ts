/**
 * Doodle-style availability for the match week.
 * Slots: Wed–Sun only × 30-minute increments from 9am to 7pm (20 slots per day).
 * Slot id format: day_HH_MM (e.g. wed_09_00, sun_18_30).
 */

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const

/** Days we collect availability for: Wed–Sun (no Mon/Tue; matches run Tuesday, confirm by Tuesday 11:59pm). */
export const AVAILABILITY_DAYS = ['wed', 'thu', 'fri', 'sat', 'sun'] as const

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

export const AVAILABILITY_SLOT_IDS: string[] = AVAILABILITY_DAYS.flatMap((day) =>
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

/** Day labels for the availability grid (Wed–Sun only). */
export const AVAILABILITY_DAY_LABELS: string[] = AVAILABILITY_DAYS.map((d) => DAY_LABELS[d] ?? d)

/** Time-slot rows for the y-axis (9a–6:30p). */
export const AVAILABILITY_TIME_ROWS: { id: string; label: string }[] = [...HALF_HOUR_SLOTS]

/** Slot id for a grid cell: dayIndex 0–4 (Wed–Sun), timeIndex 0–19. */
export function getAvailabilitySlotId(dayIndex: number, timeIndex: number): string {
  const day = AVAILABILITY_DAYS[dayIndex]
  const time = HALF_HOUR_SLOTS[timeIndex]
  return day && time ? `${day}_${time.id}` : ''
}

/** Parse slot id to day index (0–6 Mon–Sun) and time index (0–19). Returns null if invalid. */
function parseSlotId(slotId: string): { dayIndex: number; timeIndex: number } | null {
  const parts = slotId.split('_')
  const dayStr = parts[0]
  const timeStr = parts.slice(1).join('_')
  const dayIndex = DAYS.indexOf(dayStr as (typeof DAYS)[number])
  const timeIndex = HALF_HOUR_SLOTS.findIndex((s) => s.id === timeStr)
  if (dayIndex === -1 || timeIndex === -1) return null
  return { dayIndex, timeIndex }
}

/** True if slot id is Wed–Sun (valid for availability). */
export function isAvailabilitySlotId(slotId: string): boolean {
  const parsed = parseSlotId(slotId)
  if (!parsed) return false
  return parsed.dayIndex >= 2 // wed=2, thu=3, fri=4, sat=5, sun=6
}

/**
 * Rank overlapping slot IDs: earlier in week first, then evenings preferred over daytime.
 * Returns slot IDs in best-first order (first = default suggestion).
 */
export function rankAvailabilitySlots(slotIds: string[]): string[] {
  if (!slotIds.length) return []
  const scored = slotIds
    .map((id) => {
      const p = parseSlotId(id)
      if (!p) return { id, score: -1 }
      const dayWeight = (7 - p.dayIndex) * 100
      const timeWeight = p.timeIndex
      return { id, score: dayWeight + timeWeight }
    })
    .filter((x) => x.score >= 0)
  scored.sort((a, b) => b.score - a.score)
  return scored.map((x) => x.id)
}

/** Best single slot for default proposal (first in ranked order), or null if none. */
export function getBestDefaultSlot(slotIds: string[]): string | null {
  const ranked = rankAvailabilitySlots(slotIds)
  return ranked[0] ?? null
}

/**
 * Summarize an array of 30-min slot IDs into human-readable time windows (e.g. "Mon 9a–12p", "Tue 2p–5p").
 * Merges consecutive slots per day so we don't list every half-hour.
 */
export function summarizeAvailabilitySlots(slotIds: string[]): string[] {
  if (!slotIds.length) return []
  const byDay = new Map<number, number[]>()
  for (const id of slotIds) {
    const parsed = parseSlotId(id)
    if (!parsed) continue
    const list = byDay.get(parsed.dayIndex) ?? []
    list.push(parsed.timeIndex)
    byDay.set(parsed.dayIndex, list)
  }
  const result: string[] = []
  for (let d = 0; d < DAYS.length; d++) {
    const indices = byDay.get(d)
    if (!indices?.length) continue
    indices.sort((a, b) => a - b)
    const dayLabel = DAY_LABELS[DAYS[d]] ?? DAYS[d]
    let start = indices[0]
    let end = indices[0]
    for (let i = 1; i < indices.length; i++) {
      if (indices[i] === end + 1) {
        end = indices[i]
      } else {
        const startLabel = HALF_HOUR_SLOTS[start].label
        const endLabel = HALF_HOUR_SLOTS[end + 1]?.label ?? HALF_HOUR_SLOTS[end].label
        result.push(`${dayLabel} ${startLabel}–${endLabel}`)
        start = indices[i]
        end = indices[i]
      }
    }
    const startLabel = HALF_HOUR_SLOTS[start].label
    const endLabel = HALF_HOUR_SLOTS[end + 1]?.label ?? HALF_HOUR_SLOTS[end].label
    result.push(`${dayLabel} ${startLabel}–${endLabel}`)
  }
  return result
}

/** Monday of the week after batch_week (YYYY-MM-DD). */
export function getNextWeekMonday(batchWeek: string): string {
  const d = new Date(batchWeek + 'T12:00:00')
  d.setDate(d.getDate() + 7)
  return d.toISOString().slice(0, 10)
}

/** Wednesday of the availability week (batch_week is Monday; Wed = batch_week + 2). */
export function getAvailabilityWeekWednesday(batchWeek: string): string {
  const d = new Date(batchWeek + 'T12:00:00')
  d.setDate(d.getDate() + 2)
  return d.toISOString().slice(0, 10)
}

/** Sunday before batch_week (lock day). Lock at 11:59pm. */
function getLockSunday(batchWeek: string): Date {
  const d = new Date(batchWeek + 'T12:00:00')
  d.setDate(d.getDate() - 1)
  return d
}

/** Sunday 11:59pm before the match week. Opt-in + availability close at this time. */
export function getAvailabilityLockDate(batchWeek: string): Date {
  const d = getLockSunday(batchWeek)
  d.setHours(23, 59, 59, 999)
  return d
}

/** True when availability for that week can no longer be edited (Sunday 11:59pm has passed). */
export function isAvailabilityLocked(batchWeek: string): boolean {
  const lockAt = getAvailabilityLockDate(batchWeek)
  return new Date() >= lockAt
}

/** Human-readable date range for the availability week: Wed–Sun (e.g. "Wed Mar 5 – Sun Mar 9"). */
export function formatNextWeekRange(batchWeek: string): string {
  const wed = new Date(getAvailabilityWeekWednesday(batchWeek) + 'T12:00:00')
  const sun = new Date(wed)
  sun.setDate(sun.getDate() + 4)
  const wedStr = wed.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  const sunStr = sun.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${wedStr} – ${sunStr}`
}
