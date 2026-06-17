import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { isAdminByUserId } from '@/lib/admin-markets'

export const dynamic = 'force-dynamic'

async function getAdminSupabase(request: Request): Promise<SupabaseClient | null> {
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
  return supabase
}

/** GET /api/admin/weekly-events — list upcoming + recent events */
export async function GET(request: Request) {
  try {
    const supabase = await getAdminSupabase(request)
    if (!supabase) return NextResponse.json({ error: 'Admin role required', code: 'NOT_ADMIN' }, { status: 403 })

    const { data: events, error } = await supabase
      .from('weekly_fika_events')
      .select(`
        id, market_slug, week_ymd, event_starts_at, reveals_sent_at,
        max_invites, max_capacity, opt_in_deadline_hours,
        venue_id, radius_miles, gender_filter, min_age, max_age, created_at,
        venues(id, name, neighborhood, city)
      `)
      .order('created_at', { ascending: false })
      .limit(30)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ events: events ?? [] })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

/** POST /api/admin/weekly-events — create a weekly fika event */
export async function POST(request: Request) {
  try {
    const supabase = await getAdminSupabase(request)
    if (!supabase) return NextResponse.json({ error: 'Admin role required', code: 'NOT_ADMIN' }, { status: 403 })

    const body = await request.json().catch(() => ({}))
    const {
      market_slug, event_starts_at, venue_id,
      radius_miles, gender_filter, min_age, max_age,
      max_invites, max_capacity, opt_in_deadline_hours,
    } = body as Record<string, unknown>

    if (typeof market_slug !== 'string' || !market_slug.trim()) {
      return NextResponse.json({ error: 'market_slug is required' }, { status: 400 })
    }
    if (typeof event_starts_at !== 'string' || !event_starts_at.trim()) {
      return NextResponse.json({ error: 'event_starts_at is required' }, { status: 400 })
    }

    const startsAt = new Date(event_starts_at)
    if (isNaN(startsAt.getTime())) {
      return NextResponse.json({ error: 'event_starts_at must be a valid ISO datetime' }, { status: 400 })
    }

    // Derive week_ymd from event_starts_at for legacy queries
    const weekYmd = startsAt.toISOString().slice(0, 10)

    const radiusMilesVal = typeof radius_miles === 'number' && radius_miles > 0 ? radius_miles : null
    const genderFilterVal = Array.isArray(gender_filter) && gender_filter.length > 0
      ? (gender_filter as string[]).filter(Boolean)
      : null
    const minAgeVal = typeof min_age === 'number' && min_age > 0 ? Math.floor(min_age) : null
    const maxAgeVal = typeof max_age === 'number' && max_age > 0 ? Math.floor(max_age) : null
    const maxInvitesVal = typeof max_invites === 'number' && max_invites > 0 ? Math.floor(max_invites) : null
    const maxCapacityVal = typeof max_capacity === 'number' && max_capacity > 0 ? Math.floor(max_capacity) : null
    const deadlineHoursVal = typeof opt_in_deadline_hours === 'number' && opt_in_deadline_hours > 0
      ? Math.floor(opt_in_deadline_hours) : 24

    const { data: event, error } = await supabase
      .from('weekly_fika_events')
      .insert({
        market_slug: market_slug.trim(),
        week_ymd: weekYmd,
        event_starts_at: startsAt.toISOString(),
        venue_id: typeof venue_id === 'string' && venue_id.trim() ? venue_id.trim() : null,
        radius_miles: radiusMilesVal,
        gender_filter: genderFilterVal,
        min_age: minAgeVal,
        max_age: maxAgeVal,
        max_invites: maxInvitesVal,
        max_capacity: maxCapacityVal,
        opt_in_deadline_hours: deadlineHoursVal,
      })
      .select('id, market_slug, week_ymd, event_starts_at, venue_id, max_invites, max_capacity, opt_in_deadline_hours')
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ event })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
