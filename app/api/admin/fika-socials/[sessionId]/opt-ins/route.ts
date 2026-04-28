import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { isAdminByUserId } from '@/lib/admin-markets'
import { haversineMiles } from '@/lib/fika-social-geo'

export const dynamic = 'force-dynamic'

async function getAdminContext(request: Request): Promise<{ userId: string; supabase: SupabaseClient } | null> {
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
  return { userId, supabase }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim())
}

/**
 * GET /api/admin/fika-socials/[sessionId]/opt-ins
 * Returns a readable list of opt-ins for the session.
 */
export async function GET(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const context = await getAdminContext(request)
    if (!context) return NextResponse.json({ error: 'Admin role required', code: 'NOT_ADMIN' }, { status: 403 })

    const { sessionId } = await params
    if (!sessionId || !isUuid(sessionId)) {
      return NextResponse.json({ error: 'Invalid session id' }, { status: 400 })
    }

    const { data: session, error: sErr } = await context.supabase
      .from('fika_socials')
      .select('id, market_slug, venue_id, radius_miles')
      .eq('id', sessionId)
      .maybeSingle()
    if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 })
    if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const { data: venue, error: vErr } = await context.supabase
      .from('venues')
      .select('id, lat, lng')
      .eq('id', session.venue_id as string)
      .maybeSingle()
    if (vErr) return NextResponse.json({ error: vErr.message }, { status: 500 })
    const vLat = Number(venue?.lat)
    const vLng = Number(venue?.lng)
    if (!venue || !Number.isFinite(vLat) || !Number.isFinite(vLng)) {
      return NextResponse.json({ error: 'Venue missing coordinates' }, { status: 400 })
    }

    const { data: optIns, error: oErr } = await context.supabase
      .from('fika_social_opt_ins')
      .select('user_id, created_at')
      .eq('session_id', sessionId)
      .is('withdrawn_at', null)
      .order('created_at', { ascending: true })
    if (oErr) return NextResponse.json({ error: oErr.message }, { status: 500 })

    const userIds = Array.from(new Set((optIns ?? []).map((r) => r.user_id as string).filter(Boolean)))
    if (userIds.length === 0) return NextResponse.json({ opt_ins: [] })

    const { data: profiles, error: pErr } = await context.supabase
      .from('profiles')
      .select('id, first_name, last_name, city, market, lat, lng, is_active')
      .in('id', userIds)
    if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 })

    const byId = new Map((profiles ?? []).map((p) => [p.id as string, p]))

    const optInsByUser = new Map((optIns ?? []).map((o) => [o.user_id as string, o]))
    const rows = userIds
      .map((uid) => {
        const p = byId.get(uid) as
          | { id: string; first_name: string | null; last_name: string | null; city: string | null; market: string | null; lat: unknown; lng: unknown; is_active: boolean | null }
          | undefined
        if (!p) return null
        const lat = Number(p.lat)
        const lng = Number(p.lng)
        const distance_miles = Number.isFinite(lat) && Number.isFinite(lng) ? haversineMiles(lat, lng, vLat, vLng) : null
        return {
          user_id: uid,
          first_name: p.first_name,
          last_name: p.last_name,
          city: p.city,
          market: p.market,
          is_active: p.is_active,
          distance_miles,
          opted_in_at: optInsByUser.get(uid)?.created_at ?? null,
        }
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x))
      .sort((a, b) => (a.distance_miles ?? 1e9) - (b.distance_miles ?? 1e9))

    return NextResponse.json({ opt_ins: rows })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to load opt-ins' },
      { status: 500 }
    )
  }
}

