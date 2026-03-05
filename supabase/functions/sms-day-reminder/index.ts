// SMS cron: day-of reminder for confirmed Fikas today.
// Uses PT "today" and real time from batch_week + confirmed_slot_id (same as 3h reminder).
// Invoked by pg_cron. Requires SENDBLUE_API_KEY_ID, SENDBLUE_API_SECRET_KEY.

declare const Deno: { env: { get(key: string): string | undefined } }
// @ts-ignore Deno
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
// @ts-ignore Deno
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SENDBLUE_URL = 'https://api.sendblue.co/api/send-message'

const DAY_OFFSET: Record<string, number> = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 }

/** Today (YYYY-MM-DD) in America/Los_Angeles. */
function getTodayPT(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
}

/** Fika date (YYYY-MM-DD) from batch_week (Monday) + slotId (e.g. wed_14_30). */
function getFikaDateFromSlot(batchWeek: string, slotId: string): string {
  const monday = new Date(batchWeek + 'T12:00:00Z')
  const prefix = slotId.slice(0, 3).toLowerCase()
  const offset = DAY_OFFSET[prefix] ?? 2
  monday.setUTCDate(monday.getUTCDate() + offset)
  return monday.toISOString().slice(0, 10)
}

/** Display time from slotId e.g. wed_14_30 -> "2:30pm". */
function slotToTimeStr(slotId: string): string {
  const parts = slotId.split('_')
  const hour = parseInt(parts[1] ?? '14', 10)
  const min = parseInt(parts[2] ?? '0', 10)
  const period = hour >= 12 ? 'pm' : 'am'
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour
  return min === 0 ? `${h12}${period}` : `${h12}:${min.toString().padStart(2, '0')}${period}`
}

function buildReminderMessage(time: string, venueName: string, neighborhood: string, starter?: string): string {
  let text = `Your Fika is today at ${time} at ${venueName} (${neighborhood}). We'll text you closer to the time with more details — and you can update your intro if you're running late.\n\nHope you both have a great conversation!`
  if (starter) text += `\n\nA question you might enjoy:\n${starter}`
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
    const todayPT = getTodayPT()
    const { data: matches } = await supabase
      .from('match_candidates')
      .select('id, user_a, user_b, batch_week, confirmed_slot_id, confirmed_venue_id, reasons')
      .eq('scheduling_status', 'confirmed')
      .not('confirmed_venue_id', 'is', null)
    const todayMatches = (matches ?? []).filter(
      (m: { batch_week: string | null; confirmed_slot_id: string | null }) =>
        m.batch_week && m.confirmed_slot_id && getFikaDateFromSlot(m.batch_week, m.confirmed_slot_id) === todayPT
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
      const timeStr = slotToTimeStr(match.confirmed_slot_id)

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
    return new Response(JSON.stringify({ ok: true, date: todayPT, sent }))
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 })
  }
})
