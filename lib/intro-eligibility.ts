import type { SupabaseClient } from '@supabase/supabase-js'
import {
  fetchUserIdsWithUpcomingConfirmedFika,
  userHasUpcomingConfirmedFika,
} from '@/lib/upcoming-confirmed-fika'

/** Matches `sms-match-delivery` / Edge intro-offer blocking window */
export const INTRO_OFFER_WINDOW_MS = 24 * 60 * 60 * 1000

/** Matches mutual match opt-in deadline written on new match_candidates rows */
export const MATCH_OPT_IN_DEADLINE_MS = 24 * 60 * 60 * 1000

function effectiveIntroOfferTs(row: {
  intro_offer_sent_at?: string | null
  updated_at?: string | null
}): number | null {
  const raw = row.intro_offer_sent_at ?? row.updated_at
  if (!raw) return null
  const t = new Date(raw).getTime()
  return Number.isFinite(t) ? t : null
}

/**
 * Users blocked from receiving another intro SMS:
 * upcoming confirmed Fika still in the future, or active intro-offer row (match_offered within 24h window).
 *
 * Pass `upcomingConfirmed` when you already called `fetchUserIdsWithUpcomingConfirmedFika` to avoid a duplicate query.
 */
export async function fetchUserIdsBlockedFromNewIntro(
  supabase: SupabaseClient,
  options?: { upcomingConfirmed?: Set<string> }
): Promise<Set<string>> {
  const blocked = options?.upcomingConfirmed
    ? new Set(options.upcomingConfirmed)
    : await fetchUserIdsWithUpcomingConfirmedFika(supabase)

  const cutoff = Date.now() - INTRO_OFFER_WINDOW_MS
  const { data: rows } = await supabase
    .from('sms_conversation_states')
    .select('user_id, intro_offer_sent_at, updated_at')
    .eq('state', 'match_offered')
    .not('match_id', 'is', null)

  for (const r of rows ?? []) {
    const ts = effectiveIntroOfferTs(r as { intro_offer_sent_at?: string | null; updated_at?: string })
    if (ts != null && ts > cutoff) blocked.add(r.user_id as string)
  }
  return blocked
}

export async function userBlockedFromNewIntro(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  if (await userHasUpcomingConfirmedFika(supabase, userId)) return true

  const cutoff = Date.now() - INTRO_OFFER_WINDOW_MS
  const { data: rows } = await supabase
    .from('sms_conversation_states')
    .select('intro_offer_sent_at, updated_at')
    .eq('user_id', userId)
    .eq('state', 'match_offered')
    .not('match_id', 'is', null)

  for (const r of rows ?? []) {
    const ts = effectiveIntroOfferTs(r as { intro_offer_sent_at?: string | null; updated_at?: string })
    if (ts != null && ts > cutoff) return true
  }
  return false
}
