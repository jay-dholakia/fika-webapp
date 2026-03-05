// SMS cron: ~2 hours after Fika — ask how it went and for feedback.
// Invoked by pg_cron every hour. Requires SENDBLUE_API_KEY_ID, SENDBLUE_API_SECRET_KEY.

declare const Deno: { env: { get(key: string): string | undefined } }
// @ts-ignore Deno
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
// @ts-ignore Deno
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SENDBLUE_URL = 'https://api.sendblue.co/api/send-message'

const DAY_OFFSET: Record<string, number> = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 }

/** Fika datetime (PT) from batch_week (Monday YYYY-MM-DD) + slotId (e.g. wed_14_30). Uses PST (-08:00). */
function getFikaTimeMs(batchWeek: string, slotId: string): number | null {
  const monday = new Date(batchWeek + 'T12:00:00Z')
  const prefix = slotId.slice(0, 3).toLowerCase()
  const offset = DAY_OFFSET[prefix] ?? 2
  monday.setUTCDate(monday.getUTCDate() + offset)
  const dateStr = monday.toISOString().slice(0, 10)
  const parts = slotId.split('_')
  const hour = parseInt(parts[1] ?? '14', 10)
  const min = parseInt(parts[2] ?? '0', 10)
  const iso = `${dateStr}T${hour.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}:00-08:00`
  const d = new Date(iso)
  return isNaN(d.getTime()) ? null : d.getTime()
}

const MS_1_5_H = 1.5 * 60 * 60 * 1000
const MS_2_5_H = 2.5 * 60 * 60 * 1000

const POST_FIKA_MESSAGE =
  "How did your Fika go? We'd love any feedback to help us set up future Fikas — just reply to this message."

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
    const now = Date.now()
    const { data: matches } = await supabase
      .from('match_candidates')
      .select('id, user_a, user_b, batch_week, confirmed_slot_id, post_fika_sent_at')
      .eq('scheduling_status', 'confirmed')
      .not('confirmed_slot_id', 'is', null)
      .not('batch_week', 'is', null)
      .is('post_fika_sent_at', null)

    const toSend: { id: string; userIds: string[] }[] = []
    for (const m of matches ?? []) {
      const fikaMs = getFikaTimeMs(m.batch_week, m.confirmed_slot_id)
      if (fikaMs == null) continue
      const elapsed = now - fikaMs
      if (elapsed >= MS_1_5_H && elapsed <= MS_2_5_H) {
        toSend.push({ id: m.id, userIds: [m.user_a, m.user_b] })
      }
    }

    let sent = 0
    for (const item of toSend) {
      for (const userId of item.userIds) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('phone')
          .eq('id', userId)
          .single()
        if (!profile?.phone?.trim()) continue
        const res = await fetch(SENDBLUE_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'sb-api-key-id': apiKeyId,
            'sb-api-secret-key': apiSecret,
          },
          body: JSON.stringify({
            number: (profile.phone as string).trim(),
            content: POST_FIKA_MESSAGE,
          }),
        })
        if (res.ok) sent++
      }
      await supabase
        .from('match_candidates')
        .update({ post_fika_sent_at: new Date().toISOString() })
        .eq('id', item.id)
    }
    return new Response(JSON.stringify({ ok: true, sent, matches_processed: toSend.length }))
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 })
  }
})
