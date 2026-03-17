// SMS cron: follow-up for users who didn't reply to weekly opt-in.
// Invoked by pg_cron. Requires SENDBLUE_API_KEY_ID, SENDBLUE_API_SECRET_KEY.

declare const Deno: { env: { get(key: string): string | undefined } }
// @ts-ignore Deno
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
// @ts-ignore Deno
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SENDBLUE_URL = 'https://api.sendblue.co/api/send-message'

const MESSAGE = `Quick check — reply Yes or Skip and set availability (Wed–Sat) by Monday 11am PT to get your intro Tuesday 9am PT.`

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
    // Follow-up disabled; weekly opt-in is user-initiated (text FIKA)
    return new Response(JSON.stringify({ ok: true, sent: 0 }), {
      headers: { 'Content-Type': 'application/json' },
    })
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

    const capEnv = Deno.env.get('SMS_FOLLOW_UP_DAILY_CAP')
    const dailyCap = capEnv ? Math.max(0, parseInt(capEnv, 10) || 200) : 200
    const toContact = dailyCap > 0 ? awaiting.slice(0, dailyCap) : awaiting

    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, phone')
      .in('id', toContact.map((s: { user_id: string }) => s.user_id))
    const byId = new Map<string, string | null>(
      (profiles ?? []).map((p: { id: string; phone: string | null }) => [p.id, p.phone ?? null])
    )

    let sent = 0
    for (const s of toContact) {
      if (optedSet.has(s.user_id)) continue
      const phone = byId.get(s.user_id)
      if (typeof phone !== 'string' || !phone.trim()) continue
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
    const skipped = dailyCap > 0 && awaiting.length > toContact.length ? awaiting.length - toContact.length : 0
    return new Response(
      JSON.stringify({ ok: true, batch_week: batchWeek, sent, ...(skipped > 0 && { skipped }) })
    )
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 })
  }
})
