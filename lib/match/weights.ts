/**
 * Tunable weights for the structured Fika matcher (feasibility vs compatibility).
 * Edit here; keep matrices in `compatibility-matrices.ts`.
 */

/** Reported in admin match-sim API `summary.scoring`. */
export const MATCH_SCORING_VERSION = 'fika_structured_v16' as const
export const MATCH_SCORING_VERSION_LLM = 'llm_qualitative_v1' as const

/** final = clamp(0,1, FEASIBILITY_PORTION * feasibility + COMPATIBILITY_PORTION * (compatibility - penaltyTotal)) */
export const FEASIBILITY_PORTION = 0.4
export const COMPATIBILITY_PORTION = 0.6

export const FEASIBILITY_WEIGHTS = {
  distanceFit: 0.9,
  dataConfidence: 0.1,
} as const

/**
 * Per-dimension weights inside compatibility_score (sum = 1).
 * Reflects SMS-first onboarding: fika vibe + social style replace q_like_talking_about chips.
 */
export const COMPATIBILITY_WEIGHTS = {
  interests: 0.22,      // chip overlap or 0.5 neutral (SMS users have free text, not chips)
  fikaVibe: 0.18,       // what kind of conversation they want from a Fika
  socialGoal: 0.15,     // what they want to get out of Fika
  marketTenure: 0.15,   // how long in the city
  ageFit: 0.10,         // age proximity
  work: 0.10,           // fuzzy work role similarity
  socialStyle: 0.10,    // personality fit in social situations
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
 * Intake fields counted toward data-confidence feasibility.
 * q_interests_freetext is the SMS-onboarding equivalent of q_interests chips.
 */
export const DATA_CONFIDENCE_FIELD_IDS = [
  'q_market_tenure',
  'q_interests',       // web onboarding chips (checked with q_interests_freetext fallback)
  'q_social_goal',
] as const

export const CONFIRM_INTENT_REQUIRED_VALUE = "I'm in"
