/**
 * Deployed Edge Function slugs on meetwithmoai (must match Dashboard names).
 * Next routes `app/api/opt-in-to-match` and `app/api/pass-on-match` proxy to these.
 */
export const EDGE_FUNCTIONS = {
  /** Opt in to a match (writes opt_ins; creates conversation when mutual). */
  OPT_IN_TO_MATCH: 'opt-in-match',
  /** Pass on a match (writes opt_ins with decision no). */
  PASS_ON_MATCH: 'pass-match',
} as const
