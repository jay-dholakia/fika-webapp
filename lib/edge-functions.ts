/**
 * Edge function names for the meetwithmoai backend.
 * Change these if your Supabase project uses different names.
 */
export const EDGE_FUNCTIONS = {
  /** Opt in to a match (writes opt_ins; creates conversation when mutual). Returns { conversation_id?: string }. */
  OPT_IN_TO_MATCH: 'opt-in-to-match',
  /** Pass on a match (writes opt_ins with decision no). */
  PASS_ON_MATCH: 'pass-on-match',
} as const
