// Runs hourly (pg_cron). Finds 1v1 Fikas that ended ~2h ago and sends "How was your Fika?" to both users.
// Sets per-match state to 1v1_feedback so the webhook can capture their reply.

declare const Deno: { env: { get(key: string): string | undefined } }
// @ts-ignore Deno
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
// @ts-ignore Deno
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SENDBLUE_URL = 'https://api.sendblue.co/api/send-message'

async function sendSms(params: {
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

    const now = Date.now()
    const windowStart = new Date(now - 6 * 60 * 60 * 1000).toISOString() // 6h ago
    const windowEnd = new Date(now - 2 * 60 * 60 * 1000).toISOString()   // 2h ago

    // Load all active 1v1 matches; filter by event_starts_at window in JS
    const { data: matches } = await supabase
      .from('match_candidates')
      .select('id, user_a, user_b, reasons')
      .eq('status', 'active')
      .filter('reasons->>source', 'eq', '1v1')

    let sent = 0

    for (const match of (matches ?? []) as Array<{
      id: string; user_a: string; user_b: string; reasons: Record<string, unknown>
    }>) {
      const reasons = match.reasons ?? {}
      const eventStartsAt = typeof reasons.event_starts_at === 'string' ? reasons.event_starts_at : null
      if (!eventStartsAt) continue
      if (eventStartsAt < windowStart || eventStartsAt > windowEnd) continue
      if (typeof reasons.feedback_requested_at === 'string') continue // already sent

      const matchId = match.id
      const userIds = [match.user_a, match.user_b]

      const { data: profileRows } = await supabase
        .from('profiles')
        .select('id, first_name, phone')
        .in('id', userIds)

      const nameMap: Record<string, string> = {}
      const phoneMap: Record<string, string> = {}
      for (const p of (profileRows ?? []) as Array<{ id: string; first_name: string | null; phone: string | null }>) {
        nameMap[p.id] = p.first_name?.trim() || 'Someone'
        phoneMap[p.id] = p.phone?.trim() || ''
      }

      let anySent = false
      for (const userId of userIds) {
        const phone = phoneMap[userId]
        if (!phone) continue
        const otherUserId = userId === match.user_a ? match.user_b : match.user_a
        const otherName = nameMap[otherUserId] || 'Someone'

        const ok = await sendSms({ apiKeyId, apiSecret, phone, content: `How was your Fika with ${otherName}? 😊` })
        if (ok) {
          await supabase
            .from('sms_conversation_states')
            .upsert(
              { user_id: userId, match_id: matchId, state: '1v1_feedback', payload: {}, last_sendblue_message_handle: null },
              { onConflict: 'user_id,match_id' }
            )
          anySent = true
          sent++
        }
      }

      if (anySent) {
        // Mark sent + complete the match
        await supabase
          .from('match_candidates')
          .update({
            status: 'completed',
            reasons: { ...reasons, feedback_requested_at: new Date().toISOString() },
          })
          .eq('id', matchId)
      }
    }

    return new Response(JSON.stringify({ ok: true, sent }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 })
  }
})
