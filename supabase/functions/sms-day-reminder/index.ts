// SMS cron: day-of reminder for confirmed Fikas today.
// "Today" is per match market (profiles.market → IANA zone); slot time uses same market zone.
// Invoked by pg_cron. Requires SENDBLUE_API_KEY_ID, SENDBLUE_API_SECRET_KEY.

declare const Deno: { env: { get(key: string): string | undefined } }
// @ts-ignore Deno
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
// @ts-ignore Deno
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
// @ts-ignore Deno
import { getFikaDateFromSlot, getTodayYmdInTimezone } from '../_shared/fika-schedule-time.ts'
// @ts-ignore Deno
import { fetchMarketMapForIds, timezoneForMatch } from '../_shared/fetch-match-market-map.ts'

const SENDBLUE_URL = 'https://api.sendblue.co/api/send-message'

const MS_24_H = 24 * 60 * 60 * 1000

/** Display time from slotId e.g. wed_14_30 -> "2:30pm". */
function slotToTimeStr(slotId: string): string {
  const parts = slotId.split('_')
  const hour = parseInt(parts[1] ?? '14', 10)
  const min = parseInt(parts[2] ?? '0', 10)
  const period = hour >= 12 ? 'pm' : 'am'
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour
  return min === 0 ? `${h12}${period}` : `${h12}:${min.toString().padStart(2, '0')}${period}`
}

function buildReminderMessage(time: string, venueName: string, neighborhood: string, starter?: string): string {
  let text = `Your Fika is today at ${time} at ${venueName} (${neighborhood}). We'll text you closer to the time with more details — and you can update your intro if you're running late.\n\nHope you both have a great conversation!`
  if (starter) text += `\n\nA question you might enjoy:\n${starter}`
  return text
}

async function hasInboundWithin24h(supabase: any, phone: string): Promise<boolean> {
  const { data } = await supabase
    .from('message_ledger')
    .select('created_at')
    .eq('direction', 'inbound')
    .eq('peer_phone', phone)
    .order('created_at', { ascending: false })
    .limit(1)
  const ts = (data?.[0]?.created_at as string | undefined) ?? null
  if (!ts) return false
  const last = new Date(ts).getTime()
  return Number.isFinite(last) && Date.now() - last <= MS_24_H
}

serve(async () => {
  try {
    if (Deno.env.get('SMS_OUTBOUND_DISABLED') === 'true') {
      return new Response(JSON.stringify({ ok: true, outbound_disabled: true }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }
    const apiKeyId = Deno.env.get('SENDBLUE_API_KEY_ID')
    const apiSecret = Deno.env.get('SENDBLUE_API_SECRET_KEY')
    if (!apiKeyId || !apiSecret) {
      return new Response(JSON.stringify({ error: 'Sendblue not configured' }), { status: 503 })
    }
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )
    const { data: matches } = await supabase
      .from('match_candidates')
      .select('id, user_a, user_b, week_anchor_monday, confirmed_slot_id, confirmed_venue_id, reasons')
      .eq('scheduling_status', 'confirmed')
      .not('confirmed_venue_id', 'is', null)
    const matchRows = matches ?? []
    const userIds = [...new Set(matchRows.flatMap((m: { user_a: string; user_b: string }) => [m.user_a, m.user_b]))]
    const marketMap = await fetchMarketMapForIds(supabase, userIds)
    const todayMatches = matchRows.filter(
      (m: { user_a: string; user_b: string; week_anchor_monday: string | null; confirmed_slot_id: string | null }) => {
        if (!m.week_anchor_monday || !m.confirmed_slot_id) return false
        const tz = timezoneForMatch(m, marketMap)
        return getFikaDateFromSlot(m.week_anchor_monday, m.confirmed_slot_id) === getTodayYmdInTimezone(tz)
      }
    )

    let sent = 0
    let skipped_no_recent_inbound = 0
    for (const match of todayMatches) {
      const { data: venue } = await supabase
        .from('venues')
        .select('name, neighborhood, city')
        .eq('id', match.confirmed_venue_id)
        .single()
      const venueName = venue?.name ?? 'the spot'
      const neighborhood = venue?.neighborhood ?? venue?.city ?? ''
      const reasons = (match.reasons as Record<string, unknown>) ?? {}
      const hooks = (reasons.conversation_hooks as string[]) ?? []
      const starter = hooks[0] as string | undefined
      const timeStr = slotToTimeStr(match.confirmed_slot_id)

      for (const userId of [match.user_a, match.user_b]) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('phone')
          .eq('id', userId)
          .single()
        if (!profile?.phone?.trim()) continue
        const phone = (profile.phone as string).trim()
        const okToSend = await hasInboundWithin24h(supabase, phone)
        if (!okToSend) {
          skipped_no_recent_inbound++
          continue
        }
        const message = buildReminderMessage(timeStr, venueName, neighborhood, starter)
        const res = await fetch(SENDBLUE_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'sb-api-key-id': apiKeyId,
            'sb-api-secret-key': apiSecret,
          },
          body: JSON.stringify({
            number: phone,
            content: message,
          }),
        })
        if (res.ok) sent++
      }
    }
    return new Response(JSON.stringify({ ok: true, date: todayPT, sent, skipped_no_recent_inbound }))
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 })
  }
})
