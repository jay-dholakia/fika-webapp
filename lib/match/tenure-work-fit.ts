import { getIntakeSingle } from '@/lib/intake-response-utils'
import { MARKET_TENURE_OPTIONS } from '@/lib/onboarding-data'

/** Label → index along `MARKET_TENURE_OPTIONS` (newer on the left). */
const MARKET_TENURE_INDEX = new Map<string, number>(
  MARKET_TENURE_OPTIONS.map((label, i) => [label, i])
)

/** Inclusive index: "Just moved", "<6 months", "6mo–1yr" — treat as new-to-area band. */
const MARKET_TENURE_NEWISH_MAX_INDEX = 2

/**
 * Similar tenure → higher score; bucket distance decays smoothly.
 * When **both** are in the "new to the area" band, add a small lift so
 * "both figuring the city out" ranks a bit higher (still capped at 1).
 */
export function marketTenureFitScore(responsesA: unknown, responsesB: unknown): number {
  const a = getIntakeSingle(responsesA, 'q_market_tenure')
  const b = getIntakeSingle(responsesB, 'q_market_tenure')
  if (!a || !b) return 0.5
  const ia = MARKET_TENURE_INDEX.get(a)
  const ib = MARKET_TENURE_INDEX.get(b)
  if (ia === undefined || ib === undefined) return 0.5
  const dist = Math.abs(ia - ib)
  const base = dist === 0 ? 1 : Math.max(0.38, 1 - 0.11 * dist)
  const bothNewish = ia <= MARKET_TENURE_NEWISH_MAX_INDEX && ib <= MARKET_TENURE_NEWISH_MAX_INDEX
  return bothNewish ? Math.min(1, base + 0.1) : base
}

/** Same role / title → 1; both answered but different → partial; either missing → neutral. */
export function workFitScore(responsesA: unknown, responsesB: unknown): number {
  const va = getIntakeSingle(responsesA, 'q_work')
  const vb = getIntakeSingle(responsesB, 'q_work')
  if (!va || !vb) return 0.5
  if (va.trim().toLowerCase() === vb.trim().toLowerCase()) return 1
  return 0.35
}
