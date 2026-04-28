import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { haversineMiles } from '@/lib/fika-social-geo'
import { computeSocialFikaCadenceInstants } from '@/lib/weekly-fika-cadence'
import { runFikaSocialMatcher } from '@/lib/fika-social-matcher'
import { sendConcierge } from '@/lib/sendblue'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

function requireCronAuth(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) return false
  const auth = request.headers.get('Authorization')?.trim() ?? ''
  return auth === `Bearer ${secret}`
}

function formatLocalDateTime(utcIso: string, ianaTz: string): string {
  const d = new Date(utcIso)
  if (Number.isNaN(d.getTime())) return utcIso
  return new Intl.DateTimeFormat('en-US', {
    timeZone: ianaTz,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d)
}

function inviteMessage(params: { venueName: string; whenLocal: string }): string {
  return `Fika in 2 days: ${params.whenLocal} at ${params.venueName}.\n\nWant to join this Fika Social? Reply YES in the next 24 hours.`
}

async function invokeMatchDelivery(params: { supabaseUrl: string; serviceRoleKey: string; matchIds: string[] }) {
  const fnUrl = `${params.supabaseUrl.replace(/\/$/, '')}/functions/v1/sms-match-delivery`
  const res = await fetch(fnUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.serviceRoleKey}`,
    },
    body: JSON.stringify({ match_ids: params.matchIds }),
  })
  const text = await res.text().catch(() => '')
  return { ok: res.ok, status: res.status, text }
}

export async function GET(request: Request) {
  if (!requireCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) return NextResponse.json({ error: 'Server not configured' }, { status: 500 })

  const supabase = createClient(url, key)
  const nowIso = new Date().toISOString()
  const nowMs = Date.now()

  // Only look at upcoming socials inside a reasonable window to keep work bounded.
  const lookback = new Date(nowMs - 2 * 24 * 60 * 60 * 1000).toISOString()
  const lookahead = new Date(nowMs + 7 * 24 * 60 * 60 * 1000).toISOString()

  const { data: sessions, error: sErr } = await supabase
    .from('fika_socials')
    .select('id, market_slug, venue_id, week_anchor_monday, radius_miles, iana_tz, fika_starts_at, status, opt_in_invite_sent_at, opt_in_closes_at, opt_in_closed_at, match_run_at, intro_sms_sent_at')
    .gte('fika_starts_at', lookback)
    .lte('fika_starts_at', lookahead)
    .order('fika_starts_at', { ascending: true })
    .limit(80)

  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 })

  const summary: Array<Record<string, unknown>> = []

  for (const s of sessions ?? []) {
    const sessionId = s.id as string
    const status = String((s as any).status ?? '')
    const fikaStartsAt = String((s as any).fika_starts_at ?? '')
    const ianaTz = String((s as any).iana_tz ?? 'America/Los_Angeles')
    const cadence = computeSocialFikaCadenceInstants(fikaStartsAt)
    const matchSendMs = Date.parse(cadence.matchSendDueAt)

    // 1) Send invite (T-48h) once, after publish (open_opt_in).
    if (status === 'open_opt_in' && !(s as any).opt_in_invite_sent_at) {
      if (nowMs >= Date.parse(cadence.optInBlastDueAt)) {
        const { data: venue, error: vErr } = await supabase
          .from('venues')
          .select('id, name, lat, lng')
          .eq('id', (s as any).venue_id as string)
          .maybeSingle()
        if (vErr) {
          summary.push({ sessionId, step: 'invite', ok: false, error: vErr.message })
        } else if (!venue?.lat || !venue?.lng) {
          summary.push({ sessionId, step: 'invite', ok: false, error: 'venue_missing_coords' })
        } else {
          const vLat = Number(venue.lat)
          const vLng = Number(venue.lng)
          const venueName = String(venue.name ?? 'the venue')

          const { data: excludedRows } = await supabase
            .from('fika_social_invite_exclusions')
            .select('user_id')
            .eq('session_id', sessionId)
          const excluded = new Set<string>((excludedRows ?? []).map((r: any) => r.user_id as string))

          const { data: profiles } = await supabase
            .from('profiles')
            .select('id, phone, lat, lng')
            .eq('market', (s as any).market_slug as string)
            .eq('is_active', true)
            .is('sms_opted_out_at', null)
            .not('phone', 'is', null)
            .not('lat', 'is', null)
            .not('lng', 'is', null)
            .limit(2000)

          let sent = 0
          for (const p of profiles ?? []) {
            const userId = p.id as string
            if (excluded.has(userId)) continue
            const lat = Number((p as any).lat)
            const lng = Number((p as any).lng)
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
            if (haversineMiles(lat, lng, vLat, vLng) > Number((s as any).radius_miles ?? 4)) continue
            const phone = String((p as any).phone ?? '').trim()
            if (!phone) continue
            await sendConcierge(phone, inviteMessage({ venueName, whenLocal: formatLocalDateTime(fikaStartsAt, ianaTz) }))
            sent++
          }

          await supabase
            .from('fika_socials')
            .update({ opt_in_invite_sent_at: nowIso })
            .eq('id', sessionId)

          summary.push({ sessionId, step: 'invite', ok: true, sent })
        }
      }
    }

    // 2) Auto close opt-in when opt_in_closes_at passes.
    if (status === 'open_opt_in' && (s as any).opt_in_closes_at) {
      const closesMs = Date.parse(String((s as any).opt_in_closes_at))
      if (Number.isFinite(closesMs) && nowMs >= closesMs && !(s as any).opt_in_closed_at) {
        await supabase
          .from('fika_socials')
          .update({ status: 'opt_in_closed', opt_in_closed_at: nowIso })
          .eq('id', sessionId)
        summary.push({ sessionId, step: 'close_opt_in', ok: true })
      }
    }

    // 3) Run matcher immediately after close (one-time).
    if ((status === 'opt_in_closed' || status === 'open_opt_in') && !(s as any).match_run_at) {
      const closesAt = (s as any).opt_in_closes_at ? Date.parse(String((s as any).opt_in_closes_at)) : NaN
      if (Number.isFinite(closesAt) && nowMs >= closesAt) {
        const row = {
          id: sessionId,
          market_slug: (s as any).market_slug as string,
          venue_id: (s as any).venue_id as string,
          week_anchor_monday: String((s as any).week_anchor_monday),
          radius_miles: Number((s as any).radius_miles),
          iana_tz: ianaTz,
          fika_starts_at: fikaStartsAt,
          status: status,
        }
        const result = await runFikaSocialMatcher(supabase, row as any)
        if (!result.ok) {
          summary.push({ sessionId, step: 'matcher', ok: false, error: result.error, code: result.code })
        } else {
          await supabase
            .from('fika_socials')
            .update({ status: 'intro_send_ready', match_run_at: nowIso })
            .eq('id', sessionId)
          summary.push({ sessionId, step: 'matcher', ok: true, created: result.createdMatchIds.length })
        }
      }
    }

    // 4) Send match/intros at T-6h (one-time) using sms-match-delivery for explicit match ids.
    if (!(s as any).intro_sms_sent_at && Number.isFinite(matchSendMs) && nowMs >= matchSendMs) {
      const { data: matches, error: mErr } = await supabase
        .from('match_candidates')
        .select('id')
        .eq('fika_social_id', sessionId)
        .eq('admin_approval_status', 'approved')
        .is('fika_social_intro_sms_sent_at', null)
        .limit(400)
      if (mErr) {
        summary.push({ sessionId, step: 'intro_send', ok: false, error: mErr.message })
      } else {
        const ids = (matches ?? []).map((r: any) => r.id as string)
        if (ids.length > 0) {
          const delivery = await invokeMatchDelivery({ supabaseUrl: url, serviceRoleKey: key, matchIds: ids })
          if (!delivery.ok) {
            summary.push({ sessionId, step: 'intro_send', ok: false, status: delivery.status, response: delivery.text })
          } else {
            await supabase.from('match_candidates').update({ fika_social_intro_sms_sent_at: nowIso }).in('id', ids)
            await supabase.from('fika_socials').update({ intro_sms_sent_at: nowIso, status: 'intro_sms_sent' }).eq('id', sessionId)
            summary.push({ sessionId, step: 'intro_send', ok: true, matches: ids.length })
          }
        } else {
          await supabase.from('fika_socials').update({ intro_sms_sent_at: nowIso, status: 'intro_sms_sent' }).eq('id', sessionId)
          summary.push({ sessionId, step: 'intro_send', ok: true, matches: 0 })
        }
      }
    }
  }

  return NextResponse.json({ ok: true, now: nowIso, sessions: (sessions ?? []).length, summary })
}

