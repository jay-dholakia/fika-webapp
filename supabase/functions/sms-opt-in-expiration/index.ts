// SMS cron: opt-in window expiration (Monday 11am PT -> Monday 18:00 UTC).
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

function getNextMondayPhrase(): string {
  return 'next Monday'
}

const MESSAGE = (_nextMondayPhrase: string) =>
  `This week's opt-in window has closed (Sunday 12am PT – Monday 11am PT). Text FIKA next Sunday to opt in.`

serve(async () => {
  try {
    if (Deno.env.get('SENDBLUE_REPLY_ONLY') === 'true') {
      return new Response(JSON.stringify({ ok: true, reply_only: true }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }
    // Opt-in expiration disabled; weekly opt-in is user-initiated (text FIKA)
    return new Response(JSON.stringify({ ok: true, notified: 0 }), {
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

    const { data: optedInUserIds } = await supabase
      .from('weekly_match_opt_ins')
      .select('user_id')
      .eq('batch_week', batchWeek)
      .not('opted_in_at', 'is', null)
    const optedSet = new Set((optedInUserIds ?? []).map((r: { user_id: string }) => r.user_id))

    const { data: awaiting } = await supabase
      .from('sms_conversation_states')
      .select('user_id')
      .eq('batch_week', batchWeek)
      .is('match_id', null)
      .eq('state', 'awaiting_opt_in')

    const toNotifyIds = (awaiting ?? [])
      .map((r: { user_id: string }) => r.user_id)
      .filter((id: string) => !optedSet.has(id))

    if (!toNotifyIds.length) {
      return new Response(JSON.stringify({ ok: true, batch_week: batchWeek, notified: 0 }))
    }

    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, phone')
      .in('id', toNotifyIds)

    let notified = 0
    const nextMondayPhrase = getNextMondayPhrase()
    for (const p of profiles ?? []) {
      if (!p.phone?.trim()) continue
      const phone = (p.phone as string).trim()
      const content = MESSAGE(nextMondayPhrase)
      const res = await fetch(SENDBLUE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'sb-api-key-id': apiKeyId,
          'sb-api-secret-key': apiSecret,
        },
        body: JSON.stringify({ number: phone, content }),
      })
      if (res.ok) {
        notified++
        await supabase
          .from('weekly_match_opt_ins')
          .upsert(
            { user_id: p.id, batch_week: batchWeek, opted_in_at: null },
            { onConflict: 'user_id,batch_week' }
          )
      }
    }

    return new Response(JSON.stringify({ ok: true, batch_week: batchWeek, notified }))
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 })
  }
})

