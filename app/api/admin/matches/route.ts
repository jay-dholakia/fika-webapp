import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { isAdminByUserId } from '@/lib/admin-markets'
import { invokeSmsMatchDelivery } from '@/lib/invoke-sms-match-delivery'

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

type PairInput = {
  user_a: string
  user_b: string
  signals?: string[]
  user_a_work?: string | null
  user_b_work?: string | null
}

/** POST /api/admin/matches — create 1v1 match_candidates rows and fire intro SMS */
export async function POST(request: Request) {
  try {
    const supabase = await getAdminSupabase(request)
    if (!supabase) return NextResponse.json({ error: 'Admin role required', code: 'NOT_ADMIN' }, { status: 403 })

    const body = await request.json().catch(() => ({} as Record<string, unknown>))

    const pairs: PairInput[] = Array.isArray(body.pairs)
      ? (body.pairs as unknown[]).filter(
          (p): p is PairInput =>
            typeof p === 'object' && p !== null &&
            typeof (p as PairInput).user_a === 'string' &&
            typeof (p as PairInput).user_b === 'string'
        )
      : []

    if (pairs.length === 0) {
      return NextResponse.json({ error: 'pairs is required and must be a non-empty array' }, { status: 400 })
    }

    const venueId = typeof body.venue_id === 'string' ? body.venue_id.trim() || null : null
    const eventStartsAt = typeof body.event_starts_at === 'string' ? body.event_starts_at.trim() || null : null
    const areaLabel = typeof body.area_label === 'string' ? body.area_label.trim() : ''

    if (eventStartsAt && isNaN(Date.parse(eventStartsAt))) {
      return NextResponse.json({ error: 'event_starts_at is not a valid ISO date' }, { status: 400 })
    }

    // Check both users in every pair for active flows before inserting anything
    const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const allUserIds = Array.from(new Set(pairs.flatMap(p => [p.user_a.trim(), p.user_b.trim()])))

    const [{ data: globalRows }, { data: perMatchRows }, { data: cooldownRows }] = await Promise.all([
      supabase.from('sms_conversation_states').select('user_id, state')
        .in('user_id', allUserIds).is('match_id', null)
        .not('state', 'eq', 'global_ready'),
      supabase.from('sms_conversation_states').select('user_id')
        .in('user_id', allUserIds).not('match_id', 'is', null)
        .in('state', ['1v1_offered', '1v1_accepted', '1v1_awaiting_availability', '1v1_proposed', '1v1_confirmed', '1v1_morning_reminder'])
        .gte('updated_at', cutoff24h),
      supabase.from('profiles').select('id')
        .in('id', allUserIds).gt('last_fika_at', cutoff24h),
    ])

    const busyUsers = new Set<string>([
      ...(globalRows ?? []).map((r: { user_id: string }) => r.user_id),
      ...(perMatchRows ?? []).map((r: { user_id: string }) => r.user_id),
      ...(cooldownRows ?? []).map((r: { id: string }) => r.id),
    ])

    const eligiblePairs = pairs.filter(p => !busyUsers.has(p.user_a.trim()) && !busyUsers.has(p.user_b.trim()))
    const skippedPairs = pairs.filter(p => busyUsers.has(p.user_a.trim()) || busyUsers.has(p.user_b.trim()))

    if (eligiblePairs.length === 0) {
      return NextResponse.json({
        ok: true,
        sent: 0,
        matchIds: [],
        skipped: skippedPairs.map(p => ({ user_a: p.user_a, user_b: p.user_b, reason: 'user already in active flow' })),
      })
    }

    const insertRows = eligiblePairs.map(pair => ({
      user_a: pair.user_a.trim(),
      user_b: pair.user_b.trim(),
      status: 'active',
      admin_approval_status: 'approved',
      reasons: {
        source: '1v1',
        ...(venueId ? { venue_id: venueId } : {}),
        ...(eventStartsAt ? { event_starts_at: eventStartsAt } : {}),
        ...(areaLabel ? { area_label: areaLabel } : {}),
        signals: Array.isArray(pair.signals) ? pair.signals.filter(s => typeof s === 'string') : [],
        user_a_work: pair.user_a_work ?? null,
        user_b_work: pair.user_b_work ?? null,
      },
    }))

    const { data: inserted, error: insertErr } = await supabase
      .from('match_candidates')
      .insert(insertRows)
      .select('id')

    if (insertErr || !inserted?.length) {
      return NextResponse.json({ error: insertErr?.message ?? 'Insert failed' }, { status: 500 })
    }

    const matchIds = inserted.map((r: { id: string }) => r.id)

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? ''
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? ''

    const result = await invokeSmsMatchDelivery({ supabaseUrl, serviceRoleKey, matchIds })

    if (!result.ok) {
      return NextResponse.json(
        { error: 'Matches created but SMS delivery failed', detail: result.text, matchIds },
        { status: 500 }
      )
    }

    return NextResponse.json({
      ok: true,
      sent: matchIds.length,
      matchIds,
      skipped: skippedPairs.map(p => ({ user_a: p.user_a, user_b: p.user_b, reason: 'user already in active flow' })),
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to create matches' },
      { status: 500 }
    )
  }
}
