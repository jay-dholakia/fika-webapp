import type { SupabaseClient } from '@supabase/supabase-js'
import { getMatchMarketTimezoneFromProfileMarkets } from '@/lib/market-timezones'

export async function fetchMatchMarketTimezone(
  supabase: SupabaseClient,
  userA: string,
  userB: string
): Promise<string> {
  const { data } = await supabase.from('profiles').select('id, market').in('id', [userA, userB])
  const rows = data ?? []
  const ma = rows.find((r) => r.id === userA)?.market
  const mb = rows.find((r) => r.id === userB)?.market
  return getMatchMarketTimezoneFromProfileMarkets(ma, mb)
}

export async function buildUserMarketMap(
  supabase: SupabaseClient,
  matches: { user_a: string; user_b: string }[]
): Promise<Map<string, string | null>> {
  const ids = Array.from(new Set(matches.flatMap((m) => [m.user_a, m.user_b])))
  if (ids.length === 0) return new Map()
  const { data } = await supabase.from('profiles').select('id, market').in('id', ids)
  const map = new Map<string, string | null>()
  for (const row of data ?? []) map.set(row.id, row.market ?? null)
  return map
}

export function getTimezoneForMatchFromMap(
  match: { user_a: string; user_b: string },
  marketByUserId: Map<string, string | null>
): string {
  return getMatchMarketTimezoneFromProfileMarkets(marketByUserId.get(match.user_a), marketByUserId.get(match.user_b))
}
