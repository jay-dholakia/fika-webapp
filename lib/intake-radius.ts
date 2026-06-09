/**
 * Derive "willing to travel" radius in km from intake responses.
 * Used by venue selection and matcher logic (q_radius in miles → km).
 */

import { getIntakeAnswer } from '@/lib/intake-response-utils'

function getIntakeNumericValue(responses: unknown, questionId: string): number | null {
  const raw = getIntakeAnswer(responses, questionId)
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'number' && !isNaN(raw)) return raw
  const s = String(raw).trim()
  const num = parseInt(s, 10)
  if (!isNaN(num)) return num
  const pmMatch = s.match(/±\s*(\d+)/)
  if (pmMatch) return parseInt(pmMatch[1], 10)
  const milesMatch = s.match(/(\d+)\s*miles/)
  if (milesMatch) return parseInt(milesMatch[1], 10)
  return null
}

/** Fixed travel radius: 10 miles in km. */
export const DEFAULT_RADIUS_KM = 16
