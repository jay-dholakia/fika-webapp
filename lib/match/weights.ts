/**
 * Tunable weights for the structured Fika matcher (feasibility vs compatibility).
 * Edit here; keep matrices in `compatibility-matrices.ts`.
 */

/** Reported in admin match-sim API `summary.scoring`. */
export const MATCH_SCORING_VERSION = 'fika_structured_v15' as const

/** final = clamp(0,1, FEASIBILITY_PORTION * feasibility + COMPATIBILITY_PORTION * (compatibility - penaltyTotal)) */
export const FEASIBILITY_PORTION = 0.4
export const COMPATIBILITY_PORTION = 0.6

export const FEASIBILITY_WEIGHTS = {
  distanceFit: 0.9,
  dataConfidence: 0.1,
} as const

/**
 * Per-dimension weights inside compatibility_score (sum = 1).
 * Interests, talk topics, market tenure, work, plus age proximity from profile birthdates.
 */
export const COMPATIBILITY_WEIGHTS = {
  interests: 0.34,
  marketTenure: 0.17,
  work: 0.12,
  likeTalkingAbout: 0.19,
  ageFit: 0.10,
  socialGoal: 0.08,
} as const

/** Age fit uses `1 / (1 + ageDiffYears / AGE_FIT_SCALE_YEARS)`; missing either age → neutral 0.5. */
export const AGE_FIT_SCALE_YEARS = 10

/** Multi-select chip overlap: blend of Jaccard and overlap coefficient. */
export const MULTI_CHIP_BLEND = { jaccard: 0.6, overlapCoeff: 0.4 } as const

/**
 * Beyond combined radius, pairs remain eligible up to this ratio (e.g. 1.15 = +15%),
 * with low distance_fit. Above this → hard reject when coordinates exist.
 */
export const DISTANCE_HARD_REJECT_RATIO = 1.15

/** When ratio in (1, DISTANCE_HARD_REJECT_RATIO], distance_fit uses this flat low score. */
export const DISTANCE_FIT_SLIGHTLY_OVER_RADIUS = 0.2

/** When coordinates missing, distance_fit is neutral-ish. */
export const DISTANCE_FIT_MISSING_COORDS = 0.6

/** Soft penalty for discordant hoping-for signals (never hard-reject). */
export const SEVERE_MISMATCH_PENALTY_CAP = 0.06

/**
 * Intake fields counted toward data-confidence feasibility (platonic confirm is eligibility-only, not scored).
 * Optional fields (ethnicity, relationship, work) are not included.
 */
export const DATA_CONFIDENCE_FIELD_IDS = [
  'q_market_tenure',
  'q_interests',
  'q_like_talking_about',
] as const

export const CONFIRM_INTENT_REQUIRED_VALUE = "I'm in"
