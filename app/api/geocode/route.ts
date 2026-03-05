import { NextResponse } from 'next/server'

const NOMINATIM_HEADERS = {
  'User-Agent': 'FikaApp/1.0 (https://letsfika.co; contact@letsfika.co)',
  Accept: 'application/json',
}

/** US zip → { city, lat, lng } via Google Geocoding (preferred) or Nominatim. */
async function geocodeZip(zip: string): Promise<{ city: string; lat: number; lng: number } | null> {
  const googleKey = process.env.GOOGLE_MAPS_API_KEY ?? process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
  if (googleKey) {
    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(zip + ', USA')}&key=${googleKey}&region=us`
      const res = await fetch(url)
      if (!res.ok) return null
      const data = (await res.json()) as {
        status?: string
        results?: Array<{
          geometry?: { location?: { lat: number; lng: number } }
          address_components?: Array<{ long_name: string; short_name: string; types: string[] }>
          formatted_address?: string
        }>
      }
      if (data.status !== 'OK' || !data.results?.length) return null
      const first = data.results[0]
      const lat = first.geometry?.location?.lat
      const lng = first.geometry?.location?.lng
      if (lat == null || lng == null) return null
      const comps = first.address_components ?? []
      let city = ''
      let state = ''
      for (const c of comps) {
        if (c.types?.includes('locality')) city = c.long_name ?? ''
        else if (c.types?.includes('sublocality') && !city) city = c.long_name ?? ''
        else if (c.types?.includes('administrative_area_level_1')) state = c.short_name ?? ''
        else if (c.types?.includes('postal_town') && !city) city = c.long_name ?? ''
      }
      if (!city && comps.length) {
        const postal = comps.find((c) => c.types?.includes('postal_code'))
        city = postal?.long_name ? `ZIP ${postal.long_name}` : 'Unknown'
      } else if (!city) city = 'Unknown'
      const cityStr = state ? `${city}, ${state}` : city
      return { city: cityStr, lat, lng }
    } catch {
      return null
    }
  }

  try {
    const q = encodeURIComponent(`${zip}, USA`)
    const url = `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1&countrycodes=us`
    const res = await fetch(url, { headers: NOMINATIM_HEADERS })
    if (!res.ok) {
      if (res.status === 429) return null
      return null
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
    if (!first?.lat || !first?.lon) return null
    const addr = first.address ?? {}
    const city =
      addr.city ?? addr.town ?? addr.village ?? addr.county ?? (first.display_name ?? 'Unknown')
    const region = addr.state ?? addr.region ?? ''
    const cityStr = region ? `${city}, ${region}` : city
    return {
      city: cityStr,
      lat: Number(first.lat),
      lng: Number(first.lon),
    }
  } catch {
    return null
  }
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
