// Send match offer (intro) to users who have a new match_candidate.
// Can be invoked by admin/event-driven flows or scheduled jobs. Requires SENDBLUE_API_KEY_ID, SENDBLUE_API_SECRET_KEY.

declare const Deno: { env: { get(key: string): string | undefined } }
// @ts-ignore Deno
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
// @ts-ignore Deno
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { fetchUserIdsWithUpcomingConfirmedFika } from '../_shared/upcoming-confirmed-fika.ts'

const SENDBLUE_URL = 'https://api.sendblue.co/api/send-message'
const SIMPLE_OFFER_MESSAGE =
  "We found a strong Fika intro for you — want us to set it up?\n\nReply YES or PASS."

const MS_24_H = 24 * 60 * 60 * 1000
const MAX_SENDS_OUTSIDE_24H = 200

function getCurrentWeekAnchorMonday(): string {
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
  otherCity: string | null
  otherBio: string
  sharedInterests: string[]
  conversationThread: string
}): string {
  const { otherFirstName, otherAge, otherCity, otherBio, sharedInterests, conversationThread } = params
  const cityPart = otherCity?.trim() ? ` · ${otherCity.trim()}` : ''
  const agePart = otherAge != null ? `, ${otherAge}` : ''
  const whoLine = `${otherFirstName}${agePart}${cityPart}`

  let text =
    `We have a Fika intro lined up for you — it's for this one person, ${otherFirstName}, not a general pool.\n\n`
  text += `${whoLine}\n${otherBio}\n\n`
  if (sharedInterests.length > 0) {
    text += `You both share:\n${sharedInterests.map((s: string) => `• ${s}`).join('\n')}\n\n`
  }
  text += `Something to talk about:\n${conversationThread}\n\n`
  text += `Reply YES if you want to meet ${otherFirstName}, or PASS to skip this match (just this person).`
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

function isDuplicateKeyError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code
  const message = (error as { message?: string } | null)?.message ?? ''
  return code === '23505' || message.toLowerCase().includes('duplicate key')
}

async function setMatchOfferedState(params: {
  supabase: any
  userId: string
  weekAnchorMonday: string
  matchId: string
  payload: Record<string, unknown>
}): Promise<void> {
  const { supabase, userId, weekAnchorMonday, matchId, payload } = params
  const updatedAt = new Date().toISOString()
  const baseRow = {
    user_id: userId,
    week_anchor_monday: weekAnchorMonday,
    match_id: matchId,
    state: 'match_offered',
    payload,
    updated_at: updatedAt,
  }

  const { data: updatedRows, error: updateError } = await supabase
    .from('sms_conversation_states')
    .update({
      state: 'match_offered',
      payload,
      updated_at: updatedAt,
    })
    .eq('user_id', userId)
    .eq('week_anchor_monday', weekAnchorMonday)
    .eq('match_id', matchId)
    .select('id')
    .limit(1)

  if (updateError) {
    console.error('[sms-match-delivery] state update failed', {
      userId,
      weekAnchorMonday,
      matchId,
      error: updateError,
    })
    return
  }
  if ((updatedRows ?? []).length > 0) return

  const { error: insertError } = await supabase.from('sms_conversation_states').insert(baseRow)
  if (!insertError) return
  if (!isDuplicateKeyError(insertError)) {
    console.error('[sms-match-delivery] state insert failed', {
      userId,
      weekAnchorMonday,
      matchId,
      error: insertError,
    })
    return
  }

  const { error: retryUpdateError } = await supabase
    .from('sms_conversation_states')
    .update({
      state: 'match_offered',
      payload,
      updated_at: updatedAt,
    })
    .eq('user_id', userId)
    .eq('week_anchor_monday', weekAnchorMonday)
    .eq('match_id', matchId)
  if (retryUpdateError) {
    console.error('[sms-match-delivery] retry state update failed', {
      userId,
      weekAnchorMonday,
      matchId,
      error: retryUpdateError,
    })
  }
}

serve(async (req: Request) => {
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
    const weekAnchorMonday = getCurrentWeekAnchorMonday()
    const v2SimpleOffer = Deno.env.get('SMS_PROTOCOL_V2_SIMPLE_OFFER') === 'true'
    const body = await req.json().catch(() => ({}))
    const requestedIds = Array.isArray(body?.match_ids)
      ? (body.match_ids as unknown[]).filter((x) => typeof x === 'string' && x.trim().length > 0) as string[]
      : []

    let matchesQuery = supabase
      .from('match_candidates')
      .select('id, user_a, user_b, reasons, status')
      .eq('week_anchor_monday', weekAnchorMonday)
      .eq('status', 'active')
    if (requestedIds.length > 0) {
      matchesQuery = matchesQuery.in('id', requestedIds)
    }
    const { data: matches } = await matchesQuery

    const { data: alreadyOffered } = await supabase
      .from('sms_conversation_states')
      .select('match_id')
      .eq('week_anchor_monday', weekAnchorMonday)
      .eq('state', 'match_offered')
    const offeredSet = new Set((alreadyOffered ?? []).map((r: { match_id: string }) => r.match_id))

    const blockedFromNewIntro = await fetchUserIdsWithUpcomingConfirmedFika(supabase)

    let sent = 0
    let skipped_no_recent_inbound = 0
    let sent_outside_24h = 0
    let skipped_outside_24h_cap = 0
    let skipped_not_in_requested = 0
    let skipped_upcoming_confirmed_fika = 0
    for (const match of matches ?? []) {
      if (requestedIds.length > 0 && !requestedIds.includes(match.id)) {
        skipped_not_in_requested++
        continue
      }
      if (offeredSet.has(match.id)) continue
      const reasons = (match.reasons as Record<string, unknown>) ?? {}
      const sharedInterests = (reasons.shared_interests as string[]) ?? []
      const hooks = (reasons.conversation_hooks as string[]) ?? []
      const conversationThread = (hooks[0] as string) ?? 'What you both have in common.'

      for (const userId of [match.user_a, match.user_b]) {
        if (blockedFromNewIntro.has(userId)) {
          skipped_upcoming_confirmed_fika++
          continue
        }
        const otherId = userId === match.user_a ? match.user_b : match.user_a
        const { data: otherProfile } = await supabase
          .from('profiles')
          .select('first_name, birthdate, bio_text, city')
          .eq('id', otherId)
          .single()
        const { data: myProfile } = await supabase
          .from('profiles')
          .select('phone')
          .eq('id', userId)
          .single()
        if (!myProfile?.phone?.trim()) continue
        const phone = (myProfile.phone as string).trim()
        const hasRecentInbound = await hasInboundWithin24h(supabase, phone)
        const isOutside24h = !hasRecentInbound
        if (isOutside24h && sent_outside_24h >= MAX_SENDS_OUTSIDE_24H) {
          skipped_no_recent_inbound++
          skipped_outside_24h_cap++
          continue
        }
        const otherFirstName = otherProfile?.first_name?.trim() ?? 'Someone'
        const otherAge = ageFromBirthdate(otherProfile?.birthdate ?? null)
        const otherBio = (otherProfile?.bio_text as string)?.trim()
          ? (otherProfile.bio_text as string).slice(0, 120) + ((otherProfile.bio_text as string).length > 120 ? '…' : '')
          : 'Looking forward to a good conversation.'
        const message = v2SimpleOffer
          ? SIMPLE_OFFER_MESSAGE
          : buildMatchOfferMessage({
              otherFirstName,
              otherAge,
              otherCity: (otherProfile?.city as string | null) ?? null,
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
          if (isOutside24h) sent_outside_24h++
          await setMatchOfferedState({
            supabase,
            userId,
            weekAnchorMonday,
            matchId: match.id,
            payload: v2SimpleOffer
              ? {
                  protocol_version: 'v2',
                  phase: 'offer',
                }
              : {},
          })
        }
      }
      offeredSet.add(match.id)
    }
    return new Response(
      JSON.stringify({
        ok: true,
        week_anchor_monday: weekAnchorMonday,
        sent,
        requested: requestedIds.length,
        sent_outside_24h,
        skipped_no_recent_inbound,
        skipped_outside_24h_cap,
        skipped_not_in_requested,
        skipped_upcoming_confirmed_fika,
      })
    )
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 })
  }
})
