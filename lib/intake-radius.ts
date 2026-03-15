/**
 * Derive "willing to travel" radius in km from intake responses.
 * Used by venue selection and aligned with replenish-matches logic (q_radius in miles → km).
 */

function getResponseValue(responses: Record<string, unknown> | null, questionId: string): unknown {
  if (!responses || typeof responses !== 'object') return null
  return responses[questionId] ?? null
}

function getIntakeNumericValue(responses: Record<string, unknown> | null, questionId: string): number | null {
  const raw = getResponseValue(responses, questionId)
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
 */
export function getIntakeRadiusKm(responses: Record<string, unknown> | null): number {
  const miles = getIntakeNumericValue(responses, 'q_radius')
  return miles != null ? Math.round(miles * 1.60934) : DEFAULT_RADIUS_KM
}
