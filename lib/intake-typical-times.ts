/**
 * Map intake "typical Fika times" (q_typical_fika_times) to concrete availability slot IDs
 * (mon_09_00 … sun_18_30). Used for SMS proposals instead of legacy per-match availability grids.
 */

import { AVAILABILITY_SLOT_IDS, rankAvailabilitySlots } from '@/lib/availability-slots'

const WEEKDAY = new Set(['mon', 'tue', 'wed', 'thu', 'fri'])

function slotDay(slotId: string): string {
  return slotId.split('_')[0] ?? ''
}

/** Hour as number, e.g. 9, 9.5, 12, 17.5 */
function slotHour(slotId: string): number | null {
  const parts = slotId.split('_')
  if (parts.length < 3) return null
  const h = parseInt(parts[1], 10)
  if (!Number.isFinite(h)) return null
  const half = parts[2] === '30' ? 0.5 : 0
  return h + half
}

function isMorning(slotId: string): boolean {
  const h = slotHour(slotId)
  return h != null && h >= 9 && h < 12
}

function isAfternoon(slotId: string): boolean {
  const h = slotHour(slotId)
  return h != null && h >= 12 && h < 17
}

function isEvening(slotId: string): boolean {
  const h = slotHour(slotId)
  return h != null && h >= 17
}

function slotMatchesTypicalOption(slotId: string, option: string): boolean {
  const day = slotDay(slotId)
  const isWeekday = WEEKDAY.has(day)
  const isWeekend = day === 'sat' || day === 'sun'

  switch (option) {
    case 'Weekday mornings':
      return isWeekday && isMorning(slotId)
    case 'Weekday afternoons':
      return isWeekday && isAfternoon(slotId)
    case 'Weekday evenings':
      return isWeekday && isEvening(slotId)
    case 'Weekend mornings':
      return isWeekend && isMorning(slotId)
    case 'Weekend afternoons':
      return isWeekend && isAfternoon(slotId)
    case 'Weekend evenings':
      return isWeekend && isEvening(slotId)
    default:
      return false
  }
}

/** Expand intake selections to concrete slot IDs (Mon–Sun grid). */
export function expandTypicalFikaSelectionsToSlotIds(selections: string[]): string[] {
  if (!selections.length) return []
  const out = new Set<string>()
  for (const id of AVAILABILITY_SLOT_IDS) {
    for (const opt of selections) {
      if (slotMatchesTypicalOption(id, opt)) {
        out.add(id)
        break
      }
    }
  }
  return rankAvailabilitySlots(Array.from(out))
}

export function getTypicalFikaSelectionsFromResponses(responses: unknown): string[] {
  const arr = Array.isArray(responses) ? responses : []
  const row = arr.find((x: { question_id?: string }) => x?.question_id === 'q_typical_fika_times') as
    | { answer?: unknown }
    | undefined
  const a = row?.answer
  if (Array.isArray(a)) return a.map((x) => String(x))
  return []
}

/**
 * Ordered candidate slots for proposals: intersection of both users' typical times,
 * then union if intersection is empty, then full week grid if both empty.
 */
export function candidateSlotIdsForProposalFromIntake(
  responsesA: unknown,
  responsesB: unknown
): string[] {
  const selA = getTypicalFikaSelectionsFromResponses(responsesA)
  const selB = getTypicalFikaSelectionsFromResponses(responsesB)
  const slotsA = new Set(expandTypicalFikaSelectionsToSlotIds(selA))
  const slotsB = new Set(expandTypicalFikaSelectionsToSlotIds(selB))

  const intersection = rankAvailabilitySlots(Array.from(slotsA).filter((id) => slotsB.has(id)))
  if (intersection.length) return intersection

  const union = rankAvailabilitySlots(
    Array.from(new Set([...Array.from(slotsA), ...Array.from(slotsB)]))
  )
  if (union.length) return union

  return rankAvailabilitySlots(Array.from(AVAILABILITY_SLOT_IDS))
}

/** Next alternate slot after `currentSlotId` within the same ranked pool (for re-proposals). */
export function nextAlternateProposalSlot(currentSlotId: string, rankedPool: string[]): string | null {
  const next = rankedPool.find((id) => id !== currentSlotId)
  return next ?? null
}
