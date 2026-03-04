// SMS cron: send weekly opt-in to users with phone who haven't opted in yet.
// Invoke via pg_cron (Supabase).

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

serve(async (req: Request) => {
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
    const conciergeNumber = Deno.env.get('SENDBLUE_CONCIERGE_NUMBER')
    if (!apiKeyId || !apiSecret || !conciergeNumber) {
      return new Response(JSON.stringify({ error: 'Sendblue not configured' }), { status: 503 })
    }
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
          send_style: 'invisible',
        }),
      })
      if (res.ok) {
        sent++
        await supabase.from('sms_conversation_states').upsert(
          {
            user_id: p.id,
            batch_week: batchWeek,
            match_id: null,
            state: 'awaiting_opt_in',
            payload: {},
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,batch_week,match_id' }
        )
      }
    }
    return new Response(JSON.stringify({ ok: true, batch_week: batchWeek, sent }))
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 })
  }
})
