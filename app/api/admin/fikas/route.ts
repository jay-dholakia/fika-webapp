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

type FikaStage =
  | 'passed'
  | 'confirmed'
  | 'expired'
  | 'scheduling'
  | 'awaiting_opt_in'
  | 'awaiting_other_opt_in'
  | 'offered'
  | 'unknown'

function deriveStage(row: {
  status: string | null
  scheduling_status: string | null
  confirmed_slot_id: string | null
  confirmed_at: string | null
  optA: 'opt_in' | 'pass' | null
  optB: 'opt_in' | 'pass' | null
}): FikaStage {
  if (row.optA === 'pass' || row.optB === 'pass') return 'passed'
  if (row.scheduling_status === 'cancelled_pending_retry') return 'expired'
  if (row.scheduling_status === 'expired') return 'expired'
  if (row.scheduling_status === 'confirmed' || row.confirmed_slot_id || row.confirmed_at) return 'confirmed'
  if (row.scheduling_status && row.scheduling_status !== 'confirmed') return 'scheduling'
  if (row.status === 'active' || row.status == null) {
    if (row.optA === 'opt_in' && row.optB === 'opt_in') return 'scheduling'
    if (row.optA === 'opt_in' || row.optB === 'opt_in') return 'awaiting_other_opt_in'
    if (row.optA == null && row.optB == null) return 'awaiting_opt_in'
    return 'offered'
  }
  return 'unknown'
}

function pickNeedsAttentionReason(row: {
  stage: FikaStage
  created_at: string | null
  confirmed_at: string | null
  scheduling_status: string | null
  three_hour_reminder_sent_at: string | null
  post_fika_sent_at: string | null
}): string | null {
  if (row.stage === 'awaiting_opt_in' || row.stage === 'awaiting_other_opt_in') return 'Waiting on opt-in'
  if (row.stage === 'scheduling') return 'Scheduling in progress'
  if (row.stage === 'confirmed') {
    if (!row.three_hour_reminder_sent_at) return 'Reminder not sent'
    if (!row.post_fika_sent_at) return 'Post-Fika not sent'
  }
  return null
}

/** GET /api/admin/fikas — all-time match lifecycle list (match_candidates as source of truth). Admin only. */
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
    .select([
      'id',
      'user_a',
      'user_b',
      'score',
      'status',
      'scheduling_status',
      'week_anchor_monday',
      'created_at',
      'expires_at',
      'default_slot_id',
      'counter_slot_id',
      'final_slot_id',
      'confirmed_slot_id',
      'confirmed_at',
      'suggested_venue_id',
      'confirmed_venue_id',
      'three_hour_reminder_sent_at',
      'post_fika_sent_at',
    ].join(','))
    .order('created_at', { ascending: false })
    .limit(limit)

  if (matchErr) return NextResponse.json({ error: matchErr.message }, { status: 500 })

  const rows = (matches ?? []) as Array<Record<string, any>>
  const userIds = Array.from(
    new Set(rows.flatMap((r) => [r.user_a as string | null, r.user_b as string | null]).filter(Boolean) as string[])
  )
  const matchIds = rows.map((r) => r.id as string)
  const venueIds = Array.from(
    new Set(
      rows
        .flatMap((r) => [r.suggested_venue_id as string | null, r.confirmed_venue_id as string | null])
        .filter(Boolean) as string[]
    )
  )

  const [{ data: profiles }, { data: optIns }, { data: smsStates }, { data: venues }] = await Promise.all([
    supabase.from('profiles').select('id, first_name, phone, city, market').in('id', userIds),
    supabase.from('opt_ins').select('match_id, user_id, decision, answered_at, payment_status').in('match_id', matchIds),
    supabase
      .from('sms_conversation_states')
      .select('match_id, user_id, state, updated_at')
      .in('match_id', matchIds)
      .order('updated_at', { ascending: false }),
    venueIds.length > 0
      ? supabase.from('venues').select('id, name, neighborhood, city, address').in('id', venueIds)
      : Promise.resolve({ data: [] as any[] }),
  ])

  const profileById = new Map<string, { id: string; first_name: string | null; phone: string | null; city: string | null; market: string | null }>()
  for (const p of (profiles ?? []) as any[]) {
    profileById.set(p.id as string, {
      id: p.id as string,
      first_name: (p.first_name as string | null) ?? null,
      phone: (p.phone as string | null) ?? null,
      city: (p.city as string | null) ?? null,
      market: (p.market as string | null) ?? null,
    })
  }

  const optKey = (match_id: string, user_id: string) => `${match_id}:${user_id}`
  const optBy = new Map<string, { decision: 'opt_in' | 'pass' | null; answered_at: string | null; payment_status: string | null }>()
  for (const o of (optIns ?? []) as any[]) {
    const rawDecision = (o.decision as string | null)
    const decision =
      rawDecision === 'opt_in' || rawDecision === 'yes'
        ? 'opt_in'
        : rawDecision === 'pass' || rawDecision === 'no'
          ? 'pass'
          : null
    optBy.set(optKey(o.match_id as string, o.user_id as string), {
      decision,
      answered_at: (o.answered_at as string | null) ?? null,
      payment_status: (o.payment_status as string | null) ?? null,
    })
  }

  const smsBy = new Map<string, { state: string; updated_at: string | null }>()
  for (const s of (smsStates ?? []) as any[]) {
    const k = optKey(s.match_id as string, s.user_id as string)
    if (!smsBy.has(k)) {
      smsBy.set(k, { state: String(s.state ?? ''), updated_at: (s.updated_at as string | null) ?? null })
    }
  }

  const venueById = new Map<string, { id: string; name: string; neighborhood: string | null; city: string; address: string | null }>()
  for (const v of (venues ?? []) as any[]) {
    venueById.set(v.id as string, {
      id: v.id as string,
      name: String(v.name ?? ''),
      neighborhood: (v.neighborhood as string | null) ?? null,
      city: String(v.city ?? ''),
      address: (v.address as string | null) ?? null,
    })
  }

  const out = rows.map((r) => {
    const userA = profileById.get(r.user_a as string) ?? { id: r.user_a as string, first_name: null, phone: null, city: null, market: null }
    const userB = profileById.get(r.user_b as string) ?? { id: r.user_b as string, first_name: null, phone: null, city: null, market: null }
    const optA = optBy.get(optKey(r.id as string, r.user_a as string)) ?? { decision: null, answered_at: null, payment_status: null }
    const optB = optBy.get(optKey(r.id as string, r.user_b as string)) ?? { decision: null, answered_at: null, payment_status: null }
    const smsA = smsBy.get(optKey(r.id as string, r.user_a as string)) ?? null
    const smsB = smsBy.get(optKey(r.id as string, r.user_b as string)) ?? null
    const suggestedVenue = r.suggested_venue_id ? venueById.get(r.suggested_venue_id as string) ?? null : null
    const confirmedVenue = r.confirmed_venue_id ? venueById.get(r.confirmed_venue_id as string) ?? null : null

    const stageDerived = deriveStage({
      status: (r.status as string | null) ?? null,
      scheduling_status: (r.scheduling_status as string | null) ?? null,
      confirmed_slot_id: (r.confirmed_slot_id as string | null) ?? null,
      confirmed_at: (r.confirmed_at as string | null) ?? null,
      optA: optA.decision,
      optB: optB.decision,
    })

    const needsAttentionReason = pickNeedsAttentionReason({
      stage: stageDerived,
      created_at: (r.created_at as string | null) ?? null,
      confirmed_at: (r.confirmed_at as string | null) ?? null,
      scheduling_status: (r.scheduling_status as string | null) ?? null,
      three_hour_reminder_sent_at: (r.three_hour_reminder_sent_at as string | null) ?? null,
      post_fika_sent_at: (r.post_fika_sent_at as string | null) ?? null,
    })

    return {
      id: r.id as string,
      weekAnchorMonday: (r.week_anchor_monday as string | null) ?? null,
      createdAt: (r.created_at as string | null) ?? null,
      expiresAt: (r.expires_at as string | null) ?? null,
      status: (r.status as string | null) ?? null,
      schedulingStatus: (r.scheduling_status as string | null) ?? null,
      stage: stageDerived,
      needsAttentionReason,
      score: r.score != null ? Number(r.score) : null,
      slots: {
        default: (r.default_slot_id as string | null) ?? null,
        counter: (r.counter_slot_id as string | null) ?? null,
        final: (r.final_slot_id as string | null) ?? null,
        confirmed: (r.confirmed_slot_id as string | null) ?? null,
      },
      confirmedAt: (r.confirmed_at as string | null) ?? null,
      reminders: {
        threeHourSentAt: (r.three_hour_reminder_sent_at as string | null) ?? null,
        postFikaSentAt: (r.post_fika_sent_at as string | null) ?? null,
      },
      venue: {
        suggested: suggestedVenue,
        confirmed: confirmedVenue,
      },
      userA: {
        id: userA.id,
        firstName: userA.first_name,
        phone: userA.phone,
        city: userA.city,
        market: userA.market,
        optIn: optA,
        sms: smsA,
      },
      userB: {
        id: userB.id,
        firstName: userB.first_name,
        phone: userB.phone,
        city: userB.city,
        market: userB.market,
        optIn: optB,
        sms: smsB,
      },
    }
  })

  const filtered = out.filter((r) => {
    if (market) {
      const mA = r.userA.market ?? ''
      const mB = r.userB.market ?? ''
      if (mA !== market && mB !== market) return false
    }
    if (stage) {
      if (r.stage !== stage) return false
    }
    if (needsAttentionOnly) {
      if (!r.needsAttentionReason) return false
    }
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
        r.userB.market,
        r.venue.confirmed?.name,
        r.venue.suggested?.name,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      if (!hay.includes(q.toLowerCase())) return false
    }
    return true
  })

  return NextResponse.json({
    summary: {
      total: out.length,
      returned: filtered.length,
      limit,
      market,
      stage,
      needs_attention: needsAttentionOnly,
      q,
    },
    fikas: filtered,
  })
}

