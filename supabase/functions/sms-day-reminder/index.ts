// SMS cron: day-of reminder for confirmed Fikas today.
// Invoked by pg_cron. Requires SENDBLUE_API_KEY_ID, SENDBLUE_API_SECRET_KEY.

declare const Deno: { env: { get(key: string): string | undefined } }
// @ts-ignore Deno
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
// @ts-ignore Deno
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SENDBLUE_URL = 'https://api.sendblue.co/api/send-message'

function buildReminderMessage(time: string, venueName: string, neighborhood: string, starter?: string): string {
  let text = `Your Fika conversation is today at ${time} at ${venueName} (${neighborhood}).\n\nHope you both enjoy it.`
  if (starter) text += `\n\nOne question you might enjoy exploring:\n${starter}`
  return text
}

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
    const today = new Date().toISOString().slice(0, 10)
    const { data: matches } = await supabase
      .from('match_candidates')
      .select('id, user_a, user_b, confirmed_at, confirmed_venue_id, reasons')
      .eq('scheduling_status', 'confirmed')
      .not('confirmed_venue_id', 'is', null)
    const todayMatches = (matches ?? []).filter((m: { confirmed_at: string | null }) =>
      m.confirmed_at && m.confirmed_at.startsWith(today)
    )

    let sent = 0
    for (const match of todayMatches) {
      const { data: venue } = await supabase
        .from('venues')
        .select('name, neighborhood, city')
        .eq('id', match.confirmed_venue_id)
        .single()
      const venueName = venue?.name ?? 'the spot'
      const neighborhood = venue?.neighborhood ?? venue?.city ?? ''
      const reasons = (match.reasons as Record<string, unknown>) ?? {}
      const hooks = (reasons.conversation_hooks as string[]) ?? []
      const starter = hooks[0] as string | undefined
      const timeStr = '7pm'

      for (const userId of [match.user_a, match.user_b]) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('phone')
          .eq('id', userId)
          .single()
        if (!profile?.phone?.trim()) continue
        const message = buildReminderMessage(timeStr, venueName, neighborhood, starter)
        const res = await fetch(SENDBLUE_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'sb-api-key-id': apiKeyId,
            'sb-api-secret-key': apiSecret,
          },
          body: JSON.stringify({
            number: (profile.phone as string).trim(),
            content: message,
          }),
        })
        if (res.ok) sent++
      }
    }
    return new Response(JSON.stringify({ ok: true, date: today, sent }))
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 })
  }
})
