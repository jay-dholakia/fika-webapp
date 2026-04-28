/** Same logic as lib/intro-eligibility.ts — keep in sync for Deno Edge. */

import { fetchUserIdsWithUpcomingConfirmedFika } from './upcoming-confirmed-fika.ts'

export const INTRO_OFFER_WINDOW_MS = 24 * 60 * 60 * 1000

function effectiveIntroOfferTs(row: {
  intro_offer_sent_at?: string | null
  updated_at?: string | null
}): number | null {
  const raw = row.intro_offer_sent_at ?? row.updated_at
  if (!raw) return null
  const t = new Date(raw).getTime()
  return Number.isFinite(t) ? t : null
}

export async function fetchUserIdsBlockedFromNewIntro(
  supabase: any,
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
