import { NextResponse } from 'next/server'

const NOMINATIM_HEADERS = {
  'User-Agent': 'FikaOnboarding/1.0 (contact@example.com)',
  Accept: 'application/json',
}

/**
 * Server-side geocode using Nominatim.
 * - ?lat=&lng= : reverse geocode → { city, state }
 * - ?zip= : forward geocode (US zip) → { city, lat, lng }
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const lat = searchParams.get('lat')
  const lng = searchParams.get('lng')
  const zip = searchParams.get('zip')?.trim()

  if (zip) {
    try {
      const q = encodeURIComponent(`${zip}, USA`)
      const url = `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1`
      const res = await fetch(url, { headers: NOMINATIM_HEADERS })
      if (!res.ok) {
        return NextResponse.json({ error: 'Geocode failed' }, { status: 502 })
      }
      const data = (await res.json()) as Array<{
        lat?: string
        lon?: string
        display_name?: string
        address?: {
          city?: string
          town?: string
          village?: string
          county?: string
          state?: string
          region?: string
          postcode?: string
        }
      }>
      const first = data?.[0]
      if (!first?.lat || !first?.lon) {
        return NextResponse.json({ error: 'Could not find a location for that zip code.' }, { status: 404 })
      }
      const addr = first.address ?? {}
      const city =
        addr.city ?? addr.town ?? addr.village ?? addr.county ?? (first.display_name ?? 'Unknown')
      const region = addr.state ?? addr.region ?? ''
      const cityStr = region ? `${city}, ${region}` : city
      return NextResponse.json({
        city: cityStr,
        lat: Number(first.lat),
        lng: Number(first.lon),
      })
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'Geocode failed' },
        { status: 502 }
      )
    }
  }

  if (lat == null || lng == null) {
    return NextResponse.json({ error: 'lat and lng required' }, { status: 400 })
  }
  const numLat = Number(lat)
  const numLng = Number(lng)
  if (Number.isNaN(numLat) || Number.isNaN(numLng)) {
    return NextResponse.json({ error: 'Invalid lat or lng' }, { status: 400 })
  }

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${numLat}&lon=${numLng}&format=json`
    const res = await fetch(url, { headers: NOMINATIM_HEADERS })
    if (!res.ok) {
      return NextResponse.json({ error: 'Geocode failed' }, { status: 502 })
    }
    const data = (await res.json()) as {
      address?: {
        city?: string
        town?: string
        village?: string
        county?: string
        state?: string
        region?: string
      }
    }
    const addr = data.address ?? {}
    const city =
      addr.city ?? addr.town ?? addr.village ?? addr.county ?? 'Unknown'
    const region = addr.state ?? addr.region ?? ''
    const cityStr = region ? `${city}, ${region}` : city
    return NextResponse.json({ city: cityStr, state: region })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Geocode failed' },
      { status: 502 }
    )
  }
}
