// SMS cron: 3 hours before Fika — reminder + "reply HERE or RUNNING LATE and we'll let your match know".
// Invoked by pg_cron every hour. Requires SENDBLUE_API_KEY_ID, SENDBLUE_API_SECRET_KEY.

declare const Deno: { env: { get(key: string): string | undefined } }
// @ts-ignore Deno
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
// @ts-ignore Deno
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
// @ts-ignore Deno
import { getFikaTimeMs } from '../_shared/fika-schedule-time.ts'
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

const MS_2_5_H = 2.5 * 60 * 60 * 1000
const MS_3_5_H = 3.5 * 60 * 60 * 1000

function buildThreeHourMessage(time: string, venueName: string, neighborhood: string): string {
  return `Your Fika is in about 3 hours: ${time} at ${venueName} (${neighborhood}).\nText here to coordinate directly with your intro. Relay closes 2 hours after your scheduled time.`
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
    const now = Date.now()
    const { data: matches } = await supabase
      .from('match_candidates')
      .select('id, user_a, user_b, week_anchor_monday, confirmed_slot_id, confirmed_venue_id, three_hour_reminder_sent_at')
      .eq('scheduling_status', 'confirmed')
      .not('confirmed_venue_id', 'is', null)
      .not('confirmed_slot_id', 'is', null)
      .not('week_anchor_monday', 'is', null)
      .is('three_hour_reminder_sent_at', null)

    const matchRows = matches ?? []
    const userIds = [...new Set(matchRows.flatMap((m: { user_a: string; user_b: string }) => [m.user_a, m.user_b]))]
    const marketMap = await fetchMarketMapForIds(supabase, userIds)
    const toSend: { id: string; timeStr: string; venueName: string; neighborhood: string; userIds: string[] }[] = []
    for (const m of matchRows) {
      const tz = timezoneForMatch(m, marketMap)
      const fikaMs = getFikaTimeMs(m.week_anchor_monday, m.confirmed_slot_id, tz)
      if (fikaMs == null) continue
      const diff = fikaMs - now
      if (diff >= MS_2_5_H && diff <= MS_3_5_H) {
        const { data: venue } = await supabase
          .from('venues')
          .select('name, neighborhood, city')
          .eq('id', m.confirmed_venue_id)
          .single()
        toSend.push({
          id: m.id,
          timeStr: slotToTimeStr(m.confirmed_slot_id),
          venueName: venue?.name ?? 'the spot',
          neighborhood: venue?.neighborhood ?? venue?.city ?? '',
          userIds: [m.user_a, m.user_b],
        })
      }
    }

    let sent = 0
    let skipped_no_recent_inbound = 0
    for (const item of toSend) {
      const message = buildThreeHourMessage(item.timeStr, item.venueName, item.neighborhood)
      for (const userId of item.userIds) {
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
      await supabase
        .from('match_candidates')
        .update({ three_hour_reminder_sent_at: new Date().toISOString() })
        .eq('id', item.id)
    }
    return new Response(JSON.stringify({ ok: true, sent, matches_processed: toSend.length, skipped_no_recent_inbound }))
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 })
  }
})
