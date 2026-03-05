// SMS cron: send weekly opt-in to users with phone who haven't opted in yet.
// Invoked by pg_cron. Requires SENDBLUE_API_KEY_ID, SENDBLUE_API_SECRET_KEY.

declare const Deno: { env: { get(key: string): string | undefined } }
// @ts-ignore Deno
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
// @ts-ignore Deno
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SENDBLUE_URL = 'https://api.sendblue.co/api/send-message'

function getCurrentBatchWeek(): string {
  const d = new Date()
  const day = d.getUTCDay()
  const date = d.getUTCDate()
  const diff = date - day + (day === 0 ? -6 : 1)
  const monday = new Date(d)
  monday.setUTCDate(diff)
  return monday.toISOString().slice(0, 10)
}

const MESSAGE = `Would you like a Fika introduction this week?

Reply IN or SKIP`

serve(async () => {
  try {
    if (Deno.env.get('SENDBLUE_REPLY_ONLY') === 'true') {
      return new Response(JSON.stringify({ ok: true, reply_only: true }), {
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
    const batchWeek = getCurrentBatchWeek()

    const { data: optedInUserIds } = await supabase
      .from('weekly_match_opt_ins')
      .select('user_id')
      .eq('batch_week', batchWeek)
    const optedSet = new Set((optedInUserIds ?? []).map((r: { user_id: string }) => r.user_id))

    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, phone')
      .not('phone', 'is', null)
    const withPhone = (profiles ?? []).filter((p: { phone: string | null }) => p.phone?.trim())

    let sent = 0
    for (const p of withPhone) {
      if (optedSet.has(p.id)) continue
      const phone = (p.phone as string).trim()
      const res = await fetch(SENDBLUE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'sb-api-key-id': apiKeyId,
          'sb-api-secret-key': apiSecret,
        },
        body: JSON.stringify({
          number: phone,
          content: MESSAGE,
        }),
      })
      if (res.ok) {
        sent++
        await supabase.rpc('upsert_global_sms_conversation_state', {
          p_user_id: p.id,
          p_batch_week: batchWeek,
          p_state: 'awaiting_opt_in',
          p_payload: {},
          p_last_sendblue_message_handle: null,
        })
      }
    }
    return new Response(JSON.stringify({ ok: true, batch_week: batchWeek, sent }))
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 })
  }
})
