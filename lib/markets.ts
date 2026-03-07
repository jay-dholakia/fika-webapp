/**
 * City markets for Fika: groups of cities that share a 250-person threshold for opt-in.
 * Used for profile count and "building community in [city]" messaging.
 * Santa Monica, Culver City, etc. count as Los Angeles.
 */

export const TARGET_COUNT_PER_MARKET = 250

export interface Market {
  slug: string
  label: string
  /** Lowercase substrings; profile city is matched case-insensitive. Any match assigns this market. */
  cityPatterns: string[]
}

export const MARKETS: Market[] = [
  {
    slug: 'la',
    label: 'Los Angeles',
    cityPatterns: [
      'los angeles',
      'santa monica',
      'culver city',
      'pasadena',
      'burbank',
      'glendale',
      'long beach',
      'santa clarita',
      'inglewood',
      'culver',
      'marina del rey',
      'venice',
      'hollywood',
      'west hollywood',
      'sherman oaks',
      'studio city',
      'encino',
      'north hollywood',
      'van nuys',
      'south pasadena',
      'alhambra',
      'monrovia',
      'arcadia',
      'el monte',
      'downey',
      'torrance',
      'redondo beach',
      'manhattan beach',
      'hermosa beach',
      'inglewood',
      'compton',
      'gardena',
      'hawthorne',
      'lawndale',
      'inglewood',
      'lynwood',
      'south gate',
      'lakewood',
      'signal hill',
      'bellflower',
      'cerritos',
      'norwalk',
      'whittier',
      'la mirada',
      'la habra',
      'fullerton',
      'anaheim',
      'orange',
      'irvine',
      'costa mesa',
      'huntington beach',
      'newport beach',
      'tustin',
      'santa ana',
      'garden grove',
      'westminster',
      'fountain valley',
      'mission viejo',
      'lake forest',
      'rancho santa margarita',
    ],
  },
  {
    slug: 'sf',
    label: 'San Francisco',
    cityPatterns: [
      'san francisco',
      'sf,',
      'oakland',
      'berkeley',
      'san jose',
      'palo alto',
      'mountain view',
      'sunnyvale',
      'san mateo',
      'daly city',
      'south san francisco',
      'dublin',
      'pleasanton',
      'fremont',
      'hayward',
      'alameda',
      'emeryville',
      'sausalito',
      'mill valley',
      'san rafael',
      'richmond',
      'el cerrito',
      'alameda',
      'walnut creek',
      'concord',
      'san leandro',
    ],
  },
  {
    slug: 'nyc',
    label: 'New York City',
    cityPatterns: [
      'new york',
      'nyc',
      'brooklyn',
      'manhattan',
      'queens',
      'bronx',
      'staten island',
      'long island city',
      'williamsburg',
      'bushwick',
      'harlem',
      'upper east',
      'upper west',
      'tribeca',
      'soho',
      'greenpoint',
      'dumbo',
      'park slope',
      'jersey city',
      'hoboken',
      'weehawken',
    ],
  },
]

const slugToMarket = new Map(MARKETS.map((m) => [m.slug, m]))

/** Normalize city for matching: lowercase, trim. */
function normalizeCity(city: string | null | undefined): string {
  if (city == null || typeof city !== 'string') return ''
  return city.trim().toLowerCase()
}

/**
 * Return the market for a profile's city (and optionally lat/lng in future).
 * Santa Monica, Culver City, etc. → LA. Unknown cities return null.
 */
export function getMarketFromCity(city: string | null | undefined): { slug: string; label: string } | null {
  const normalized = normalizeCity(city)
  if (!normalized) return null
  for (const market of MARKETS) {
    if (market.cityPatterns.some((p) => normalized.includes(p))) return { slug: market.slug, label: market.label }
  }
  return null
}

export function getMarketBySlug(slug: string | null | undefined): Market | null {
  if (slug == null || typeof slug !== 'string') return null
  return slugToMarket.get(slug.trim().toLowerCase()) ?? null
}
