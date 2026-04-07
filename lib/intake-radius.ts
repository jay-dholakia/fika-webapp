/**
 * Derive "willing to travel" radius in km from intake responses.
 * Used by venue selection and aligned with replenish-matches logic (q_radius in miles → km).
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

/** Default when q_radius is missing (~25 miles). */
export const DEFAULT_RADIUS_KM = 40

/**
 * Travel distance from intake q_radius (miles) → km. Default 40 km.
 * Accepts array-shaped intake `responses` or a flat record.
 */
export function getIntakeRadiusKm(responses: unknown): number {
  const miles = getIntakeNumericValue(responses, 'q_radius')
  return miles != null ? Math.round(miles * 1.60934) : DEFAULT_RADIUS_KM
}
