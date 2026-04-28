import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { isAdminByUserId } from '@/lib/admin-markets'
import { runFikaSocialMatcher, type FikaSocialSessionRow } from '@/lib/fika-social-matcher'
import { assertFikaStartsAfter, computeSocialFikaCadenceInstants } from '@/lib/weekly-fika-cadence'
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

function isYmd(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value.trim())
}

/** GET /api/admin/fika-socials/[sessionId] — session + venue + match queue summary. */
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
      .select('*')
      .eq('id', sessionId)
      .maybeSingle()

    if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 })
    if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const [{ data: venue }, { count: optInCount }, { data: matches }] = await Promise.all([
      context.supabase
        .from('venues')
        .select('id, name, neighborhood, city, address, lat, lng')
        .eq('id', session.venue_id as string)
        .maybeSingle(),
      context.supabase
        .from('fika_social_opt_ins')
        .select('id', { count: 'exact', head: true })
        .eq('session_id', sessionId),
      context.supabase
        .from('match_candidates')
        .select('id, user_a, user_b, admin_approval_status, score, created_at, fika_social_intro_sms_sent_at')
        .eq('fika_social_id', sessionId)
        .order('created_at', { ascending: true }),
    ])

    return NextResponse.json({
      session,
      venue: venue ?? null,
      counts: { opt_ins: optInCount ?? 0, matches: (matches ?? []).length },
      matches: matches ?? [],
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to load session' },
      { status: 500 }
    )
  }
}

/** PATCH — update draft fields and/or lifecycle actions. */
export async function PATCH(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const context = await getAdminContext(request)
    if (!context) return NextResponse.json({ error: 'Admin role required', code: 'NOT_ADMIN' }, { status: 403 })

    const { sessionId } = await params
    if (!sessionId || !isUuid(sessionId)) {
      return NextResponse.json({ error: 'Invalid session id' }, { status: 400 })
    }

    const { data: session, error: sErr } = await context.supabase
      .from('fika_socials')
      .select('*')
      .eq('id', sessionId)
      .maybeSingle()

    if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 })
    if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const body = await request.json().catch(() => ({} as Record<string, unknown>))
    const action = typeof body.action === 'string' ? body.action.trim() : ''

    if (action) {
      return handleAction(context.supabase, session as FikaSocialSessionRow & Record<string, unknown>, sessionId, action, body)
    }

    if ((session as { status?: string }).status !== 'draft') {
      return NextResponse.json({ error: 'Only draft sessions can be edited in place.' }, { status: 400 })
    }

    const patch: Record<string, unknown> = {}
    if (typeof body.market_slug === 'string' && body.market_slug.trim()) patch.market_slug = body.market_slug.trim()
    if (typeof body.venue_id === 'string' && isUuid(body.venue_id.trim())) patch.venue_id = body.venue_id.trim()
    if (typeof body.week_anchor_monday === 'string' && isYmd(body.week_anchor_monday)) {
      patch.week_anchor_monday = body.week_anchor_monday.trim()
    }
    if (typeof body.fika_starts_at === 'string' && body.fika_starts_at.trim()) patch.fika_starts_at = body.fika_starts_at.trim()
    if (typeof body.iana_tz === 'string' && body.iana_tz.trim()) patch.iana_tz = body.iana_tz.trim()
    if (typeof body.radius_miles === 'number' && Number.isFinite(body.radius_miles)) {
      patch.radius_miles = Math.min(100, Math.max(0.5, body.radius_miles))
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    if (patch.venue_id) {
      const { data: venue, error: vErr } = await context.supabase
        .from('venues')
        .select('id, lat, lng')
        .eq('id', patch.venue_id as string)
        .maybeSingle()
      if (vErr) return NextResponse.json({ error: vErr.message }, { status: 500 })
      if (!venue || venue.lat == null || venue.lng == null) {
        return NextResponse.json({ error: 'Venue must have lat/lng.' }, { status: 400 })
      }
    }

    if (patch.market_slug) {
      const { data: market, error: mErr } = await context.supabase
        .from('markets')
        .select('slug')
        .eq('slug', patch.market_slug as string)
        .maybeSingle()
      if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 })
      if (!market) return NextResponse.json({ error: 'Unknown market_slug' }, { status: 400 })
    }

    const { data: updated, error: uErr } = await context.supabase
      .from('fika_socials')
      .update(patch)
      .eq('id', sessionId)
      .select('*')
      .single()

    if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 })
    return NextResponse.json({ ok: true, session: updated })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to update session' },
      { status: 500 }
    )
  }
}

async function handleAction(
  supabase: SupabaseClient,
  session: FikaSocialSessionRow & Record<string, unknown>,
  sessionId: string,
  action: string,
  body: Record<string, unknown>
) {
  const status = session.status as string

  if (action === 'publish') {
    if (status !== 'draft') {
      return NextResponse.json({ error: 'publish is only valid from draft' }, { status: 400 })
    }
    const optInClosesAt = typeof body.opt_in_closes_at === 'string' ? body.opt_in_closes_at.trim() : ''
    if (!optInClosesAt) {
      return NextResponse.json({ error: 'opt_in_closes_at (ISO) is required to publish' }, { status: 400 })
    }

    const fikaStartsAtIso = String(session.fika_starts_at ?? '').trim()
    const lead = assertFikaStartsAfter(fikaStartsAtIso, Date.now())
    if (!lead.ok) {
      const cadence = computeSocialFikaCadenceInstants(fikaStartsAtIso)
      return NextResponse.json(
        {
          error:
            'Fika social is scheduled too soon. Social Fika requires enough lead time for the 48h invite, 24h opt-in window, and match send 6h before.',
          code: 'FIKA_SOCIAL_TOO_SOON',
          cadence,
        },
        { status: 400 }
      )
    }

    const cadence = computeSocialFikaCadenceInstants(fikaStartsAtIso)
    const closeMs = Date.parse(optInClosesAt)
    const matchMs = Date.parse(cadence.matchSendDueAt)
    if (!Number.isFinite(closeMs)) {
      return NextResponse.json({ error: 'Invalid opt_in_closes_at', code: 'INVALID_OPT_IN_CLOSE' }, { status: 400 })
    }
    if (closeMs > matchMs) {
      return NextResponse.json(
        {
          error: 'opt_in_closes_at must be at or before the match send milestone (T−6h).',
          code: 'OPT_IN_CLOSE_TOO_LATE',
          cadence,
        },
        { status: 400 }
      )
    }
    const { data: updated, error } = await supabase
      .from('fika_socials')
      .update({
        status: 'open_opt_in',
        opt_in_closes_at: optInClosesAt,
      })
      .eq('id', sessionId)
      .select('*')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, session: updated })
  }

  if (action === 'close_opt_in') {
    if (status !== 'open_opt_in') {
      return NextResponse.json({ error: 'close_opt_in is only valid from open_opt_in' }, { status: 400 })
    }
    const now = new Date().toISOString()
    const { data: updated, error } = await supabase
      .from('fika_socials')
      .update({
        status: 'opt_in_closed',
        opt_in_closed_at: now,
      })
      .eq('id', sessionId)
      .select('*')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, session: updated })
  }

  if (action === 'run_matcher') {
    if (status !== 'opt_in_closed') {
      return NextResponse.json({ error: 'run_matcher is only valid from opt_in_closed' }, { status: 400 })
    }
    if (session.match_run_at) {
      return NextResponse.json({ error: 'Matcher already ran for this session' }, { status: 409 })
    }

    const row: FikaSocialSessionRow = {
      id: sessionId,
      market_slug: session.market_slug as string,
      venue_id: session.venue_id as string,
      week_anchor_monday: session.week_anchor_monday as string,
      radius_miles: Number(session.radius_miles),
      iana_tz: (session.iana_tz as string) || 'America/Los_Angeles',
      fika_starts_at: session.fika_starts_at as string,
      status: session.status as string,
    }

    const result = await runFikaSocialMatcher(supabase, row)
    if (!result.ok) {
      return NextResponse.json({ error: result.error, code: result.code }, { status: 400 })
    }

    const now = new Date().toISOString()
    const { data: updated, error: uErr } = await supabase
      .from('fika_socials')
      .update({
        status: 'matching_pending_review',
        match_run_at: now,
      })
      .eq('id', sessionId)
      .select('*')
      .single()

    if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 })

    return NextResponse.json({
      ok: true,
      session: updated,
      matcher: {
        createdMatchIds: result.createdMatchIds,
        skippedIneligiblePairs: result.skippedIneligiblePairs,
        eligibleOptIns: result.eligibleOptIns,
        notes: result.notes,
      },
    })
  }

  if (action === 'approve_match' || action === 'reject_match') {
    if (status !== 'matching_pending_review') {
      return NextResponse.json({ error: 'Match approval is only valid from matching_pending_review' }, { status: 400 })
    }
    const matchId = typeof body.match_id === 'string' ? body.match_id.trim() : ''
    if (!matchId || !isUuid(matchId)) {
      return NextResponse.json({ error: 'match_id (uuid) is required' }, { status: 400 })
    }

    const { data: mc, error: mcErr } = await supabase
      .from('match_candidates')
      .select('id, fika_social_id')
      .eq('id', matchId)
      .maybeSingle()

    if (mcErr) return NextResponse.json({ error: mcErr.message }, { status: 500 })
    if (!mc || mc.fika_social_id !== sessionId) {
      return NextResponse.json({ error: 'Match not found for this session' }, { status: 404 })
    }

    const approval = action === 'approve_match' ? 'approved' : 'rejected'
    const now = new Date().toISOString()
    const { error: upErr } = await supabase
      .from('match_candidates')
      .update({ admin_approval_status: approval, admin_approval_at: now })
      .eq('id', matchId)

    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })
    return NextResponse.json({ ok: true, match_id: matchId, admin_approval_status: approval })
  }

  if (action === 'approve_all_matches') {
    if (status !== 'matching_pending_review') {
      return NextResponse.json({ error: 'approve_all_matches is only valid from matching_pending_review' }, { status: 400 })
    }
    const now = new Date().toISOString()
    const { error: upErr } = await supabase
      .from('match_candidates')
      .update({ admin_approval_status: 'approved', admin_approval_at: now })
      .eq('fika_social_id', sessionId)
      .eq('admin_approval_status', 'pending')

    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (action === 'mark_intro_ready') {
    if (status !== 'matching_pending_review') {
      return NextResponse.json({ error: 'mark_intro_ready is only valid from matching_pending_review' }, { status: 400 })
    }
    const { count, error: cErr } = await supabase
      .from('match_candidates')
      .select('id', { count: 'exact', head: true })
      .eq('fika_social_id', sessionId)
      .eq('admin_approval_status', 'pending')

    if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 })
    if (count && count > 0) {
      return NextResponse.json({ error: `There are still ${count} pending match row(s). Approve or reject first.` }, { status: 400 })
    }

    const { data: updated, error } = await supabase
      .from('fika_socials')
      .update({ status: 'intro_send_ready' })
      .eq('id', sessionId)
      .select('*')
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, session: updated })
  }

  if (action === 'mark_intro_sent') {
    if (status !== 'intro_send_ready') {
      return NextResponse.json({ error: 'mark_intro_sent is only valid from intro_send_ready' }, { status: 400 })
    }
    const now = new Date().toISOString()
    const { data: updated, error: introErr } = await supabase
      .from('fika_socials')
      .update({
        status: 'intro_sms_sent',
        intro_sms_sent_at: now,
      })
      .eq('id', sessionId)
      .select('*')
      .single()

    if (introErr) return NextResponse.json({ error: introErr.message }, { status: 500 })
    return NextResponse.json({ ok: true, session: updated })
  }

  if (action === 'complete') {
    if (status !== 'intro_sms_sent') {
      return NextResponse.json({ error: 'complete is only valid from intro_sms_sent' }, { status: 400 })
    }
    const { data: updated, error } = await supabase
      .from('fika_socials')
      .update({ status: 'completed' })
      .eq('id', sessionId)
      .select('*')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, session: updated })
  }

  if (action === 'cancel') {
    if (status === 'completed' || status === 'cancelled') {
      return NextResponse.json({ error: 'Session is already terminal' }, { status: 400 })
    }
    const { data: updated, error } = await supabase
      .from('fika_socials')
      .update({ status: 'cancelled' })
      .eq('id', sessionId)
      .select('*')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, session: updated })
  }

  if (action === 'record_opt_in_invite') {
    if (status !== 'open_opt_in') {
      return NextResponse.json({ error: 'record_opt_in_invite is only valid from open_opt_in' }, { status: 400 })
    }
    const sentAt = typeof body.sent_at === 'string' && body.sent_at.trim() ? body.sent_at.trim() : new Date().toISOString()
    const { data: updated, error } = await supabase
      .from('fika_socials')
      .update({ opt_in_invite_sent_at: sentAt })
      .eq('id', sessionId)
      .select('*')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, session: updated })
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
}
