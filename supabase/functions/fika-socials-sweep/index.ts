// Fika socials sweep: invite T-48h, close T-24h, match + send T-6h.
// Invoked by pg_cron via net.http_post to this Edge Function.
//
// Requires Edge secrets:
// - SUPABASE_URL
// - SUPABASE_SERVICE_ROLE_KEY
// - SENDBLUE_API_KEY_ID
// - SENDBLUE_API_SECRET_KEY

declare const Deno: { env: { get(key: string): string | undefined } }
// @ts-ignore Deno
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
// @ts-ignore Deno
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SENDBLUE_URL = 'https://api.sendblue.co/api/send-message'
const MS_PER_HOUR = 60 * 60 * 1000

function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const R = 3958.7613
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

function computeSocialCadence(fikaStartsAtIso: string): { optInBlastDueAt: string; optInClosesAt: string; matchSendDueAt: string } {
  const t = new Date(fikaStartsAtIso).getTime()
  if (!Number.isFinite(t)) throw new Error(`Invalid fika_starts_at: ${fikaStartsAtIso}`)
  return {
    optInBlastDueAt: new Date(t - 48 * MS_PER_HOUR).toISOString(),
    optInClosesAt: new Date(t - 24 * MS_PER_HOUR).toISOString(),
    matchSendDueAt: new Date(t - 6 * MS_PER_HOUR).toISOString(),
  }
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

async function sendSendblue(toE164: string, text: string, apiKeyId: string, apiSecret: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetch(SENDBLUE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'sb-api-key-id': apiKeyId,
      'sb-api-secret-key': apiSecret,
    },
    body: JSON.stringify({
      number: toE164,
      content: text,
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    return { ok: false, error: `sendblue ${res.status}: ${body}` }
  }
  return { ok: true }
}

function availabilitySlotIdFromUtcInTimezone(utcIso: string, ianaTz: string): string {
  const d = new Date(utcIso)
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: ianaTz,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d)
  const weekday = (parts.find((p) => p.type === 'weekday')?.value ?? 'Wed').toLowerCase().slice(0, 3)
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '18')
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '00')
  let totalMinutes = hour * 60 + minute
  totalMinutes = Math.floor(totalMinutes / 30) * 30
  totalMinutes = Math.max(9 * 60, Math.min(18 * 60 + 30, totalMinutes))
  const fh = Math.floor(totalMinutes / 60)
  const fm = totalMinutes % 60
  const block = `${String(fh).padStart(2, '0')}_${fm === 30 ? '30' : '00'}`
  return `${weekday}_${block}`
}

function shuffleStable(items: string[], seed: string): string[] {
  const arr = [...items]
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  for (let i = arr.length - 1; i > 0; i--) {
    h = (h * 1664525 + 1013904223) >>> 0
    const j = h % (i + 1)
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
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

serve(async () => {
  try {
    if (Deno.env.get('SMS_OUTBOUND_DISABLED') === 'true') {
      return new Response(JSON.stringify({ ok: true, outbound_disabled: true }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(JSON.stringify({ error: 'Supabase not configured' }), { status: 500 })
    }
    const apiKeyId = Deno.env.get('SENDBLUE_API_KEY_ID') ?? ''
    const apiSecret = Deno.env.get('SENDBLUE_API_SECRET_KEY') ?? ''
    if (!apiKeyId || !apiSecret) {
      return new Response(JSON.stringify({ error: 'Sendblue not configured' }), { status: 503 })
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey)
    const nowIso = new Date().toISOString()
    const nowMs = Date.now()

    const lookback = new Date(nowMs - 2 * 24 * MS_PER_HOUR).toISOString()
    const lookahead = new Date(nowMs + 7 * 24 * MS_PER_HOUR).toISOString()

    const { data: sessions, error: sErr } = await supabase
      .from('fika_socials')
      .select('id, market_slug, venue_id, week_anchor_monday, radius_miles, iana_tz, fika_starts_at, status, opt_in_invite_sent_at, opt_in_closes_at, opt_in_closed_at, match_run_at, intro_sms_sent_at')
      .gte('fika_starts_at', lookback)
      .lte('fika_starts_at', lookahead)
      .order('fika_starts_at', { ascending: true })
      .limit(80)

    if (sErr) {
      return new Response(JSON.stringify({ ok: false, error: sErr.message }), { status: 500 })
    }

    const summary: Record<string, unknown>[] = []

    for (const s of sessions ?? []) {
      const sessionId = s.id as string
      const status = String((s as any).status ?? '')
      const fikaStartsAt = String((s as any).fika_starts_at ?? '')
      const ianaTz = String((s as any).iana_tz ?? 'America/Los_Angeles')
      const cadence = computeSocialCadence(fikaStartsAt)
      const matchSendMs = Date.parse(cadence.matchSendDueAt)

      // Invite once at/after T-48h for published sessions.
      if (status === 'open_opt_in' && !(s as any).opt_in_invite_sent_at && nowMs >= Date.parse(cadence.optInBlastDueAt)) {
        const { data: venue, error: vErr } = await supabase
          .from('venues')
          .select('id, name, lat, lng')
          .eq('id', (s as any).venue_id as string)
          .maybeSingle()
        if (vErr || !venue) {
          summary.push({ sessionId, step: 'invite', ok: false, error: vErr?.message ?? 'venue_not_found' })
        } else {
          const vLat = Number((venue as any).lat)
          const vLng = Number((venue as any).lng)
          const venueName = String((venue as any).name ?? 'the venue')
          const radius = Number((s as any).radius_miles ?? 4)

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
            if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(vLat) || !Number.isFinite(vLng)) continue
            if (haversineMiles(lat, lng, vLat, vLng) > radius) continue
            const phone = String((p as any).phone ?? '').trim()
            if (!phone) continue
            const msg = inviteMessage({ venueName, whenLocal: formatLocalDateTime(fikaStartsAt, ianaTz) })
            const out = await sendSendblue(phone, msg, apiKeyId, apiSecret)
            if (out.ok) sent++
          }

          await supabase.from('fika_socials').update({ opt_in_invite_sent_at: nowIso }).eq('id', sessionId)
          summary.push({ sessionId, step: 'invite', ok: true, sent })
        }
      }

      // Auto close when opt_in_closes_at passes.
      if (status === 'open_opt_in' && (s as any).opt_in_closes_at) {
        const closesMs = Date.parse(String((s as any).opt_in_closes_at))
        if (Number.isFinite(closesMs) && nowMs >= closesMs && !(s as any).opt_in_closed_at) {
          await supabase.from('fika_socials').update({ status: 'opt_in_closed', opt_in_closed_at: nowIso }).eq('id', sessionId)
          summary.push({ sessionId, step: 'close_opt_in', ok: true })
        }
      }

      // Match creation after close (one-time).
      if (!(s as any).match_run_at) {
        const closesAt = (s as any).opt_in_closes_at ? Date.parse(String((s as any).opt_in_closes_at)) : NaN
        if (Number.isFinite(closesAt) && nowMs >= closesAt) {
          const { data: optRows } = await supabase
            .from('fika_social_opt_ins')
            .select('user_id')
            .eq('session_id', sessionId)
            .is('withdrawn_at', null)
            .limit(2000)
          const opted = Array.from(new Set((optRows ?? []).map((r: any) => r.user_id as string))).sort()
          const ordered = shuffleStable(opted, `${sessionId}:${String((s as any).week_anchor_monday)}`)

          const { data: existingRows } = await supabase
            .from('match_candidates')
            .select('user_a, user_b')
            .eq('fika_social_id', sessionId)

          const pairKeys = new Set<string>()
          for (const row of existingRows ?? []) {
            const a = row.user_a as string
            const b = row.user_b as string
            pairKeys.add(a < b ? `${a}:${b}` : `${b}:${a}`)
          }

          const slotId = availabilitySlotIdFromUtcInTimezone(fikaStartsAt, ianaTz)
          const expiresAt = new Date(new Date(fikaStartsAt).getTime() + 4 * 24 * MS_PER_HOUR).toISOString()

          let created = 0
          for (let i = 0; i + 1 < ordered.length; i += 2) {
            const rawA = ordered[i]!
            const rawB = ordered[i + 1]!
            const userA = rawA < rawB ? rawA : rawB
            const userB = rawA < rawB ? rawB : rawA
            const pairKey = `${userA}:${userB}`
            if (pairKeys.has(pairKey)) continue

            const { error: insErr } = await supabase.from('match_candidates').insert({
              user_a: userA,
              user_b: userB,
              status: 'active',
              week_anchor_monday: String((s as any).week_anchor_monday),
              expires_at: expiresAt,
              fika_social_id: sessionId,
              admin_approval_status: 'approved',
              admin_approval_at: nowIso,
              suggested_venue_id: String((s as any).venue_id),
              confirmed_venue_id: String((s as any).venue_id),
              default_slot_id: slotId,
              confirmed_slot_id: slotId,
              overlapping_slot_ids: [slotId],
              scheduling_status: 'confirmed',
              confirmed_at: nowIso,
              reasons: { fika_social_matcher: 'greedy_shuffle_v1', fika_social_id: sessionId },
              match_opt_in_deadline_at: new Date(nowMs + 24 * MS_PER_HOUR).toISOString(),
            })
            if (!insErr) {
              created++
              pairKeys.add(pairKey)
            }
          }

          await supabase.from('fika_socials').update({ status: 'intro_send_ready', match_run_at: nowIso }).eq('id', sessionId)
          summary.push({ sessionId, step: 'matcher', ok: true, created })
        }
      }

      // Send intros at/after T-6h once.
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
            const delivery = await invokeMatchDelivery({ supabaseUrl, serviceRoleKey, matchIds: ids })
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

    return new Response(JSON.stringify({ ok: true, now: nowIso, sessions: (sessions ?? []).length, summary }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500 })
  }
})

