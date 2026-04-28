/**
 * Server-side geocode helpers. Used by GET /api/geocode and POST /api/waitlist.
 */

const NOMINATIM_HEADERS = {
  'User-Agent': 'FikaApp/1.0 (https://letsfika.co; contact@letsfika.co)',
  Accept: 'application/json',
}

/** US zip → { city, lat, lng } via Google Geocoding (preferred) or Nominatim. */
export async function geocodeZip(zip: string): Promise<{ city: string; lat: number; lng: number } | null> {
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

/** Forward geocode a US address line (admin venue tooling). Requires Google Geocoding API key. */
export async function geocodeUsAddressLine(
  address: string
): Promise<{ lat: number; lng: number; formatted_address?: string } | null> {
  const googleKey = process.env.GOOGLE_MAPS_API_KEY ?? process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
  const q = address.trim()
  if (!googleKey || !q) return null
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q)}&key=${googleKey}&region=us`
    const res = await fetch(url)
    if (!res.ok) return null
    const data = (await res.json()) as {
      status?: string
      results?: Array<{
        formatted_address?: string
        geometry?: { location?: { lat: number; lng: number } }
      }>
    }
    if (data.status !== 'OK' || !data.results?.length) return null
    const first = data.results[0]
    const lat = first.geometry?.location?.lat
    const lng = first.geometry?.location?.lng
    if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return null
    return {
      lat,
      lng,
      formatted_address: first.formatted_address,
    }
  } catch {
    return null
  }
}
