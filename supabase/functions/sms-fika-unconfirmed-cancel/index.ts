// Fires every 30 min (pg_cron). Finds events starting in 5.5-6.5 hours where a day-before confirm
// SMS was sent. Cancels RSVPs from users who never replied Yes and notifies them.

declare const Deno: { env: { get(key: string): string | undefined } }
// @ts-ignore Deno
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
// @ts-ignore Deno
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SENDBLUE_URL = 'https://api.sendblue.co/api/send-message'

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
    const windowStart = new Date(nowMs + 5.5 * 60 * 60 * 1000).toISOString()
    const windowEnd = new Date(nowMs + 6.5 * 60 * 60 * 1000).toISOString()

    // Find events in the window where a day-before SMS was sent
    const { data: events } = await supabase
      .from('weekly_fika_events')
      .select('id')
      .gte('event_starts_at', windowStart)
      .lte('event_starts_at', windowEnd)
      .not('day_before_sms_sent_at', 'is', null)

    if (!events?.length) {
      return new Response(JSON.stringify({ ok: true, cancelled: 0, reason: 'no_events_in_window' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    let totalCancelled = 0

    for (const event of events) {
      const eventId = event.id as string

      // Find yes-RSVPs that never confirmed
      const { data: unconfirmed } = await supabase
        .from('weekly_rsvps')
        .select('user_id')
        .eq('event_id', eventId)
        .eq('decision', 'yes')
        .is('day_before_confirmed_at', null)

      const unconfirmedIds = (unconfirmed ?? []).map((r: { user_id: string }) => r.user_id)
      if (unconfirmedIds.length === 0) continue

      // Cancel their RSVPs
      await supabase
        .from('weekly_rsvps')
        .update({ decision: 'cancelled', decided_at: new Date().toISOString() })
        .eq('event_id', eventId)
        .in('user_id', unconfirmedIds)
        .eq('decision', 'yes')

      // Get phone numbers and reset SMS state
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, phone')
        .in('id', unconfirmedIds)

      for (const profile of (profiles ?? []) as Array<{ id: string; phone: string | null }>) {
        const phone = profile.phone?.trim()
        if (!phone) continue

        await sendMessage({
          apiKeyId,
          apiSecret,
          phone,
          content: "We didn't hear back from you so we gave your spot to someone else — no worries, we'll reach out about the next one.",
        })

        await supabase.rpc('upsert_global_sms_conversation_state', {
          p_user_id: profile.id,
          p_state: 'global_ready',
          p_payload: {},
          p_last_sendblue_message_handle: null,
        })

        totalCancelled++
      }
    }

    return new Response(JSON.stringify({ ok: true, cancelled: totalCancelled }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 })
  }
})
