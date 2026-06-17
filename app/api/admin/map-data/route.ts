import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { createServerSupabase, getUserIdFromRequest } from '@/lib/supabase-server'
import { isAdminByUserId } from '@/lib/admin-markets'
import { getMarketPolygonsWithDb } from '@/lib/markets'

export const dynamic = 'force-dynamic'

/** GET /api/admin/map-data — profiles with lat/lng + market polygons for admin map. Admin only. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const includeFikas = searchParams.get('include_fikas') === '1' || searchParams.get('include_fikas') === 'true'

  const supabaseAuth = await createServerSupabase()
  if (!supabaseAuth) {
    return NextResponse.json({ error: 'Not configured' }, { status: 500 })
  }
  const userId = await getUserIdFromRequest(request, supabaseAuth)
  if (!userId) {
    return NextResponse.json({ error: 'Not signed in', code: 'NO_SESSION' }, { status: 401 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) {
    return NextResponse.json({ error: 'Server not configured' }, { status: 500 })
  }
  const supabase = createClient(url, key)

  const isAdmin = await isAdminByUserId(supabase, userId)
  if (!isAdmin) {
    return NextResponse.json({ error: 'Admin role required', code: 'NOT_ADMIN' }, { status: 403 })
  }

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, first_name, city, market, lat, lng, created_at, gender, pronouns, birthdate')
    .not('lat', 'is', null)
    .not('lng', 'is', null)

  function ageFromBirthdate(birthdate: string | null | undefined): number | null {
    if (!birthdate || typeof birthdate !== 'string') return null
    const date = new Date(birthdate.trim())
    if (Number.isNaN(date.getTime())) return null
    const today = new Date()
    let age = today.getFullYear() - date.getFullYear()
    const monthDiff = today.getMonth() - date.getMonth()
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < date.getDate())) age--
    return age >= 0 ? age : null
  }

  const points = (profiles ?? []).map((p) => ({
    id: p.id,
    lat: p.lat as number,
    lng: p.lng as number,
    market: (p as { market?: string | null }).market ?? null,
    city: (p as { city?: string | null }).city ?? null,
    first_name: (p as { first_name?: string | null }).first_name ?? null,
    created_at: (p as { created_at?: string | null }).created_at ?? null,
    gender: (p as { gender?: string | null }).gender ?? null,
    pronouns: (p as { pronouns?: string | null }).pronouns ?? null,
    age: ageFromBirthdate((p as { birthdate?: string | null }).birthdate ?? null),
  }))

  const polygons = await getMarketPolygonsWithDb(supabase)

  const { data: markets } = await supabase
    .from('markets')
    .select('slug, label, active')
    .order('slug')

  const { data: venueCatalog } = await supabase
    .from('venues')
    .select('id, name, neighborhood, city, address, lat, lng, google_permanently_closed')
    .eq('google_permanently_closed', false)
    .not('lat', 'is', null)
    .not('lng', 'is', null)
    .order('name')

  const venues = (venueCatalog ?? []).map((v) => ({
    id: v.id as string,
    name: (v as { name?: string }).name ?? '',
    neighborhood: (v as { neighborhood?: string | null }).neighborhood ?? null,
    city: (v as { city?: string }).city ?? '',
    address: (v as { address?: string | null }).address ?? null,
    lat: Number((v as { lat?: unknown }).lat),
    lng: Number((v as { lng?: unknown }).lng),
  })).filter((v) => Number.isFinite(v.lat) && Number.isFinite(v.lng))

  if (!includeFikas) {
    return NextResponse.json({ points, polygons, markets: markets ?? [], fikas: [], venues })
  }

  const { data: matchRows } = await supabase
    .from('match_candidates')
    .select([
      'id',
      'user_a',
      'user_b',
      'status',
      'suggested_venue_id',
      'created_at',
    ].join(','))
    .not('suggested_venue_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(2000)

  const matchList = matchRows ?? []
  const venueIds = new Set<string>()
  const userIds = new Set<string>()
  for (const m of matchList as any[]) {
    const suggestedVenueId = (m.suggested_venue_id as string | null) ?? null
    if (suggestedVenueId) venueIds.add(suggestedVenueId)
    const a = m.user_a as string | null
    const b = m.user_b as string | null
    if (a) userIds.add(a)
    if (b) userIds.add(b)
  }

  const { data: fikaVenueRows } = venueIds.size
    ? await supabase
        .from('venues')
        .select('id, name, neighborhood, city, lat, lng')
        .in('id', Array.from(venueIds))
    : { data: [] as any[] }

  const venueById = new Map<string, any>()
  for (const v of (fikaVenueRows ?? []) as any[]) {
    venueById.set(v.id as string, v)
  }

  const { data: profilesForFikas } = userIds.size
    ? await supabase
        .from('profiles')
        .select('id, first_name, phone, city, market')
        .in('id', Array.from(userIds))
    : { data: [] as any[] }

  const profileById = new Map<string, any>()
  for (const p of (profilesForFikas ?? []) as any[]) {
    profileById.set(p.id as string, p)
  }

  const fikas: any[] = []
  for (const m of matchList as any[]) {
    const suggestedVenueId = (m.suggested_venue_id as string | null) ?? null
    if (!suggestedVenueId) continue

    const venue = venueById.get(suggestedVenueId)
    if (!venue || venue.lat == null || venue.lng == null) continue

    const userA = profileById.get(m.user_a as string) ?? null
    const userB = profileById.get(m.user_b as string) ?? null
    const market = (userA?.market as string | null) ?? (userB?.market as string | null) ?? null

    const lat = Number(venue.lat)
    const lng = Number(venue.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue

    fikas.push({
      matchId: m.id as string,
      category: 'fika' as const,
      lat,
      lng,
      venueName: (venue.name as string | null) ?? null,
      venueNeighborhood: (venue.neighborhood as string | null) ?? null,
      venueCity: (venue.city as string | null) ?? null,
      userA: userA
        ? { id: userA.id as string, firstName: (userA.first_name as string | null) ?? null, phone: (userA.phone as string | null) ?? null }
        : null,
      userB: userB
        ? { id: userB.id as string, firstName: (userB.first_name as string | null) ?? null, phone: (userB.phone as string | null) ?? null }
        : null,
      market,
    })
  }

  return NextResponse.json({ points, polygons, markets: markets ?? [], fikas, venues })
}
