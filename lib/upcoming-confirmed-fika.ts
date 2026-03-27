import type { SupabaseClient } from '@supabase/supabase-js'
import { getFikaTimeMs } from '@/lib/fika-schedule-time'
import { buildUserMarketMap, getTimezoneForMatchFromMap } from '@/lib/match-market-timezone'

type ConfirmedMatchRow = {
  user_a: string
  user_b: string
  week_anchor_monday: string
  confirmed_slot_id: string
}

/**
 * Users who have at least one confirmed Fika (slot + venue) whose start time is still in the future.
 * They must not receive a new intro SMS / new match_candidate intro flow.
 */
export async function fetchUserIdsWithUpcomingConfirmedFika(
  supabase: SupabaseClient
): Promise<Set<string>> {
  const { data: rows, error } = await supabase
    .from('match_candidates')
    .select('user_a, user_b, week_anchor_monday, confirmed_slot_id, confirmed_venue_id')
    .eq('scheduling_status', 'confirmed')
    .not('week_anchor_monday', 'is', null)
    .not('confirmed_slot_id', 'is', null)
    .not('confirmed_venue_id', 'is', null)

  if (error || !rows?.length) return new Set()

  const marketMap = await buildUserMarketMap(supabase, rows as ConfirmedMatchRow[])
  const out = new Set<string>()
  const now = Date.now()

  for (const m of rows as ConfirmedMatchRow[]) {
    const tz = getTimezoneForMatchFromMap(m, marketMap)
    const ms = getFikaTimeMs(m.week_anchor_monday, m.confirmed_slot_id, tz)
    if (ms != null && ms > now) {
      out.add(m.user_a)
      out.add(m.user_b)
    }
  }
  return out
}

/** Single-user check (narrow query) for detail endpoints. */
export async function userHasUpcomingConfirmedFika(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  const { data: rows, error } = await supabase
    .from('match_candidates')
    .select('user_a, user_b, week_anchor_monday, confirmed_slot_id, confirmed_venue_id')
    .eq('scheduling_status', 'confirmed')
    .not('week_anchor_monday', 'is', null)
    .not('confirmed_slot_id', 'is', null)
    .not('confirmed_venue_id', 'is', null)
    .or(`user_a.eq.${userId},user_b.eq.${userId}`)

  if (error || !rows?.length) return false

  const marketMap = await buildUserMarketMap(supabase, rows as ConfirmedMatchRow[])
  const now = Date.now()
  for (const m of rows as ConfirmedMatchRow[]) {
    const tz = getTimezoneForMatchFromMap(m, marketMap)
    const ms = getFikaTimeMs(m.week_anchor_monday, m.confirmed_slot_id, tz)
    if (ms != null && ms > now) return true
  }
  return false
}
