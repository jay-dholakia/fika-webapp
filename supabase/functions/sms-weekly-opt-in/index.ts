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

const MESSAGE = `Want a Fika intro this week? Reply Yes or Skip. If Yes, set your availability for Wed–Sat by Monday 11am PT — we'll send your intro Tuesday 9am PT.`

serve(async () => {
  try {
    if (Deno.env.get('SENDBLUE_REPLY_ONLY') === 'true') {
      return new Response(JSON.stringify({ ok: true, reply_only: true }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }
    // Weekly opt-in is user-initiated (text FIKA); this cron no longer sends
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

    const { data: activeMarkets } = await supabase
      .from('markets')
      .select('slug')
      .eq('active', true)
    const activeSlugs = new Set((activeMarkets ?? []).map((r: { slug: string }) => r.slug).filter(Boolean))
    if (activeSlugs.size === 0) {
      return new Response(JSON.stringify({ ok: true, batch_week: batchWeek, sent: 0, reason: 'no_active_markets' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const { data: optedInUserIds } = await supabase
      .from('weekly_match_opt_ins')
      .select('user_id')
      .eq('batch_week', batchWeek)
    const optedSet = new Set((optedInUserIds ?? []).map((r: { user_id: string }) => r.user_id))

    const { data: alreadySent } = await supabase
      .from('sms_conversation_states')
      .select('user_id')
      .eq('batch_week', batchWeek)
      .is('match_id', null)
    const alreadySentSet = new Set((alreadySent ?? []).map((r: { user_id: string }) => r.user_id))

    const capEnv = Deno.env.get('SMS_WEEKLY_OPT_IN_DAILY_CAP')
    const dailyCap = capEnv ? Math.max(0, parseInt(capEnv, 10) || 200) : 200

    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, phone, market')
      .not('phone', 'is', null)
    const withPhone = (profiles ?? [])
      .filter((p: { phone: string | null; market?: string | null }) => p.phone?.trim())
      .filter((p: { market?: string | null }) => p.market != null && activeSlugs.has(p.market))
      .filter((p: { id: string }) => !optedSet.has(p.id) && !alreadySentSet.has(p.id))
    const toSend = dailyCap > 0 ? withPhone.slice(0, dailyCap) : withPhone

    let sent = 0
    for (const p of toSend) {
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
    const skipped = dailyCap > 0 && withPhone.length > toSend.length ? withPhone.length - toSend.length : 0
    return new Response(
      JSON.stringify({ ok: true, batch_week: batchWeek, sent, ...(skipped > 0 && { skipped }) })
    )
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 })
  }
})
