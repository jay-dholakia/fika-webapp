/**
 * Fallback venue discovery via Google Places API (New) when DB pickVenueFromDatabase returns null.
 * Server-only; uses GOOGLE_MAPS_API_KEY or NEXT_PUBLIC_GOOGLE_MAPS_API_KEY.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { haversineKm } from '@/lib/distance'

/** Same shape as UserLocation in sms-agent (avoid circular imports). */
type VenueUserLocation = {
  lat?: number | null
  lng?: number | null
  radius_km?: number | null
}

const PLACES_NEARBY_URL = 'https://places.googleapis.com/v1/places:searchNearby'

/** Lowercase substrings — skip big chains (prefer local / indie). */
const CHAIN_NAME_BLOCKLIST = [
  'starbucks',
  'dunkin',
  "dunkin'",
  'peet\'s coffee',
  'peets coffee',
  'tim hortons',
  'dutch bros',
  'coffee bean & tea',
  'the coffee bean',
  'krispy kreme',
  'paris baguette',
  'mcdonald',
  "mcdonald's",
]

function isBlockedChainName(name: string): boolean {
  const n = name.toLowerCase()
  return CHAIN_NAME_BLOCKLIST.some((b) => n.includes(b))
}

function getGoogleMapsApiKey(): string | null {
  const k =
    process.env.GOOGLE_MAPS_API_KEY?.trim() ||
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() ||
    ''
  return k || null
}

function hasValidLatLng(u: VenueUserLocation): boolean {
  const lat = u.lat != null ? Number(u.lat) : NaN
  const lng = u.lng != null ? Number(u.lng) : NaN
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
}

export type GoogleNearbyPlace = {
  placeId: string
  name: string
  lat: number
  lng: number
  formattedAddress: string
}

/** Google Places OpeningHours / Period (subset). */
type OpeningHoursPayload = {
  periods?: Array<{
    open?: { day?: number; hour?: number; minute?: number }
    close?: { day?: number; hour?: number; minute?: number }
  }>
  openNow?: boolean
}

type TimeZonePayload = { id?: string }

function pointToMinutes(p: { day?: number; hour?: number; minute?: number } | undefined): number | null {
  if (p == null || p.day == null || p.hour == null || p.minute == null) return null
  return p.day * 24 * 60 + p.hour * 60 + p.minute
}

function getLocalWeekMinutes(meetingAtUtc: Date, timeZoneId: string): number | null {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timeZoneId,
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(meetingAtUtc)
  const wd = parts.find((p) => p.type === 'weekday')?.value
  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '', 10)
  const minute = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '', 10)
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  const day = wd != null ? dayMap[wd] : undefined
  if (day === undefined || !Number.isFinite(hour) || !Number.isFinite(minute)) return null
  return day * 24 * 60 + hour * 60 + minute
}

/** Inclusive interval; supports weekly wrap (e.g. Sat night → Sun morning). */
function isMinuteInOpenPeriod(
  m: number,
  openM: number,
  closeM: number | null,
  hasClose: boolean
): boolean {
  if (!hasClose) return true
  if (closeM == null) return true
  if (closeM >= openM) return m >= openM && m <= closeM
  return m >= openM || m <= closeM
}

/**
 * True if meeting instant falls in regular hours (place-local), false if clearly closed, null if unknown.
 */
function isOpenAtMeetingTime(
  meetingAtUtc: Date,
  timeZoneId: string | undefined,
  regular: OpeningHoursPayload | undefined
): boolean | null {
  if (regular?.periods && regular.periods.length === 0) return false
  const periods = regular?.periods
  if (!periods?.length) return null
  if (!timeZoneId) return null

  const m = getLocalWeekMinutes(meetingAtUtc, timeZoneId)
  if (m == null) return null

  for (const period of periods) {
    const openM = pointToMinutes(period.open)
    if (openM == null) continue
    const hasClose = period.close != null
    const closeM = hasClose ? pointToMinutes(period.close) : null
    if (hasClose && closeM == null) continue
    if (isMinuteInOpenPeriod(m, openM, closeM, hasClose)) return true
  }
  return false
}

/**
 * With a proposed meeting time: use regular hours + IANA timezone when present.
 * `openNow` reflects the request time, not the meeting — only used when there is no `meetingAtUtc`.
 */
function placePassesOpeningFilter(
  meetingAtUtc: Date | undefined,
  currentOpening: OpeningHoursPayload | undefined,
  regular: OpeningHoursPayload | undefined,
  timeZone: TimeZonePayload | undefined
): boolean {
  if (meetingAtUtc) {
    const verdict = isOpenAtMeetingTime(meetingAtUtc, timeZone?.id, regular)
    if (verdict === true) return true
    if (verdict === false) return false
    return true
  }
  if (currentOpening?.openNow === false) return false
  return true
}

/**
 * Search cafes near the midpoint between two users; filter chains; rank by minimax distance (same fairness as DB).
 * Optional `meetingAtUtc`: when set, filters using regular hours + timezone when Places returns them.
 */
export async function searchNearbyCafesGooglePlaces(params: {
  userA: VenueUserLocation
  userB: VenueUserLocation
  meetingAtUtc?: Date
}): Promise<GoogleNearbyPlace | null> {
  const apiKey = getGoogleMapsApiKey()
  if (!apiKey) return null
  const { userA, userB, meetingAtUtc } = params
  if (!hasValidLatLng(userA) || !hasValidLatLng(userB)) return null

  const latA = Number(userA.lat)
  const lngA = Number(userA.lng)
  const latB = Number(userB.lat)
  const lngB = Number(userB.lng)
  const maxDistA =
    userA.radius_km != null && Number.isFinite(Number(userA.radius_km)) ? Number(userA.radius_km) : 40
  const maxDistB =
    userB.radius_km != null && Number.isFinite(Number(userB.radius_km)) ? Number(userB.radius_km) : 40

  const centerLat = (latA + latB) / 2
  const centerLng = (lngA + lngB) / 2
  const abKm = haversineKm(latA, lngA, latB, lngB)
  // Search circle: cover midpoint neighborhood; strict filter applied after.
  const radiusMeters = Math.min(
    50_000,
    Math.max(800, (abKm / 2 + Math.min(maxDistA, maxDistB)) * 1000)
  )

  try {
    const res = await fetch(PLACES_NEARBY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask':
          'places.id,places.displayName,places.location,places.formattedAddress,places.types,places.currentOpeningHours,places.regularOpeningHours,places.timeZone',
      },
      body: JSON.stringify({
        locationRestriction: {
          circle: {
            center: { latitude: centerLat, longitude: centerLng },
            radius: radiusMeters,
          },
        },
        includedTypes: ['cafe', 'coffee_shop'],
        maxResultCount: 20,
        rankPreference: 'DISTANCE',
      }),
    })

    if (!res.ok) {
      console.warn('[google-places-venues] searchNearby HTTP', res.status, await res.text().catch(() => ''))
      return null
    }

    const data = (await res.json()) as {
      places?: Array<{
        id?: string
        displayName?: { text?: string }
        formattedAddress?: string
        location?: { latitude?: number; longitude?: number }
        currentOpeningHours?: OpeningHoursPayload
        regularOpeningHours?: OpeningHoursPayload
        timeZone?: TimeZonePayload
      }>
    }
    const places = data.places ?? []
    type Scored = GoogleNearbyPlace & { maxDist: number }
    const scored: Scored[] = []

    for (const p of places) {
      const placeId = p.id?.replace(/^places\//, '') ?? ''
      const name = p.displayName?.text?.trim() ?? ''
      const lat = p.location?.latitude
      const lng = p.location?.longitude
      const formattedAddress = p.formattedAddress?.trim() ?? ''
      if (!placeId || !name || lat == null || lng == null) continue
      if (isBlockedChainName(name)) continue
      if (!placePassesOpeningFilter(meetingAtUtc, p.currentOpeningHours, p.regularOpeningHours, p.timeZone)) continue

      const distA = haversineKm(latA, lngA, lat, lng)
      const distB = haversineKm(latB, lngB, lat, lng)
      if (distA > maxDistA || distB > maxDistB) continue
      const maxDist = Math.max(distA, distB)
      scored.push({
        placeId,
        name,
        lat,
        lng,
        formattedAddress: formattedAddress || name,
        maxDist,
      })
    }

    if (scored.length === 0) return null
    scored.sort((a, b) => a.maxDist - b.maxDist)
    const best = scored[0]
    return {
      placeId: best.placeId,
      name: best.name,
      lat: best.lat,
      lng: best.lng,
      formattedAddress: best.formattedAddress,
    }
  } catch (e) {
    console.warn('[google-places-venues] searchNearby error', e)
    return null
  }
}

/** Parse a rough city string from Google formatted address (last comma segment before USA / state zip). */
function cityFromFormattedAddress(addr: string): string {
  const parts = addr.split(',').map((s) => s.trim()).filter(Boolean)
  if (parts.length >= 2) return parts[parts.length - 2] ?? parts[parts.length - 1] ?? 'Local'
  return parts[0] ?? 'Local'
}

/**
 * Upsert a Google place into `venues` and return the row shape expected by SMS (id + display fields).
 */
export async function upsertVenueFromGooglePlace(
  supabase: SupabaseClient,
  place: GoogleNearbyPlace
): Promise<{ id: string; name: string; neighborhood: string | null; city: string } | null> {
  const city = cityFromFormattedAddress(place.formattedAddress)
  const googlePlaceId = place.placeId

  const row = {
    name: place.name,
    neighborhood: null as string | null,
    city,
    address: place.formattedAddress,
    lat: place.lat,
    lng: place.lng,
    google_place_id: googlePlaceId,
    updated_at: new Date().toISOString(),
  }

  const { data, error } = await supabase
    .from('venues')
    .upsert(row, { onConflict: 'google_place_id' })
    .select('id, name, neighborhood, city')
    .maybeSingle()

  if (error) {
    console.warn('[google-places-venues] upsert error', error.message)
    const { data: existing } = await supabase
      .from('venues')
      .select('id, name, neighborhood, city')
      .eq('google_place_id', googlePlaceId)
      .maybeSingle()
    return existing ?? null
  }
  return data ?? null
}
