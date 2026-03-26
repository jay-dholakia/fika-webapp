/** Load profile.market for users involved in matches (Deno Edge). */

import { getMatchMarketTimezoneFromProfileMarkets } from './market-timezones.ts'

export async function fetchMarketMapForIds(supabase: any, ids: string[]): Promise<Map<string, string | null>> {
  if (ids.length === 0) return new Map()
  const { data } = await supabase.from('profiles').select('id, market').in('id', ids)
  const map = new Map<string, string | null>()
  for (const row of (data as { id: string; market: string | null }[]) ?? []) {
    map.set(row.id, row.market ?? null)
  }
  return map
}

export function timezoneForMatch(
  m: { user_a: string; user_b: string },
  marketByUserId: Map<string, string | null>
): string {
  return getMatchMarketTimezoneFromProfileMarkets(marketByUserId.get(m.user_a), marketByUserId.get(m.user_b))
}
