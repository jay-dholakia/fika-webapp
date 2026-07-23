// Fires every 30 min (pg_cron). Finds events starting in 22-26 hours with day_before_sms_sent_at IS NULL,
// then sends a confirmation-request SMS to all yes-RSVP attendees.

declare const Deno: { env: { get(key: string): string | undefined } }
// @ts-ignore Deno
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
// @ts-ignore Deno
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
// @ts-ignore Deno
import { getIanaTimezoneForMarketSlug } from '../_shared/market-timezones.ts'

const SENDBLUE_URL = 'https://api.sendblue.co/api/send-message'

function formatEventDateTime(isoStr: string, tz = 'America/Los_Angeles'): string {
  const d = new Date(isoStr)
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long' }).format(d)
  let time = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(d).toLowerCase()
  time = time.replace(':00', '')
  return `${weekday} at ${time}`
}

function buildDayBeforeMessage(params: { eventLabel: string; venueName: string; neighborhood: string }): string {
  const { eventLabel, venueName, neighborhood } = params
  const locationLine = neighborhood ? `${venueName} (${neighborhood})` : venueName
  return `Your Fika is ${eventLabel} at ${locationLine}. Still on? Reply Yes to confirm your spot — if we don't hear from you, we'll give it to someone else.`
}

async function sendMessage(params: {
  apiKeyId: string
  apiSecret: string
  phone: string
  content: string
}): Promise<boolean> {
  const res = await fetch(SENDBLUE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'sb-api-key-id': params.apiKeyId,
      'sb-api-secret-key': params.apiSecret,
    },
    body: JSON.stringify({ number: params.phone, content: params.content }),
  })
  return res.ok
}

serve(async (_req: Request) => {
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

    const nowMs = Date.now()
    const windowStart = new Date(nowMs + 22 * 60 * 60 * 1000).toISOString()
    const windowEnd = new Date(nowMs + 26 * 60 * 60 * 1000).toISOString()

    const { data: events } = await supabase
      .from('weekly_fika_events')
      .select('id, market_slug, event_starts_at, venue_id')
      .gte('event_starts_at', windowStart)
      .lte('event_starts_at', windowEnd)
      .is('day_before_sms_sent_at', null)

    if (!events?.length) {
      return new Response(JSON.stringify({ ok: true, sent: 0, reason: 'no_events_in_window' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    let totalSent = 0

    for (const event of events) {
      const eventId = event.id as string
      const eventStartsAt = event.event_starts_at as string
      const venueId = event.venue_id as string | null
      const marketSlug = event.market_slug as string | null
      const eventTz = getIanaTimezoneForMarketSlug(marketSlug)

      let venueName = 'the venue'
      let neighborhood = ''
      if (venueId) {
        const { data: venue } = await supabase
          .from('venues')
          .select('name, neighborhood, city')
          .eq('id', venueId)
          .single()
        if (venue) {
          venueName = (venue.name as string) || venueName
          neighborhood = (venue.neighborhood as string) || (venue.city as string) || ''
        }
      }

      const eventLabel = formatEventDateTime(eventStartsAt, eventTz)
      const message = buildDayBeforeMessage({ eventLabel, venueName, neighborhood })

      const { data: rsvps } = await supabase
        .from('weekly_rsvps')
        .select('user_id')
        .eq('event_id', eventId)
        .eq('decision', 'yes')

      const userIds = (rsvps ?? []).map((r: { user_id: string }) => r.user_id)
      if (userIds.length === 0) {
        await supabase
          .from('weekly_fika_events')
          .update({ day_before_sms_sent_at: new Date().toISOString() })
          .eq('id', eventId)
        continue
      }

      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, phone')
        .in('id', userIds)

      for (const profile of (profiles ?? []) as Array<{ id: string; phone: string | null }>) {
        const phone = profile.phone?.trim()
        if (!phone) continue
        const sent = await sendMessage({ apiKeyId, apiSecret, phone, content: message })
        if (sent) totalSent++
      }

      await supabase
        .from('weekly_fika_events')
        .update({ day_before_sms_sent_at: new Date().toISOString() })
        .eq('id', eventId)
    }

    return new Response(JSON.stringify({ ok: true, sent: totalSent }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 })
  }
})
