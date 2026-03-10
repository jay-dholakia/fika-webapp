import { NextResponse } from 'next/server'
import { geocodeZip } from '@/lib/geocode'

const NOMINATIM_HEADERS = {
  'User-Agent': 'FikaApp/1.0 (https://letsfika.co; contact@letsfika.co)',
  Accept: 'application/json',
}

/**
 * Server-side geocode.
 * - ?lat=&lng= : reverse geocode → { city, state }
 * - ?zip= : forward geocode (US zip) → { city, lat, lng }
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const lat = searchParams.get('lat')
  const lng = searchParams.get('lng')
  const zip = searchParams.get('zip')?.trim()

  if (zip) {
    const normalizedZip = zip.replace(/\s+/g, '').slice(0, 10)
    if (!normalizedZip) {
      return NextResponse.json({ error: 'Please enter a zip code.' }, { status: 400 })
    }
    const result = await geocodeZip(normalizedZip)
    if (!result) {
      return NextResponse.json(
        { error: 'Could not find a location for that zip code. Try another zip or use "Use my location".' },
        { status: 404 }
      )
    }
    return NextResponse.json(result)
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
