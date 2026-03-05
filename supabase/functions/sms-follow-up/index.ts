// SMS cron: follow-up for users who didn't reply to weekly opt-in.
// Invoke via pg_cron (Supabase).

// @ts-ignore Deno
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
// @ts-ignore Deno
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SENDBLUE_URL = 'https://api.sendblue.co/api/send-message'

const MESSAGE = `Quick check — should I look for someone for you this week?
IN / SKIP`

function getCurrentBatchWeek(): string {
  const d = new Date()
  const day = d.getUTCDay()
  const date = d.getUTCDate()
  const diff = date - day + (day === 0 ? -6 : 1)
  const monday = new Date(d)
  monday.setUTCDate(diff)
  return monday.toISOString().slice(0, 10)
}

serve(async () => {
  try {
    if (Deno.env.get('SENDBLUE_REPLY_ONLY') === 'true') {
      return new Response(JSON.stringify({ ok: true, reply_only: true }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )
    const apiKeyId = Deno.env.get('SENDBLUE_API_KEY_ID')
    const apiSecret = Deno.env.get('SENDBLUE_API_SECRET_KEY')
    if (!apiKeyId || !apiSecret) {
      return new Response(JSON.stringify({ error: 'Sendblue not configured' }), { status: 503 })
    }
    const batchWeek = getCurrentBatchWeek()

    const { data: optedIn } = await supabase
      .from('weekly_match_opt_ins')
      .select('user_id')
      .eq('batch_week', batchWeek)
    const optedSet = new Set((optedIn ?? []).map((r: { user_id: string }) => r.user_id))

    const { data: states } = await supabase
      .from('sms_conversation_states')
      .select('user_id')
      .eq('batch_week', batchWeek)
      .is('match_id', null)
      .eq('state', 'awaiting_opt_in')
    const awaiting = states ?? []

    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, phone')
      .in('id', awaiting.map((s: { user_id: string }) => s.user_id))
    const byId = new Map((profiles ?? []).map((p: { id: string; phone: string }) => [p.id, p.phone]))

    let sent = 0
    for (const s of awaiting) {
      if (optedSet.has(s.user_id)) continue
      const phone = byId.get(s.user_id)
      if (!phone?.trim()) continue
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
      if (res.ok) sent++
    }
    return new Response(JSON.stringify({ ok: true, batch_week: batchWeek, sent }))
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 })
  }
})
