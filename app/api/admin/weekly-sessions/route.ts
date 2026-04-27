import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { isAdminByUserId } from '@/lib/admin-markets'
import { isWeeklyFikaSessionStatus } from '@/lib/weekly-fika-session'

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

function isYmd(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value.trim())
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim())
}

/** GET /api/admin/weekly-sessions — list sessions (optional market_slug, status). */
export async function GET(request: Request) {
  try {
    const context = await getAdminContext(request)
    if (!context) return NextResponse.json({ error: 'Admin role required', code: 'NOT_ADMIN' }, { status: 403 })

    const { searchParams } = new URL(request.url)
    const marketSlug = searchParams.get('market_slug')?.trim() || null
    const status = searchParams.get('status')?.trim() || null
    const limit = Math.min(200, Math.max(10, Number(searchParams.get('limit') ?? '80') || 80))

    let q = context.supabase
      .from('weekly_fika_sessions')
      .select('*')
      .order('week_anchor_monday', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit)

    if (marketSlug) q = q.eq('market_slug', marketSlug)
    if (status && isWeeklyFikaSessionStatus(status)) q = q.eq('status', status)

    const { data, error } = await q
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ sessions: data ?? [], summary: { limit, market_slug: marketSlug, status } })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to list sessions' },
      { status: 500 }
    )
  }
}

/** POST /api/admin/weekly-sessions — create draft session. */
export async function POST(request: Request) {
  try {
    const context = await getAdminContext(request)
    if (!context) return NextResponse.json({ error: 'Admin role required', code: 'NOT_ADMIN' }, { status: 403 })

    const body = await request.json().catch(() => ({} as Record<string, unknown>))
    const marketSlug = typeof body.market_slug === 'string' ? body.market_slug.trim() : ''
    const venueId = typeof body.venue_id === 'string' ? body.venue_id.trim() : ''
    const weekAnchorMonday = typeof body.week_anchor_monday === 'string' ? body.week_anchor_monday.trim() : ''
    const fikaStartsAt = typeof body.fika_starts_at === 'string' ? body.fika_starts_at.trim() : ''

    if (!marketSlug) return NextResponse.json({ error: 'market_slug is required' }, { status: 400 })
    if (!venueId || !isUuid(venueId)) return NextResponse.json({ error: 'venue_id (uuid) is required' }, { status: 400 })
    if (!weekAnchorMonday || !isYmd(weekAnchorMonday)) {
      return NextResponse.json({ error: 'week_anchor_monday (YYYY-MM-DD) is required' }, { status: 400 })
    }
    if (!fikaStartsAt) return NextResponse.json({ error: 'fika_starts_at (ISO) is required' }, { status: 400 })

    const { data: market, error: mErr } = await context.supabase
      .from('markets')
      .select('slug')
      .eq('slug', marketSlug)
      .maybeSingle()
    if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 })
    if (!market) return NextResponse.json({ error: 'Unknown market_slug' }, { status: 400 })

    const { data: venue, error: vErr } = await context.supabase
      .from('venues')
      .select('id, lat, lng')
      .eq('id', venueId)
      .maybeSingle()
    if (vErr) return NextResponse.json({ error: vErr.message }, { status: 500 })
    if (!venue) return NextResponse.json({ error: 'Unknown venue_id' }, { status: 400 })
    if (venue.lat == null || venue.lng == null) {
      return NextResponse.json({ error: 'Venue must have lat/lng before creating a session.' }, { status: 400 })
    }

    const radiusMiles =
      typeof body.radius_miles === 'number' && Number.isFinite(body.radius_miles)
        ? Math.min(100, Math.max(0.5, body.radius_miles))
        : undefined

    const ianaTz = typeof body.iana_tz === 'string' && body.iana_tz.trim() ? body.iana_tz.trim() : 'America/Los_Angeles'

    const { data: mktDefaults, error: mdErr } = await context.supabase
      .from('markets')
      .select('weekly_default_radius_miles')
      .eq('slug', marketSlug)
      .maybeSingle()

    if (mdErr) return NextResponse.json({ error: mdErr.message }, { status: 500 })

    const defaultRadius = Number((mktDefaults as { weekly_default_radius_miles?: number } | null)?.weekly_default_radius_miles)
    const resolvedRadius = radiusMiles ?? (Number.isFinite(defaultRadius) ? defaultRadius : 4)

    const insertRow = {
      market_slug: marketSlug,
      venue_id: venueId,
      week_anchor_monday: weekAnchorMonday,
      fika_starts_at: fikaStartsAt,
      radius_miles: resolvedRadius,
      iana_tz: ianaTz,
      status: 'draft' as const,
    }

    const { data: row, error: insErr } = await context.supabase
      .from('weekly_fika_sessions')
      .insert(insertRow)
      .select('*')
      .single()

    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })
    return NextResponse.json({ ok: true, session: row })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to create session' },
      { status: 500 }
    )
  }
}
