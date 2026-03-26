/** Same as lib/market-timezones.ts — keep in sync for Deno Edge. */

export const DEFAULT_MARKET_IANA_TIMEZONE = 'America/Los_Angeles'

export const MARKET_IANA_TIMEZONE: Record<string, string> = {
  'albuquerque': 'America/Denver',
  'atlanta': 'America/New_York',
  'austin': 'America/Chicago',
  'baltimore': 'America/New_York',
  'boston': 'America/New_York',
  'charlotte': 'America/New_York',
  'chicago': 'America/Chicago',
  'cincinnati': 'America/New_York',
  'cleveland': 'America/New_York',
  'columbus': 'America/New_York',
  'dallas': 'America/Chicago',
  'denver': 'America/Denver',
  'detroit': 'America/Detroit',
  'houston': 'America/Chicago',
  'ie': 'America/Los_Angeles',
  'indianapolis': 'America/Indiana/Indianapolis',
  'jacksonville': 'America/New_York',
  'kansas-city': 'America/Chicago',
  'la': 'America/Los_Angeles',
  'las-vegas': 'America/Los_Angeles',
  'miami': 'America/New_York',
  'milwaukee': 'America/Chicago',
  'minneapolis': 'America/Chicago',
  'nashville': 'America/Chicago',
  'nyc': 'America/New_York',
  'orange-county': 'America/Los_Angeles',
  'orlando': 'America/New_York',
  'philadelphia': 'America/New_York',
  'phoenix': 'America/Phoenix',
  'pittsburgh': 'America/New_York',
  'portland': 'America/Los_Angeles',
  'raleigh': 'America/New_York',
  'sacramento': 'America/Los_Angeles',
  'san-antonio': 'America/Chicago',
  'san-diego': 'America/Los_Angeles',
  'seattle': 'America/Los_Angeles',
  'sf': 'America/Los_Angeles',
  'st-louis': 'America/Chicago',
  'tampa': 'America/New_York',
}

export function getIanaTimezoneForMarketSlug(slug: string | null | undefined): string {
  if (slug == null || typeof slug !== 'string') return DEFAULT_MARKET_IANA_TIMEZONE
  const s = slug.trim().toLowerCase()
  return MARKET_IANA_TIMEZONE[s] ?? DEFAULT_MARKET_IANA_TIMEZONE
}

export function resolveMarketSlugForMatch(
  a: string | null | undefined,
  b: string | null | undefined
): string | null {
  const ta = a?.trim() ?? ''
  const tb = b?.trim() ?? ''
  if (ta && tb && ta === tb) return ta
  if (ta) return ta
  if (tb) return tb
  return null
}

export function getMatchMarketTimezoneFromProfileMarkets(
  marketA: string | null | undefined,
  marketB: string | null | undefined
): string {
  return getIanaTimezoneForMarketSlug(resolveMarketSlugForMatch(marketA, marketB))
}
