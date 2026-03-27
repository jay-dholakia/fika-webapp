/** Same logic as lib/upcoming-confirmed-fika.ts — keep in sync for Deno Edge. */

import { getFikaTimeMs } from './fika-schedule-time.ts'
import { fetchMarketMapForIds, timezoneForMatch } from './fetch-match-market-map.ts'

export async function fetchUserIdsWithUpcomingConfirmedFika(supabase: any): Promise<Set<string>> {
  const { data: rows } = await supabase
    .from('match_candidates')
    .select('user_a, user_b, week_anchor_monday, confirmed_slot_id, confirmed_venue_id')
    .eq('scheduling_status', 'confirmed')
    .not('week_anchor_monday', 'is', null)
    .not('confirmed_slot_id', 'is', null)
    .not('confirmed_venue_id', 'is', null)

  if (!rows?.length) return new Set()

  const ids = Array.from(
    new Set(
      (rows as { user_a: string; user_b: string }[]).flatMap((m) => [m.user_a, m.user_b])
    )
  )
  const marketMap = await fetchMarketMapForIds(supabase, ids)
  const out = new Set<string>()
  const now = Date.now()

  for (const m of rows as {
    user_a: string
    user_b: string
    week_anchor_monday: string
    confirmed_slot_id: string
  }[]) {
    const tz = timezoneForMatch(m, marketMap)
    const ms = getFikaTimeMs(m.week_anchor_monday, m.confirmed_slot_id, tz)
    if (ms != null && ms > now) {
      out.add(m.user_a)
      out.add(m.user_b)
    }
  }
  return out
}
