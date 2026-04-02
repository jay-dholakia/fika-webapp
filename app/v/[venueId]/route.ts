import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

function buildVenueMapsUrl(params: {
  name?: string | null
  address?: string | null
  city?: string | null
  lat?: number | null
  lng?: number | null
}): string | null {
  const name = params.name?.trim() ?? ''
  const address = params.address?.trim() ?? ''
  const city = params.city?.trim() ?? ''
  const lat = typeof params.lat === 'number' ? params.lat : Number(params.lat)
  const lng = typeof params.lng === 'number' ? params.lng : Number(params.lng)

  const businessQuery = [name, address || city].filter(Boolean).join(', ').trim()
  if (businessQuery) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(businessQuery)}`
  }
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}`
  }
  return null
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ venueId: string }> }
) {
  const { venueId } = await context.params
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()

  if (!url || !key) {
    return NextResponse.redirect('https://www.google.com/maps')
  }

  const supabase = createClient(url, key)
  const { data: venue } = await supabase
    .from('venues')
    .select('name, address, city, lat, lng')
    .eq('id', venueId)
    .maybeSingle()

  const mapsUrl = buildVenueMapsUrl({
    name: venue?.name ?? null,
    address: venue?.address ?? null,
    city: venue?.city ?? null,
    lat: venue?.lat ?? null,
    lng: venue?.lng ?? null,
  })

  return NextResponse.redirect(mapsUrl ?? 'https://www.google.com/maps')
}
