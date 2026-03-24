// SMS cron: expire intros after Tuesday 9pm PT (Wednesday 04:00 UTC).
// Invoked by pg_cron. Requires SENDBLUE_API_KEY_ID, SENDBLUE_API_SECRET_KEY.

declare const Deno: { env: { get(key: string): string | undefined } }
// @ts-ignore Deno
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
// @ts-ignore Deno
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SENDBLUE_URL = 'https://api.sendblue.co/api/send-message'

const MS_24_H = 24 * 60 * 60 * 1000

function getCurrentBatchWeek(): string {
  const d = new Date()
  const day = d.getUTCDay()
  const date = d.getUTCDate()
  const diff = date - day + (day === 0 ? -6 : 1)
  const monday = new Date(d)
  monday.setUTCDate(diff)
  return monday.toISOString().slice(0, 10)
}

const MSG_OTHER_NO_RESPONSE = `They didn't respond to the Fika intro in time. We'll keep looking — we'll reach out when we find another good Fika intro for you.`
const MSG_YOU_NO_RESPONSE = (_nextMondayPhrase: string) =>
  `This intro offer expired — we didn't hear back in time. We'll reach out when we find another good Fika intro for you.`

function getNextMondayPhrase(): string {
  return 'next Monday'
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
    const batchWeek = getCurrentBatchWeek()

    const { data: matches } = await supabase
      .from('match_candidates')
      .select('id, user_a, user_b, scheduling_status, status')
      .eq('batch_week', batchWeek)
    const activeMatches =
      matches?.filter(
        (m: { scheduling_status: string | null; status: string | null }) =>
          m.status === 'active' && m.scheduling_status !== 'confirmed'
      ) ?? []
    if (!activeMatches.length) {
      return new Response(JSON.stringify({ ok: true, batch_week: batchWeek, notified: 0, expired: 0 }))
    }

    const matchIds = activeMatches.map((m) => m.id)
    const { data: states } = await supabase
      .from('sms_conversation_states')
      .select('match_id, user_id, state')
      .eq('batch_week', batchWeek)
      .in('match_id', matchIds)
      .not('match_id', 'is', null)

    const byMatch = new Map<string, { user_id: string; state: string }[]>()
    for (const row of states ?? []) {
      const list = byMatch.get(row.match_id) ?? []
      list.push({ user_id: row.user_id, state: row.state })
      byMatch.set(row.match_id, list)
    }

    const userIdsWaiting: string[] = []
    const userIdsNoResponse: string[] = []
    for (const m of activeMatches) {
      const rows = byMatch.get(m.id) ?? []
      const stateA = rows.find((r) => r.user_id === m.user_a)?.state
      const stateB = rows.find((r) => r.user_id === m.user_b)?.state
      const oneYesWaiting = stateA === 'yes_waiting' || stateB === 'yes_waiting'
      const otherMatchOffered = stateA === 'match_offered' || stateB === 'match_offered'
      if (oneYesWaiting && otherMatchOffered) {
        const waitingUserId = stateA === 'yes_waiting' ? m.user_a : m.user_b
        const noResponseUserId = stateA === 'match_offered' ? m.user_a : m.user_b
        userIdsWaiting.push(waitingUserId)
        userIdsNoResponse.push(noResponseUserId)
      } else if (stateA === 'match_offered' && stateB === 'match_offered') {
        userIdsNoResponse.push(m.user_a, m.user_b)
      }
    }

    const allNotifyIds = Array.from(new Set([...userIdsWaiting, ...userIdsNoResponse]))
    if (!allNotifyIds.length) {
      return new Response(JSON.stringify({ ok: true, batch_week: batchWeek, notified: 0, expired: activeMatches.length }))
    }

    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, phone')
      .in('id', allNotifyIds)
    const phoneBy = new Map<string, string>()
    for (const p of profiles ?? []) {
      if (p.phone?.trim()) phoneBy.set(p.id, (p.phone as string).trim())
    }

    let notified = 0
    let skipped_no_recent_inbound = 0

    for (const uid of userIdsWaiting) {
      const phone = phoneBy.get(uid)
      if (!phone) continue
      if (!(await hasInboundWithin24h(supabase, phone))) {
        skipped_no_recent_inbound++
        continue
      }
      const res = await fetch(SENDBLUE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'sb-api-key-id': apiKeyId,
          'sb-api-secret-key': apiSecret,
        },
        body: JSON.stringify({ number: phone, content: MSG_OTHER_NO_RESPONSE }),
      })
      if (res.ok) notified++
    }

    const nextMondayPhrase = getNextMondayPhrase()
    for (const uid of new Set(userIdsNoResponse)) {
      const phone = phoneBy.get(uid)
      if (!phone) continue
      if (!(await hasInboundWithin24h(supabase, phone))) {
        skipped_no_recent_inbound++
        continue
      }
      const res = await fetch(SENDBLUE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'sb-api-key-id': apiKeyId,
          'sb-api-secret-key': apiSecret,
        },
        body: JSON.stringify({ number: phone, content: MSG_YOU_NO_RESPONSE(nextMondayPhrase) }),
      })
      if (res.ok) notified++
    }

    for (const m of activeMatches) {
      await supabase.from('match_candidates').update({ scheduling_status: 'expired' }).eq('id', m.id)
      await supabase.from('sms_conversation_states').delete().eq('batch_week', batchWeek).eq('match_id', m.id)
    }

    return new Response(JSON.stringify({ ok: true, batch_week: batchWeek, notified, expired: activeMatches.length, skipped_no_recent_inbound }))
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 })
  }
})

