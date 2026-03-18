// SMS cron: onboarding reminder (3 hours since last update)
// Invoked by pg_cron every 30 minutes.
// Requires SENDBLUE_API_KEY_ID, SENDBLUE_API_SECRET_KEY.

declare const Deno: { env: { get(key: string): string | undefined } }

// @ts-ignore Deno
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
// @ts-ignore Deno
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SENDBLUE_URL = 'https://api.sendblue.co/api/send-message'

const MAX_SEND_PER_RUN = 50

const MS_24_H = 24 * 60 * 60 * 1000

function getAppBase(): string {
  const fromEnv = (Deno.env.get('APP_CANONICAL_URL') ?? '').trim()
  return fromEnv || 'https://letsfika.vercel.app'
}

async function hasInboundWithin24h(supabase: any, phone: string): Promise<boolean> {
  const { data } = await supabase
    .from('message_ledger')
    .select('created_at')
    .eq('direction', 'inbound')
    .eq('peer_phone', phone)
    .order('created_at', { ascending: false })
    .limit(1)
  const ts = (data?.[0]?.created_at as string | undefined) ?? null
  if (!ts) return false
  const last = new Date(ts).getTime()
  return Number.isFinite(last) && Date.now() - last <= MS_24_H
}

function buildReminderContent(link: string): string {
  // Link on its own line so it's easy to tap/copy in SMS clients.
  return `Don’t forget—finish onboarding so we can start intro’ing you to Fikas.\n${link}`
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
    if (!apiKeyId || !apiSecret) {
      return new Response(JSON.stringify({ error: 'Sendblue not configured' }), { status: 503 })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const now = new Date()
    const threshold = new Date(now.getTime() - 3 * 60 * 60 * 1000)

    // Claim rows (set reminder_sent_at) so concurrent cron runs don't double-send.
    const { data: sessions, error: claimErr } = await supabase
      .from('onboarding_sessions')
      .update({ reminder_sent_at: now.toISOString() })
      .is('merged_into_user_id', null)
      .is('reminder_sent_at', null)
      .lte('updated_at', threshold.toISOString())
      .not('phone', 'is', null)
      .order('updated_at', { ascending: true })
      .limit(MAX_SEND_PER_RUN)
      .select('id, phone, token')

    if (claimErr) {
      return new Response(JSON.stringify({ error: claimErr.message }), { status: 500 })
    }

    const appBase = getAppBase()

    let sent = 0
    let skipped_no_recent_inbound = 0
    for (const s of sessions ?? []) {
      const phone = (s.phone as string | null | undefined)?.trim() ?? ''
      if (!phone) continue
      const okToSend = await hasInboundWithin24h(supabase, phone)
      if (!okToSend) {
        skipped_no_recent_inbound++
        // Let it be eligible again if they text in later.
        await supabase.from('onboarding_sessions').update({ reminder_sent_at: null }).eq('id', s.id as string)
        continue
      }
      const link = `${appBase}/signup?token=${encodeURIComponent(s.token as string)}`
      const content = buildReminderContent(link)

      try {
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
          sent++
        } else {
          // Allow retries next run if the send failed.
          await supabase.from('onboarding_sessions').update({ reminder_sent_at: null }).eq('id', s.id as string)
        }
      } catch {
        // Allow retries next run if the send threw.
        await supabase.from('onboarding_sessions').update({ reminder_sent_at: null }).eq('id', s.id as string)
      }
    }

    return new Response(JSON.stringify({ ok: true, claimed: (sessions ?? []).length, sent, skipped_no_recent_inbound }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 })
  }
})

