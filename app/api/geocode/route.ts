import { NextResponse } from 'next/server'

/**
 * Server-side reverse geocode using Nominatim.
 * Avoids CORS/403 by not calling Nominatim from the browser.
 * Use when Google Maps API key is not set.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const lat = searchParams.get('lat')
  const lng = searchParams.get('lng')
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
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'FikaOnboarding/1.0 (contact@example.com)',
        Accept: 'application/json',
      },
    })
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
