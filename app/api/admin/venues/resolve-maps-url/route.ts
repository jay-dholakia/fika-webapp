import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { createClient } from '@supabase/supabase-js'
import { isAdminByUserId } from '@/lib/admin-markets'
import { getGoogleMapsApiKey } from '@/lib/google-places-venues'

export const dynamic = 'force-dynamic'

async function requireAdmin(request: Request) {
  const supabaseAuth = await createServerSupabase()
  if (!supabaseAuth) return { error: NextResponse.json({ error: 'Not configured' }, { status: 500 }) }
  let userId: string | null = null
  const { data: { session } } = await supabaseAuth.auth.getSession()
  if (session?.user?.id) userId = session.user.id
  if (!userId) {
    const authHeader = request.headers.get('Authorization')
    if (authHeader?.startsWith('Bearer ')) {
      const { data: { user } } = await supabaseAuth.auth.getUser(authHeader.slice(7))
      if (user?.id) userId = user.id
    }
  }
  if (!userId) return { error: NextResponse.json({ error: 'Not signed in', code: 'NO_SESSION' }, { status: 401 }) }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) return { error: NextResponse.json({ error: 'Server not configured' }, { status: 500 }) }
  const supabase = createClient(url, key)
  if (!(await isAdminByUserId(supabase, userId))) {
    return { error: NextResponse.json({ error: 'Admin role required', code: 'NOT_ADMIN' }, { status: 403 }) }
  }
  return { supabase }
}

/** Extract name and lat/lng from a fully-resolved Google Maps URL. */
function parseMapsUrl(url: string): { name: string | null; lat: number | null; lng: number | null } {
  let name: string | null = null
  let lat: number | null = null
  let lng: number | null = null

  // Name from /place/NAME/ segment
  const placeMatch = url.match(/\/place\/([^/@?&]+)/)
  if (placeMatch) {
    try {
      name = decodeURIComponent(placeMatch[1].replace(/\+/g, ' '))
    } catch {
      name = placeMatch[1].replace(/\+/g, ' ')
    }
  }

  // Lat/lng from @lat,lng
  const coordMatch = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/)
  if (coordMatch) {
    lat = parseFloat(coordMatch[1])
    lng = parseFloat(coordMatch[2])
  }

  return { name, lat, lng }
}

/** Follow up to 5 HTTP redirects and return the final URL. */
async function resolveRedirects(rawUrl: string): Promise<string> {
  let current = rawUrl
  for (let i = 0; i < 5; i++) {
    const res = await fetch(current, { method: 'HEAD', redirect: 'manual' })
    const loc = res.headers.get('location')
    if (!loc || res.status < 300 || res.status >= 400) break
    current = loc.startsWith('http') ? loc : new URL(loc, current).toString()
  }
  return current
}

/** Old Places API: Find Place from text + location bias → returns first place_id. */
async function findPlaceId(name: string, lat: number | null, lng: number | null, apiKey: string): Promise<string | null> {
  const params = new URLSearchParams({
    input: name,
    inputtype: 'textquery',
    fields: 'place_id',
    key: apiKey,
  })
  if (lat != null && lng != null) params.set('locationbias', `point:${lat},${lng}`)
  const res = await fetch(`https://maps.googleapis.com/maps/api/place/findplacefromtext/json?${params}`)
  if (!res.ok) return null
  const data = await res.json() as { candidates?: Array<{ place_id?: string }> }
  return data.candidates?.[0]?.place_id ?? null
}

/** Old Places API: Place Details → full venue info. */
async function fetchPlaceDetails(placeId: string, apiKey: string): Promise<{
  name: string
  formatted_address: string
  lat: number
  lng: number
  place_id: string
} | null> {
  const params = new URLSearchParams({
    place_id: placeId,
    fields: 'name,formatted_address,geometry,place_id',
    key: apiKey,
  })
  const res = await fetch(`https://maps.googleapis.com/maps/api/place/details/json?${params}`)
  if (!res.ok) return null
  const data = await res.json() as {
    status?: string
    result?: {
      name?: string
      formatted_address?: string
      geometry?: { location?: { lat?: number; lng?: number } }
      place_id?: string
    }
  }
  if (data.status !== 'OK' || !data.result) return null
  const r = data.result
  return {
    name: r.name ?? '',
    formatted_address: r.formatted_address ?? '',
    lat: r.geometry?.location?.lat ?? 0,
    lng: r.geometry?.location?.lng ?? 0,
    place_id: r.place_id ?? placeId,
  }
}

/**
 * POST { "url": "https://maps.google.com/..." }
 * Resolves any redirect, extracts name/coords, fetches full Place Details via old API.
 * Returns { name, address, lat, lng, place_id } ready to import.
 */
export async function POST(request: Request) {
  const auth = await requireAdmin(request)
  if ('error' in auth && auth.error) return auth.error

  const apiKey = getGoogleMapsApiKey()
  if (!apiKey) return NextResponse.json({ error: 'Google Maps API key not configured', code: 'NO_GOOGLE_KEY' }, { status: 503 })

  const body = await request.json().catch(() => ({} as Record<string, unknown>))
  const rawUrl = typeof body.url === 'string' ? body.url.trim() : ''
  if (!rawUrl) return NextResponse.json({ error: 'url is required' }, { status: 400 })

  // 1. Follow any redirects (short links like maps.app.goo.gl)
  const resolvedUrl = await resolveRedirects(rawUrl).catch(() => rawUrl)

  // 2. Parse name + coords from the resolved URL
  const { name, lat, lng } = parseMapsUrl(resolvedUrl)
  if (!name) {
    return NextResponse.json(
      { error: 'Could not parse venue name from this URL. Try a full Google Maps business page link.' },
      { status: 422 }
    )
  }

  // 3. Find Place ID via old API
  const placeId = await findPlaceId(name, lat, lng, apiKey)
  if (!placeId) {
    return NextResponse.json(
      { error: `Could not find "${name}" in Google Places. Try pasting the full business page URL.` },
      { status: 404 }
    )
  }

  // 4. Fetch full details via old API
  const details = await fetchPlaceDetails(placeId, apiKey)
  if (!details) {
    return NextResponse.json({ error: 'Could not fetch place details from Google.', code: 'PLACE_DETAILS_FAILED' }, { status: 502 })
  }

  // 5. Check if already in our database
  const { data: existing } = await auth.supabase
    .from('venues')
    .select('id')
    .eq('google_place_id', placeId)
    .maybeSingle()

  return NextResponse.json({ place: details, already_exists: !!existing })
}
