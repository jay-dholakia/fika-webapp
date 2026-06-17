import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { isAdminByUserId } from '@/lib/admin-markets'

export const dynamic = 'force-dynamic'

async function getAdminUserId(request: Request): Promise<string | null> {
  const supabaseAuth = await createServerSupabase()
  if (!supabaseAuth) return null
  const { data: { session } } = await supabaseAuth.auth.getSession()
  if (session?.user?.id) return session.user.id
  const authHeader = request.headers.get('Authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7)
    const { data: { user } } = await supabaseAuth.auth.getUser(token)
    return user?.id ?? null
  }
  return null
}

type FikaStage = 'pending' | 'revealed' | 'expired' | 'cancelled' | 'unknown'

function deriveStage(row: {
  status: string | null
  cancel_retry_flow: boolean | null
  eventRevealed: boolean
}): FikaStage {
  if (row.cancel_retry_flow) return 'cancelled'
  if (row.eventRevealed) return 'revealed'
  if (row.status === 'expired') return 'expired'
  if (row.status === 'active') return 'pending'
  return 'unknown'
}

function pickNeedsAttentionReason(stage: FikaStage, hasEventId: boolean): string | null {
  if (stage === 'expired') return 'Expired before reveal'
  if (stage === 'pending' && !hasEventId) return 'No event linked'
  return null
}

/** GET /api/admin/fikas — event-based match lifecycle list. Admin only. */
export async function GET(request: Request) {
  const userId = await getAdminUserId(request)
  if (!userId) return NextResponse.json({ error: 'Not signed in', code: 'NO_SESSION' }, { status: 401 })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) return NextResponse.json({ error: 'Server not configured' }, { status: 500 })
  const supabase = createClient(url, key)

  const isAdmin = await isAdminByUserId(supabase, userId)
  if (!isAdmin) return NextResponse.json({ error: 'Admin role required', code: 'NOT_ADMIN' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const limit = Math.min(500, Math.max(20, Number(searchParams.get('limit') ?? '250') || 250))
  const market = (searchParams.get('market') ?? '').trim() || null
  const stage = (searchParams.get('stage') ?? '').trim() || null
  const q = (searchParams.get('q') ?? '').trim() || null
  const needsAttentionOnly = searchParams.get('needs_attention') === '1'

  const { data: matches, error: matchErr } = await supabase
    .from('match_candidates')
    .select('id, user_a, user_b, score, status, cancel_retry_flow, reasons, created_at, expires_at')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (matchErr) return NextResponse.json({ error: matchErr.message }, { status: 500 })

  const rows = (matches ?? []) as Array<Record<string, any>>

  // Extract event_ids from reasons JSONB
  const eventIds = Array.from(
    new Set(
      rows
        .map((r) => (r.reasons as Record<string, any> | null)?.event_id as string | undefined)
        .filter(Boolean) as string[]
    )
  )

  const userIds = Array.from(
    new Set(rows.flatMap((r) => [r.user_a as string, r.user_b as string]).filter(Boolean))
  )

  const [{ data: profiles }, { data: events }] = await Promise.all([
    supabase.from('profiles').select('id, first_name, phone, city, market').in('id', userIds),
    eventIds.length > 0
      ? supabase
          .from('weekly_fika_events')
          .select('id, market_slug, event_starts_at, venue_id, reveals_sent_at')
          .in('id', eventIds)
      : Promise.resolve({ data: [] as any[] }),
  ])

  // Fetch venues for events
  const venueIds = Array.from(
    new Set((events ?? []).map((e: any) => e.venue_id as string | null).filter(Boolean) as string[])
  )
  const { data: venues } = venueIds.length > 0
    ? await supabase.from('venues').select('id, name, neighborhood, city').in('id', venueIds)
    : { data: [] as any[] }

  const profileById = new Map<string, any>()
  for (const p of (profiles ?? []) as any[]) profileById.set(p.id, p)

  const eventById = new Map<string, any>()
  for (const e of (events ?? []) as any[]) eventById.set(e.id, e)

  const venueById = new Map<string, any>()
  for (const v of (venues ?? []) as any[]) venueById.set(v.id, v)

  const out = rows.map((r) => {
    const reasons = (r.reasons as Record<string, any> | null) ?? {}
    const eventId = (reasons.event_id as string | null) ?? null
    const event = eventId ? eventById.get(eventId) ?? null : null
    const venue = event?.venue_id ? venueById.get(event.venue_id) ?? null : null

    const stageDerived = deriveStage({
      status: r.status,
      cancel_retry_flow: r.cancel_retry_flow,
      eventRevealed: !!event?.reveals_sent_at,
    })

    const profA = profileById.get(r.user_a) ?? { id: r.user_a, first_name: null, phone: null, city: null, market: null }
    const profB = profileById.get(r.user_b) ?? { id: r.user_b, first_name: null, phone: null, city: null, market: null }

    return {
      id: r.id as string,
      createdAt: r.created_at as string | null,
      expiresAt: r.expires_at as string | null,
      status: r.status as string | null,
      stage: stageDerived,
      needsAttentionReason: pickNeedsAttentionReason(stageDerived, !!eventId),
      score: r.score != null ? Number(r.score) : null,
      event: event
        ? {
            id: event.id as string,
            marketSlug: event.market_slug as string,
            startsAt: event.event_starts_at as string,
            venueName: (venue?.name as string | null) ?? null,
            venueNeighborhood: (venue?.neighborhood as string | null) ?? null,
          }
        : null,
      userA: { id: profA.id, firstName: profA.first_name, phone: profA.phone, city: profA.city, market: profA.market },
      userB: { id: profB.id, firstName: profB.first_name, phone: profB.phone, city: profB.city, market: profB.market },
    }
  })

  const filtered = out.filter((r) => {
    if (market) {
      if (r.userA.market !== market && r.userB.market !== market && r.event?.marketSlug !== market) return false
    }
    if (stage && r.stage !== stage) return false
    if (needsAttentionOnly && !r.needsAttentionReason) return false
    if (q) {
      const hay = [
        r.id,
        r.userA.firstName,
        r.userB.firstName,
        r.userA.phone,
        r.userB.phone,
        r.userA.city,
        r.userB.city,
        r.userA.market,
        r.event?.marketSlug,
        r.event?.venueName,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      if (!hay.includes(q.toLowerCase())) return false
    }
    return true
  })

  return NextResponse.json({
    summary: { total: out.length, returned: filtered.length, limit, market, stage, needs_attention: needsAttentionOnly, q },
    fikas: filtered,
  })
}
