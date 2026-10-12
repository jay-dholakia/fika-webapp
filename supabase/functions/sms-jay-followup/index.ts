// SMS cron: sends a personal follow-up from Jay ~1 hour after signup.
// Runs every 10 minutes via pg_cron.

declare const Deno: { env: { get(key: string): string | undefined } }

// @ts-ignore Deno
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
// @ts-ignore Deno
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SENDBLUE_URL = 'https://api.sendblue.co/api/send-message'
const MAX_SEND_PER_RUN = 50
const WINDOW_MIN_MINUTES = 55
const WINDOW_MAX_MINUTES = 75

function buildMessage(firstName: string | null | undefined): string {
  const name = (firstName ?? '').trim()
  const greeting = name ? `Hey ${name}!` : 'Hey!'
  return `${greeting} I'm Jay, the founder of Fika. Thanks for signing up — we're growing in your city and hope to have a great intro for you soon. Feel free to text me here anytime if you have questions. I read everything.`
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
    const conciergeNumber = Deno.env.get('SENDBLUE_CONCIERGE_NUMBER')
    if (!apiKeyId || !apiSecret || !conciergeNumber) {
      return new Response(JSON.stringify({ error: 'Sendblue not configured' }), { status: 503 })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const now = new Date()
    const windowEnd = new Date(now.getTime() - WINDOW_MIN_MINUTES * 60 * 1000)
    const windowStart = new Date(now.getTime() - WINDOW_MAX_MINUTES * 60 * 1000)

    // Atomically claim rows by setting jay_followup_sent_at now.
    const { data: profiles, error: claimErr } = await supabase
      .from('profiles')
      .update({ jay_followup_sent_at: now.toISOString() })
      .is('jay_followup_sent_at', null)
      .not('phone', 'is', null)
      .gte('intent_confirmed_at', windowStart.toISOString())
      .lte('intent_confirmed_at', windowEnd.toISOString())
      .order('intent_confirmed_at', { ascending: true })
      .limit(MAX_SEND_PER_RUN)
      .select('id, phone, first_name')

    if (claimErr) {
      return new Response(JSON.stringify({ error: claimErr.message }), { status: 500 })
    }

    let sent = 0
    for (const p of profiles ?? []) {
      const phone = (p.phone as string | null | undefined)?.trim() ?? ''
      if (!phone) continue

      const content = buildMessage(p.first_name as string | null | undefined)

      try {
        const res = await fetch(SENDBLUE_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'sb-api-key-id': apiKeyId,
            'sb-api-secret-key': apiSecret,
          },
          body: JSON.stringify({ number: phone, content, from_number: conciergeNumber }),
        })

        if (res.ok) {
          sent++
        } else {
          // Release the claim so it can retry next run.
          await supabase.from('profiles').update({ jay_followup_sent_at: null }).eq('id', p.id as string)
        }
      } catch {
        await supabase.from('profiles').update({ jay_followup_sent_at: null }).eq('id', p.id as string)
      }
    }

    return new Response(JSON.stringify({ ok: true, claimed: (profiles ?? []).length, sent }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 })
  }
})
