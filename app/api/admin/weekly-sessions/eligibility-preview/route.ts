import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { isAdminByUserId } from '@/lib/admin-markets'
import { haversineMiles } from '@/lib/weekly-fika-geo'

export const dynamic = 'force-dynamic'

async function getAdminContext(request: Request): Promise<{ supabase: SupabaseClient } | null> {
  const supabaseAuth = await createServerSupabase()
  if (!supabaseAuth) return null

  let userId: string | null = null
  const { data: { session } } = await supabaseAuth.auth.getSession()
  if (session?.user?.id) userId = session.user.id
  if (!userId) {
    const authHeader = request.headers.get('Authorization')
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7)
      const { data: { user } } = await supabaseAuth.auth.getUser(token)
      if (user?.id) userId = user.id
    }
  }
  if (!userId) return null

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) throw new Error('Server not configured')
  const supabase = createClient(url, key)

  const admin = await isAdminByUserId(supabase, userId)
  if (!admin) return null
  return { supabase }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim())
}

/**
 * GET /api/admin/weekly-sessions/eligibility-preview
 * ?market_slug=&venue_id=&radius_miles=
 * Counts active profiles in the market with lat/lng within radius of the venue.
 */
export async function GET(request: Request) {
  try {
    const context = await getAdminContext(request)
    if (!context) return NextResponse.json({ error: 'Admin role required', code: 'NOT_ADMIN' }, { status: 403 })

    const { searchParams } = new URL(request.url)
    const marketSlug = searchParams.get('market_slug')?.trim() ?? ''
    const venueId = searchParams.get('venue_id')?.trim() ?? ''
    const radiusRaw = searchParams.get('radius_miles')
    const radiusMiles = radiusRaw != null && radiusRaw !== '' ? Number(radiusRaw) : 4

    if (!marketSlug) return NextResponse.json({ error: 'market_slug is required' }, { status: 400 })
    if (!venueId || !isUuid(venueId)) return NextResponse.json({ error: 'venue_id (uuid) is required' }, { status: 400 })
    if (!Number.isFinite(radiusMiles) || radiusMiles <= 0 || radiusMiles > 100) {
      return NextResponse.json({ error: 'radius_miles must be between 0 and 100' }, { status: 400 })
    }

    const { data: venue, error: vErr } = await context.supabase
      .from('venues')
      .select('id, lat, lng, name, city')
      .eq('id', venueId)
      .maybeSingle()

    if (vErr) return NextResponse.json({ error: vErr.message }, { status: 500 })
    if (!venue) return NextResponse.json({ error: 'Unknown venue_id' }, { status: 400 })

    const vLat = Number(venue.lat)
    const vLng = Number(venue.lng)
    if (!Number.isFinite(vLat) || !Number.isFinite(vLng)) {
      return NextResponse.json({ error: 'Venue must have lat/lng', count: 0 }, { status: 400 })
    }

    const { data: profiles, error: pErr } = await context.supabase
      .from('profiles')
      .select('id, lat, lng')
      .eq('market', marketSlug)
      .eq('is_active', true)
      .not('lat', 'is', null)
      .not('lng', 'is', null)

    if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 })

    let count = 0
    for (const p of profiles ?? []) {
      const lat = Number((p as { lat?: unknown }).lat)
      const lng = Number((p as { lng?: unknown }).lng)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
      if (haversineMiles(lat, lng, vLat, vLng) <= radiusMiles) count++
    }

    return NextResponse.json({
      count,
      market_slug: marketSlug,
      venue_id: venueId,
      radius_miles: radiusMiles,
      venue: { name: venue.name, city: venue.city },
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to preview eligibility' },
      { status: 500 }
    )
  }
}
