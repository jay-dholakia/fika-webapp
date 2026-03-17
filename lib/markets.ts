import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * City markets for Fika: groups of cities that share a 250-person threshold for opt-in.
 * Used for profile count and "building community in [city]" messaging.
 * Santa Monica, Culver City, Ladera Heights, etc. count as Los Angeles.
 *
 * Market is resolved in three ways (for efficiency and coverage):
 * 1. If we have lat/lng and markets.boundary is set in DB, use point-in-polygon on that GeoJSON.
 * 2. Else if we have lat/lng, use MARKET_BOUNDS (point-in-box). Covers entire metro without listing every neighborhood.
 * 3. Otherwise we match profile city string against each market's cityPatterns (fallback for SMS signup or missing coords).
 */

export const TARGET_COUNT_PER_MARKET = 250

export interface Market {
  slug: string
  label: string
  /** Lowercase substrings; profile city is matched case-insensitive. Any match assigns this market. */
  cityPatterns: string[]
}

/** [minLat, maxLat, minLng, maxLng]. First matching box wins. Use when profile has lat/lng so we don't rely on city name. */
const MARKET_BOUNDS: { slug: string; bbox: [number, number, number, number] }[] = [
  { slug: 'la', bbox: [33.7, 34.45, -118.95, -117.75] }, // LA County (incl. Ladera Heights, Santa Monica, Long Beach, etc.)
  { slug: 'orange-county', bbox: [33.4, 33.95, -118.25, -117.5] },
  { slug: 'ie', bbox: [33.8, 34.3, -117.8, -116.9] }, // Inland Empire
  { slug: 'san-diego', bbox: [32.5, 33.2, -117.3, -116.9] },
  { slug: 'sf', bbox: [37.2, 38.0, -122.6, -121.5] }, // SF Bay
  { slug: 'nyc', bbox: [40.5, 40.95, -74.3, -73.7] },
  { slug: 'chicago', bbox: [41.6, 42.2, -88.0, -87.5] },
  { slug: 'houston', bbox: [29.5, 30.2, -95.8, -95.0] },
  { slug: 'phoenix', bbox: [33.2, 33.7, -112.2, -111.6] },
  { slug: 'dallas', bbox: [32.6, 33.3, -97.2, -96.6] },
  { slug: 'austin', bbox: [30.1, 30.6, -97.95, -97.5] },
  { slug: 'seattle', bbox: [47.5, 47.75, -122.45, -122.2] },
  { slug: 'denver', bbox: [39.6, 40.0, -105.2, -104.6] },
  { slug: 'boston', bbox: [42.2, 42.45, -71.2, -70.95] },
  { slug: 'atlanta', bbox: [33.6, 34.0, -84.5, -84.2] },
  { slug: 'miami', bbox: [25.7, 26.2, -80.4, -80.1] },
  { slug: 'las-vegas', bbox: [35.9, 36.4, -115.4, -114.9] },
]

export const MARKETS: Market[] = [
  {
    slug: 'orange-county',
    label: 'Orange County',
    cityPatterns: [
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
      'fullerton',
      'la habra',
      'laguna niguel',
      'dana point',
      'laguna beach',
      'san clemente',
      'aliso viejo',
      'laguna hills',
      'yorba linda',
      'placentia',
      'brea',
      'cypress',
      'los alamitos',
      'seal beach',
      'buena park',
      'la palma',
      'stanton',
      'villa park',
    ],
  },
  {
    slug: 'ie',
    label: 'Inland Empire',
    cityPatterns: [
      'inland empire',
      'riverside',
      'san bernardino',
      'ontario',
      'rancho cucamonga',
      'corona',
      'fontana',
      'moreno valley',
      'rialto',
      'redlands',
      'hesperia',
      'victorville',
      'temecula',
      'murrieta',
      'menifee',
      'hemet',
      'perris',
      'colton',
      'upland',
      'chino',
      'chino hills',
      'highland',
      'apple valley',
      'yucaipa',
      'lake elsinore',
      'wildomar',
      'norco',
      'eastvale',
      'jurupa valley',
      'montclair',
      'pomona',
      'claremont',
      'la verne',
      'san dimas',
      'glendora',
      'azusa',
      'covina',
      'west covina',
      'diamond bar',
      'walnut',
      'rowland heights',
    ],
  },
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
      'ladera heights',
      'view park',
      'windsor hills',
      'baldwin hills',
      'view park-windsor hills',
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
  {
    slug: 'chicago',
    label: 'Chicago',
    cityPatterns: [
      'chicago',
      'evanston',
      'oak park',
      'naperville',
      'aurora il',
      'aurora illinois',
      'joliet',
      'schaumburg',
      'skokie',
      'des plaines',
      'arlington heights',
      'palatine',
      'cicero',
      'berwyn',
      'waukegan',
      'champaign',
      'urbana',
      'bloomington',
      'normal',
      'dekalb',
    ],
  },
  {
    slug: 'houston',
    label: 'Houston',
    cityPatterns: [
      'houston',
      'the woodlands',
      'sugar land',
      'pearland',
      'baytown',
      'pasadena',
      'league city',
      'galveston',
      'conroe',
      'katy',
      'cypress',
      'spring',
      'humble',
      'kingwood',
    ],
  },
  {
    slug: 'phoenix',
    label: 'Phoenix',
    cityPatterns: [
      'phoenix',
      'scottsdale',
      'mesa',
      'tempe',
      'chandler',
      'gilbert',
      'glendale',
      'peoria',
      'surprise',
      'queen creek',
      'goodyear',
      'avondale',
      'flagstaff',
      'tucson',
    ],
  },
  {
    slug: 'philadelphia',
    label: 'Philadelphia',
    cityPatterns: [
      'philadelphia',
      'philly',
      'camden',
      'cherry hill',
      'wilmington',
      'reading',
      'allentown',
      'bethlehem',
      'chester',
      'norristown',
      'upper darby',
      'bensalem',
      'lower merion',
      'conshohocken',
      'manayunk',
      'fishtown',
    ],
  },
  {
    slug: 'san-antonio',
    label: 'San Antonio',
    cityPatterns: [
      'san antonio',
      'new braunfels',
      'schertz',
      'universal city',
      'live oak',
      'alamo heights',
      'helotes',
    ],
  },
  {
    slug: 'san-diego',
    label: 'San Diego',
    cityPatterns: [
      'san diego',
      'chula vista',
      'oceanside',
      'carlsbad',
      'el cajon',
      'vista',
      'san marcos',
      'encinitas',
      'national city',
      'la mesa',
      'poway',
      'santee',
      'coronado',
      'del mar',
      'la jolla',
      'mission valley',
    ],
  },
  {
    slug: 'dallas',
    label: 'Dallas–Fort Worth',
    cityPatterns: [
      'dallas',
      'fort worth',
      'arlington',
      'plano',
      'garland',
      'irving',
      'frisco',
      'mckinney',
      'grand prairie',
      'denton',
      'lewisville',
      'carrollton',
      'richardson',
      'allen',
      'flower mound',
      'north richland hills',
      'euless',
      'bedford',
      'grapevine',
      'keller',
      'southlake',
      'colleyville',
      'addison',
    ],
  },
  {
    slug: 'austin',
    label: 'Austin',
    cityPatterns: [
      'austin',
      'round rock',
      'cedar park',
      'georgetown',
      'pflugerville',
      'kyle',
      'buda',
      'lakeway',
      'bee cave',
      'west lake',
      'travis county',
    ],
  },
  {
    slug: 'jacksonville',
    label: 'Jacksonville',
    cityPatterns: [
      'jacksonville',
      'jacksonville beach',
      'atlantic beach',
      'neptune beach',
      'orange park',
      'st augustine',
      'fernandina',
    ],
  },
  {
    slug: 'columbus',
    label: 'Columbus',
    cityPatterns: [
      'columbus',
      'upper arlington',
      'gahanna',
      'reynoldsburg',
      'grove city',
      'hilliard',
      'westerville',
      'delaware',
      'worthington',
      'new albany',
      'powell',
    ],
  },
  {
    slug: 'charlotte',
    label: 'Charlotte',
    cityPatterns: [
      'charlotte',
      'huntersville',
      'matthews',
      'gastonia',
      'concord',
      'kannapolis',
      'rock hill',
      'fort mill',
      'mooresville',
      'south end',
      'noda',
      'plaza midwood',
    ],
  },
  {
    slug: 'indianapolis',
    label: 'Indianapolis',
    cityPatterns: [
      'indianapolis',
      'carmel',
      'fishers',
      'noblesville',
      'greenwood',
      'lawrence',
      'greenfield',
      'zionsville',
      'speedway',
      'broad ripple',
    ],
  },
  {
    slug: 'seattle',
    label: 'Seattle',
    cityPatterns: [
      'seattle',
      'bellevue',
      'tacoma',
      'everett',
      'kent',
      'renton',
      'kirkland',
      'redmond',
      'sammamish',
      'issaquah',
      'federal way',
      'shoreline',
      'bothell',
      'edmonds',
      'lynwood',
      'mukilteo',
      'covington',
      'burien',
      'des moines',
      'tukwila',
      'capitol hill',
      'ballard',
      'fremont',
      'queen anne',
    ],
  },
  {
    slug: 'denver',
    label: 'Denver',
    cityPatterns: [
      'denver',
      'aurora',
      'lakewood',
      'thornton',
      'arvada',
      'westminster',
      'centennial',
      'boulder',
      'fort collins',
      'greeley',
      'loveland',
      'englewood',
      'littleton',
      'golden',
      'wheat ridge',
      'cherry creek',
      'capitol hill',
      'lodo',
      'rino',
      'highlands',
    ],
  },
  {
    slug: 'boston',
    label: 'Boston',
    cityPatterns: [
      'boston',
      'cambridge',
      'somerville',
      'brookline',
      'quincy',
      'newton',
      'waltham',
      'lexington',
      'arlington',
      'watertown',
      'medford',
      'everett',
      'chelsea',
      'revere',
      'malden',
      'salem',
      'beverly',
      'lowell',
      'worcester',
      'providence',
      'back bay',
      'south end',
      'cambridgeport',
      'harvard square',
      'downtown crossing',
    ],
  },
  {
    slug: 'nashville',
    label: 'Nashville',
    cityPatterns: [
      'nashville',
      'franklin',
      'brentwood',
      'hendersonville',
      'murfreesboro',
      'smyrna',
      'mount juliet',
      'gallatin',
      'antioch',
      'bellevue',
      'east nashville',
      'the gulch',
      '12 south',
      'green hills',
    ],
  },
  {
    slug: 'detroit',
    label: 'Detroit',
    cityPatterns: [
      'detroit',
      'ann arbor',
      'dearborn',
      'troy',
      'warren',
      'sterling heights',
      'livonia',
      'southfield',
      'farmington',
      'royal oak',
      'berkley',
      'ferndale',
      'birmingham',
      'grosse pointe',
      'midtown',
      'corktown',
      'downtown',
    ],
  },
  {
    slug: 'portland',
    label: 'Portland',
    cityPatterns: [
      'portland',
      'beaverton',
      'hillsboro',
      'gresham',
      'lake oswego',
      'tigard',
      'tualatin',
      'oregon city',
      'milwaukie',
      'vancouver',
      'camas',
      'pearl district',
      'nob hill',
      'hawthorne',
      'division',
      'mississippi',
      'alberta',
    ],
  },
  {
    slug: 'las-vegas',
    label: 'Las Vegas',
    cityPatterns: [
      'las vegas',
      'henderson',
      'north las vegas',
      'summerlin',
      'spring valley',
      'paradise',
      'boulder city',
      'mesquite',
    ],
  },
  {
    slug: 'baltimore',
    label: 'Baltimore',
    cityPatterns: [
      'baltimore',
      'towson',
      'columbia',
      'ellicott city',
      'glen burnie',
      'dundalk',
      'canton',
      'fells point',
      'mount vernon',
      'hampden',
      'federal hill',
      'inner harbor',
    ],
  },
  {
    slug: 'milwaukee',
    label: 'Milwaukee',
    cityPatterns: [
      'milwaukee',
      'waukesha',
      'west allis',
      'brookfield',
      'greenfield',
      'wauwatosa',
      'shorewood',
      'whitefish bay',
      'mequon',
      'third ward',
      'east side',
      'brady street',
    ],
  },
  {
    slug: 'albuquerque',
    label: 'Albuquerque',
    cityPatterns: [
      'albuquerque',
      'rio rancho',
      'santa fe',
      'los lunas',
      'bernalillo',
      'nob hill',
      'downtown',
      'old town',
    ],
  },
  {
    slug: 'sacramento',
    label: 'Sacramento',
    cityPatterns: [
      'sacramento',
      'elk grove',
      'roseville',
      'citrus heights',
      'rancho cordova',
      'folsom',
      'davis',
      'woodland',
      'west sacramento',
      'midtown',
      'east sacramento',
      'land park',
      'tahoe park',
    ],
  },
  {
    slug: 'atlanta',
    label: 'Atlanta',
    cityPatterns: [
      'atlanta',
      'decatur',
      'sandy springs',
      'roswell',
      'alpharetta',
      'marietta',
      'smyrna',
      'dunwoody',
      'brookhaven',
      'chamblee',
      'east point',
      'college park',
      'buckhead',
      'midtown',
      'east atlanta',
      'virginia-highland',
      'little five points',
      'inman park',
      'candler park',
      'grant park',
    ],
  },
  {
    slug: 'kansas-city',
    label: 'Kansas City',
    cityPatterns: [
      'kansas city',
      'kansas city mo',
      'kansas city ks',
      'overland park',
      'olathe',
      'independence',
      'lee\'s summit',
      'lees summit',
      'shawnee',
      'blue springs',
      'liberty',
      'north kansas city',
      'river market',
      'crossroads',
      'westport',
      'brookside',
      'waldo',
    ],
  },
  {
    slug: 'miami',
    label: 'Miami',
    cityPatterns: [
      'miami',
      'miami beach',
      'fort lauderdale',
      'hollywood',
      'pembroke pines',
      'coral springs',
      'boca raton',
      'west palm beach',
      'delray beach',
      'brickell',
      'wynwood',
      'little havana',
      'coconut grove',
      'coral gables',
      'key biscayne',
      'south beach',
      'kendall',
      'doral',
      'hialeah',
      'aventura',
    ],
  },
  {
    slug: 'raleigh',
    label: 'Raleigh–Durham',
    cityPatterns: [
      'raleigh',
      'durham',
      'chapel hill',
      'cary',
      'apex',
      'holly springs',
      'wake forest',
      'garner',
      'morrisville',
      'research triangle',
      'downtown raleigh',
      'downtown durham',
      'north hills',
      'glenwood south',
    ],
  },
  {
    slug: 'minneapolis',
    label: 'Minneapolis–Saint Paul',
    cityPatterns: [
      'minneapolis',
      'saint paul',
      'st paul',
      'bloomington',
      'brooklyn park',
      'plymouth',
      'woodbury',
      'maple grove',
      'eden prairie',
      'edina',
      'minnetonka',
      'st louis park',
      'richfield',
      'uptown',
      'north loop',
      'northeast',
      'dinkytown',
      'grand avenue',
      'highland park',
      'summit hill',
    ],
  },
  {
    slug: 'cleveland',
    label: 'Cleveland',
    cityPatterns: [
      'cleveland',
      'cleveland heights',
      'lakewood',
      'euclid',
      'parma',
      'elyria',
      'mentor',
      'strongsville',
      'westlake',
      'fairview park',
      'tremont',
      'ohio city',
      'detroit shoreway',
      'covington',
      'little italy',
    ],
  },
  {
    slug: 'tampa',
    label: 'Tampa Bay',
    cityPatterns: [
      'tampa',
      'st petersburg',
      'saint petersburg',
      'clearwater',
      'brandon',
      'lutz',
      'temple terrace',
      'south tampa',
      'hyde park',
      'ybor city',
      'downtown tampa',
      'gulfport',
      'dunedin',
      'safety harbor',
    ],
  },
  {
    slug: 'st-louis',
    label: 'St. Louis',
    cityPatterns: [
      'st louis',
      'saint louis',
      'st. louis',
      'chesterfield',
      'ballwin',
      'florissant',
      'university city',
      'webster groves',
      'kirkwood',
      'maryland heights',
      'creve coeur',
      'soulard',
      'central west end',
      'the loop',
      'tower grove',
      'lafayette square',
    ],
  },
  {
    slug: 'pittsburgh',
    label: 'Pittsburgh',
    cityPatterns: [
      'pittsburgh',
      'pittsburg',
      'mount lebanon',
      'bethel park',
      'ross township',
      'mccandless',
      'monroeville',
      'cranberry',
      'shadyside',
      'squirrel hill',
      'lawrenceville',
      'strip district',
      'south side',
      'oakland',
      'downtown',
    ],
  },
  {
    slug: 'cincinnati',
    label: 'Cincinnati',
    cityPatterns: [
      'cincinnati',
      'covington',
      'newport',
      'norwood',
      'hyde park',
      'oakley',
      'clifton',
      'over-the-rhine',
      'downtown',
      'mount adams',
      'northside',
      'walnut hills',
      'anderson',
      'mason',
      'west chester',
      'fairfield',
    ],
  },
  {
    slug: 'orlando',
    label: 'Orlando',
    cityPatterns: [
      'orlando',
      'winter park',
      'kissimmee',
      'sanford',
      'altamonte springs',
      'oviedo',
      'lake mary',
      'downtown orlando',
      'thornton park',
      'mills 50',
      'audubon park',
      'college park',
      'winter garden',
      'dr phillips',
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
 * Return market when we have coordinates. Uses bounding boxes so any point in the metro (e.g. Ladera Heights) maps
 * without listing every neighborhood. First matching box wins.
 */
export function getMarketFromLatLng(lat: number | null | undefined, lng: number | null | undefined): { slug: string; label: string } | null {
  if (lat == null || lng == null || typeof lat !== 'number' || typeof lng !== 'number') return null
  for (const { slug, bbox } of MARKET_BOUNDS) {
    const [minLat, maxLat, minLng, maxLng] = bbox
    if (lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng) {
      const m = getMarketBySlug(slug)
      return m ? { slug: m.slug, label: m.label } : null
    }
  }
  return null
}

/**
 * Return the market for a profile's city string (fallback when lat/lng missing).
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

/**
 * Prefer lat/lng when available (one lookup by bounds); otherwise fall back to city string.
 * Use this wherever we set profile.market and have both city and optional coordinates.
 */
export function getMarketFromCityOrLatLng(
  city: string | null | undefined,
  lat?: number | null,
  lng?: number | null
): { slug: string; label: string } | null {
  const fromCoords = getMarketFromLatLng(lat, lng)
  if (fromCoords) return fromCoords
  return getMarketFromCity(city)
}

export function getMarketBySlug(slug: string | null | undefined): Market | null {
  if (slug == null || typeof slug !== 'string') return null
  return slugToMarket.get(slug.trim().toLowerCase()) ?? null
}

/**
 * GeoJSON Polygon coordinates for each market (from current bboxes). For admin map: draw zone boundaries.
 * Coordinates: [ ring ] where ring is [ [lng, lat], ... ] closed (first point = last point).
 */
export function getMarketPolygons(): { slug: string; label: string; coordinates: number[][][] }[] {
  return MARKET_BOUNDS.map(({ slug, bbox }) => {
    const [minLat, maxLat, minLng, maxLng] = bbox
    const ring: [number, number][] = [
      [minLng, minLat],
      [maxLng, minLat],
      [maxLng, maxLat],
      [minLng, maxLat],
      [minLng, minLat],
    ]
    const m = getMarketBySlug(slug)
    return { slug, label: m?.label ?? slug, coordinates: [ring] }
  })
}

/** Ray-casting point-in-polygon. Ring is array of [lng, lat] (GeoJSON order). */
export function pointInPolygon(ring: [number, number][], lat: number, lng: number): boolean {
  if (!ring?.length) return false
  let inside = false
  const n = ring.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    const lngI = xi
    const latI = yi
    const lngJ = xj
    const latJ = yj
    if (latI > lat !== latJ > lat && lng < ((lngJ - lngI) * (lat - latI)) / (latJ - latI) + lngI) inside = !inside
  }
  return inside
}

/** GeoJSON Polygon type: coordinates[0] is exterior ring [ [lng, lat], ... ]. */
function parseBoundaryPolygon(boundary: unknown): [number, number][] | null {
  if (boundary == null || typeof boundary !== 'object') return null
  const o = boundary as { type?: string; coordinates?: unknown }
  if (o.type !== 'Polygon' || !Array.isArray(o.coordinates) || o.coordinates.length === 0) return null
  const ring = o.coordinates[0]
  if (!Array.isArray(ring) || ring.some((p) => !Array.isArray(p) || p.length < 2)) return null
  return ring as [number, number][]
}

/**
 * Resolve market from DB: load markets with non-null boundary, run point-in-polygon; first match wins.
 * Use when you have Supabase and lat/lng; falls back to code bbox/city when used via getMarketFromCityOrLatLngWithDb.
 */
export async function getMarketFromLatLngFromDb(
  supabase: SupabaseClient,
  lat: number,
  lng: number
): Promise<{ slug: string; label: string } | null> {
  const { data: rows } = await supabase
    .from('markets')
    .select('slug, label, boundary')
    .not('boundary', 'is', null)
  if (!rows?.length) return null
  for (const row of rows) {
    const ring = parseBoundaryPolygon((row as { boundary?: unknown }).boundary)
    if (ring && pointInPolygon(ring, lat, lng)) {
      return {
        slug: (row as { slug: string }).slug,
        label: (row as { label: string }).label ?? (row as { slug: string }).slug,
      }
    }
  }
  return null
}

/**
 * Async resolver: prefers DB boundary (point-in-polygon), then code bbox, then city.
 * Use wherever you set profile.market and have access to Supabase (onboarding, merge-sms-signup, profile settings).
 */
export async function getMarketFromCityOrLatLngWithDb(
  supabase: SupabaseClient,
  city: string | null | undefined,
  lat?: number | null,
  lng?: number | null
): Promise<{ slug: string; label: string } | null> {
  if (lat != null && lng != null && typeof lat === 'number' && typeof lng === 'number') {
    const fromDb = await getMarketFromLatLngFromDb(supabase, lat, lng)
    if (fromDb) return fromDb
    const fromBbox = getMarketFromLatLng(lat, lng)
    if (fromBbox) return fromBbox
  }
  return getMarketFromCity(city)
}

/**
 * Polygons for admin map: DB boundary when set, else code bbox. Merges markets table with code MARKET_BOUNDS.
 */
export async function getMarketPolygonsWithDb(
  supabase: SupabaseClient
): Promise<{ slug: string; label: string; coordinates: number[][][] }[]> {
  const codePolygons = getMarketPolygons()
  const bySlug = new Map(codePolygons.map((p) => [p.slug, { slug: p.slug, label: p.label, coordinates: p.coordinates }]))
  const { data: dbMarkets } = await supabase.from('markets').select('slug, label, boundary')
  for (const row of dbMarkets ?? []) {
    const slug = (row as { slug: string }).slug
    const label = (row as { label?: string }).label ?? slug
    const ring = parseBoundaryPolygon((row as { boundary?: unknown }).boundary)
    if (ring) {
      bySlug.set(slug, { slug, label, coordinates: [ring] })
    } else {
      const existing = bySlug.get(slug)
      if (existing) existing.label = label
    }
  }
  return Array.from(bySlug.values())
}
