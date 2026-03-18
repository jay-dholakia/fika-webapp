// SMS cron: send match offer (intro) to users who have a new match_candidate.
// Invoked by pg_cron after replenish-matches. Requires SENDBLUE_API_KEY_ID, SENDBLUE_API_SECRET_KEY.

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

function ageFromBirthdate(birthdate: string | null): number | null {
  if (!birthdate) return null
  const date = new Date(birthdate)
  if (isNaN(date.getTime())) return null
  const today = new Date()
  let age = today.getFullYear() - date.getFullYear()
  const m = today.getMonth() - date.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < date.getDate())) age--
  return age >= 0 ? age : null
}

function buildMatchOfferMessage(params: {
  otherFirstName: string
  otherAge: number | null
  otherBio: string
  sharedInterests: string[]
  conversationThread: string
}): string {
  const { otherFirstName, otherAge, otherBio, sharedInterests, conversationThread } = params
  const ageLine = otherAge != null ? `${otherFirstName}, ${otherAge}` : otherFirstName
  let text = `I found someone you might enjoy meeting.\n\n${ageLine}\n${otherBio}\n\n`
  if (sharedInterests.length > 0) {
    text += `Shared interests:\n${sharedInterests.map((s: string) => `• ${s}`).join('\n')}\n\n`
  }
  text += `Potential conversation thread:\n${conversationThread}\n\nWould you like the introduction?\nReply YES or PASS`
  return text
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
      .select('id, user_a, user_b, reasons, status')
      .eq('batch_week', batchWeek)
      .eq('status', 'active')

    const { data: alreadyOffered } = await supabase
      .from('sms_conversation_states')
      .select('match_id')
      .eq('batch_week', batchWeek)
      .eq('state', 'match_offered')
    const offeredSet = new Set((alreadyOffered ?? []).map((r: { match_id: string }) => r.match_id))

    let sent = 0
    let skipped_no_recent_inbound = 0
    for (const match of matches ?? []) {
      if (offeredSet.has(match.id)) continue
      const reasons = (match.reasons as Record<string, unknown>) ?? {}
      const sharedInterests = (reasons.shared_interests as string[]) ?? []
      const hooks = (reasons.conversation_hooks as string[]) ?? []
      const conversationThread = (hooks[0] as string) ?? 'What you both have in common.'

      for (const userId of [match.user_a, match.user_b]) {
        const otherId = userId === match.user_a ? match.user_b : match.user_a
        const { data: otherProfile } = await supabase
          .from('profiles')
          .select('first_name, birthdate, bio_text')
          .eq('id', otherId)
          .single()
        const { data: myProfile } = await supabase
          .from('profiles')
          .select('phone')
          .eq('id', userId)
          .single()
        if (!myProfile?.phone?.trim()) continue
        const phone = (myProfile.phone as string).trim()
        const okToSend = await hasInboundWithin24h(supabase, phone)
        if (!okToSend) {
          skipped_no_recent_inbound++
          continue
        }
        const otherFirstName = otherProfile?.first_name?.trim() ?? 'Someone'
        const otherAge = ageFromBirthdate(otherProfile?.birthdate ?? null)
        const otherBio = (otherProfile?.bio_text as string)?.trim()
          ? (otherProfile.bio_text as string).slice(0, 120) + ((otherProfile.bio_text as string).length > 120 ? '…' : '')
          : 'Looking forward to a good conversation.'
        const message = buildMatchOfferMessage({
          otherFirstName,
          otherAge,
          otherBio,
          sharedInterests: sharedInterests.slice(0, 3),
          conversationThread,
        })
        const res = await fetch(SENDBLUE_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'sb-api-key-id': apiKeyId,
            'sb-api-secret-key': apiSecret,
          },
          body: JSON.stringify({
            number: phone,
            content: message,
          }),
        })
        if (res.ok) {
          sent++
          await supabase.from('sms_conversation_states').upsert(
            {
              user_id: userId,
              batch_week: batchWeek,
              match_id: match.id,
              state: 'match_offered',
              payload: {},
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'user_id,batch_week,match_id' }
          )
        }
      }
      offeredSet.add(match.id)
    }
    return new Response(JSON.stringify({ ok: true, batch_week: batchWeek, sent, skipped_no_recent_inbound }))
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 })
  }
})
