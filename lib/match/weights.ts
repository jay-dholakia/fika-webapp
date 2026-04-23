/**
 * Tunable weights for the structured Fika matcher (feasibility vs compatibility).
 * Edit here; keep matrices in `compatibility-matrices.ts`.
 */

/** Reported in admin match-sim API `summary.scoring`. */
export const MATCH_SCORING_VERSION = 'fika_structured_v4' as const

/** final = clamp(0,1, FEASIBILITY_PORTION * feasibility + COMPATIBILITY_PORTION * (compatibility - penaltyTotal)) */
export const FEASIBILITY_PORTION = 0.4
export const COMPATIBILITY_PORTION = 0.6

export const FEASIBILITY_WEIGHTS = {
  distanceFit: 0.45,
  timeFit: 0.45,
  dataConfidence: 0.1,
} as const

/**
 * Per-dimension weights inside compatibility_score (sum = 1).
 * Slim intake: interests + hoping-for + time in market + optional work line.
 * `texture` kept at 0 (legacy bucket); use `work` for `q_work` only.
 */
export const COMPATIBILITY_WEIGHTS = {
  greatFika: 0,
  interests: 0.45,
  marketTenure: 0.18,
  work: 0.15,
  curiosity: 0,
  lifeChapter: 0,
  everydayAnchor: 0,
  openness: 0,
  hopingFor: 0.22,
  texture: 0,
} as const

/** Multi-select chip overlap: blend of Jaccard and overlap coefficient. */
export const MULTI_CHIP_BLEND = { jaccard: 0.6, overlapCoeff: 0.4 } as const

/** Typical Fika times (feasibility time_fit). */
export const TIME_FIT_BLEND = { jaccard: 0.7, overlapCoeff: 0.3 } as const

/**
 * Beyond combined radius, pairs remain eligible up to this ratio (e.g. 1.15 = +15%),
 * with low distance_fit. Above this → hard reject when coordinates exist.
 */
export const DISTANCE_HARD_REJECT_RATIO = 1.15

/** When ratio in (1, DISTANCE_HARD_REJECT_RATIO], distance_fit uses this flat low score. */
export const DISTANCE_FIT_SLIGHTLY_OVER_RADIUS = 0.2

/** When coordinates missing, distance_fit is neutral-ish. */
export const DISTANCE_FIT_MISSING_COORDS = 0.6

/** Avoid-topics: subtract per mapped conflict; cap total. */
export const AVOID_TOPICS_PENALTY_PER_HIT = 0.04
export const AVOID_TOPICS_PENALTY_CAP = 0.12

/** Soft penalty for strong hoping/openness tension (never hard-reject). */
export const SEVERE_MISMATCH_PENALTY_CAP = 0.06

/** Fields counted for data_confidence (presence on both users helps feasibility). Aligned with current intake steps. */
export const DATA_CONFIDENCE_FIELD_IDS = [
  'q_market_tenure',
  'q_ethnicity',
  'q_relationship_status',
  'q_work',
  'q_interests',
  'q_hoping_for',
  'q_typical_fika_times',
  'q_radius',
  'confirm_intent',
] as const

export const CONFIRM_INTENT_REQUIRED_VALUE = "I'm in"
