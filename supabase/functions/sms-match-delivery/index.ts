// Send match offer (intro) to users who have a new match_candidate.
// Can be invoked by admin/event-driven flows or scheduled jobs. Requires SENDBLUE_API_KEY_ID, SENDBLUE_API_SECRET_KEY.

declare const Deno: { env: { get(key: string): string | undefined } }
// @ts-ignore Deno
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
// @ts-ignore Deno
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { fetchUserIdsWithUpcomingConfirmedFika } from '../_shared/upcoming-confirmed-fika.ts'

const SENDBLUE_URL = 'https://api.sendblue.co/api/send-message'
const SMS_PACING_MS = {
  quickAck: 1200,
  beat: 1800,
  context: 2200,
  reflective: 2600,
  media: 2000,
} as const

type OfferSequenceMessage = {
  content: string
  mediaUrl?: string | null
  delayAfterMs?: number
}

type MatchUserLocation = {
  city?: string | null
  lat?: number | null
  lng?: number | null
}

function formatInterestTeaser(sharedInterests: string[]): string | null {
  const cleaned = sharedInterests.map((s) => String(s).trim()).filter(Boolean).slice(0, 2)
  if (cleaned.length === 0) return null
  if (cleaned.length === 1) return cleaned[0]
  return `${cleaned[0]} + ${cleaned[1]}`
}

function normalizeConversationTopic(topic: string): string | null {
  const trimmed = topic.trim().replace(/\.$/, '')
  if (!trimmed) return null
  return trimmed.charAt(0).toLowerCase() + trimmed.slice(1)
}

function buildSharedContextSentence(params: {
  otherFirstName: string
  sharedInterests: string[]
  conversationHooks: string[]
}): string {
  const interestTeaser = formatInterestTeaser(params.sharedInterests)
  const topicTeaser = params.conversationHooks
    .map((topic) => normalizeConversationTopic(topic))
    .filter((topic): topic is string => Boolean(topic))
    .slice(0, 3)

  if (interestTeaser && topicTeaser.length > 0) {
    const topicText =
      topicTeaser.length === 1
        ? topicTeaser[0]
        : topicTeaser.length === 2
          ? `${topicTeaser[0]} and ${topicTeaser[1]}`
          : `${topicTeaser[0]}, ${topicTeaser[1]}, and ${topicTeaser[2]}`
    return `Meet ${params.otherFirstName}. You’re both into ${interestTeaser}, and both like talking about ${topicText}.`
  }
  if (interestTeaser) {
    return `Meet ${params.otherFirstName}. You’re both into ${interestTeaser}.`
  }
  if (topicTeaser.length > 0) {
    const topicText =
      topicTeaser.length === 1
        ? topicTeaser[0]
        : topicTeaser.length === 2
          ? `${topicTeaser[0]} and ${topicTeaser[1]}`
          : `${topicTeaser[0]}, ${topicTeaser[1]}, and ${topicTeaser[2]}`
    return `Meet ${params.otherFirstName}. You both like talking about ${topicText}.`
  }
  return `Meet ${params.otherFirstName}.`
}

function hasValidLatLng(user: MatchUserLocation): boolean {
  const lat = typeof user.lat === 'number' ? user.lat : Number.NaN
  const lng = typeof user.lng === 'number' ? user.lng : Number.NaN
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

async function pickIntroVenuePreview(
  supabase: any,
  userA: MatchUserLocation,
  userB: MatchUserLocation
): Promise<{ id: string; name: string; neighborhood: string | null; city: string } | null> {
  if (!hasValidLatLng(userA) || !hasValidLatLng(userB)) return null
  const { data: venues } = await supabase
    .from('venues')
    .select('id, name, neighborhood, city, lat, lng')
    .eq('google_permanently_closed', false)
    .not('lat', 'is', null)
    .not('lng', 'is', null)

  const venueRows = Array.isArray(venues) ? venues : []
  let best: { id: string; name: string; neighborhood: string | null; city: string; score: number } | null = null
  for (const venue of venueRows) {
    const lat = typeof venue.lat === 'number' ? venue.lat : Number(venue.lat)
    const lng = typeof venue.lng === 'number' ? venue.lng : Number(venue.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
    const distA = haversineKm(Number(userA.lat), Number(userA.lng), lat, lng)
    const distB = haversineKm(Number(userB.lat), Number(userB.lng), lat, lng)
    const score = Math.max(distA, distB)
    if (!best || score < best.score) {
      best = {
        id: venue.id as string,
        name: venue.name as string,
        neighborhood: (venue.neighborhood as string | null) ?? null,
        city: venue.city as string,
        score,
      }
    }
  }
  if (!best) return null
  return {
    id: best.id,
    name: best.name,
    neighborhood: best.neighborhood,
    city: best.city,
  }
}

function buildSampleOfferSequence(params: {
  otherFirstName: string
  sharedInterests: string[]
  conversationHooks: string[]
  venuePreview?: { name: string; neighborhood: string | null; city: string } | null
  introCardUrl?: string | null
}): OfferSequenceMessage[] {
  const firstLine = buildSharedContextSentence({
    otherFirstName: params.otherFirstName,
    sharedInterests: params.sharedInterests,
    conversationHooks: params.conversationHooks,
  })
  const venueName = params.venuePreview?.name?.trim()
  const venueArea = params.venuePreview?.neighborhood?.trim() || params.venuePreview?.city?.trim() || ''
  const venueLine = venueName
    ? `It looks like ${venueArea ? `${venueName} in ${venueArea}` : venueName} is a good middle spot.`
    : null

  const steps: OfferSequenceMessage[] = []
  if (params.introCardUrl?.trim()) {
    steps.push({ content: ' ', mediaUrl: params.introCardUrl.trim(), delayAfterMs: SMS_PACING_MS.media })
  }
  steps.push({ content: firstLine, delayAfterMs: SMS_PACING_MS.beat })
  if (venueLine) {
    steps.push({ content: venueLine, delayAfterMs: SMS_PACING_MS.beat })
  }
  steps.push(
    { content: 'Want to meet this week?', delayAfterMs: SMS_PACING_MS.context },
    { content: 'Send me a 👍 if you’re in. Or reply PASS.' }
  )
  return steps
}

async function sendSendblueMessage(params: {
  apiKeyId: string
  apiSecret: string
  phone: string
  content: string
  mediaUrl?: string | null
}): Promise<Response> {
  const { apiKeyId, apiSecret, phone, content, mediaUrl } = params
  return fetch(SENDBLUE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'sb-api-key-id': apiKeyId,
      'sb-api-secret-key': apiSecret,
    },
    body: JSON.stringify({
      number: phone,
      content,
      ...(mediaUrl?.trim() ? { media_url: mediaUrl.trim() } : {}),
    }),
  })
}

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

function buildIntroCardUrl(params: {
  appBase: string
  avatarUrl: string | null
  firstName: string | null
  age: number | null
}): string | null {
  const avatarUrl = params.avatarUrl?.trim()
  if (!avatarUrl) return null
  const base = params.appBase.trim().replace(/\/$/, '') || 'https://letsfika.vercel.app'
  const url = new URL('/api/intro-card', base)
  url.searchParams.set('avatar', avatarUrl)
  if (params.firstName?.trim()) url.searchParams.set('name', params.firstName.trim())
  if (params.age != null) url.searchParams.set('age', String(params.age))
  return url.toString()
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
    const appBase = (Deno.env.get('APP_CANONICAL_URL') ?? '').trim().replace(/\/$/, '') || 'https://letsfika.vercel.app'
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
      const conversationHooks = (reasons.conversation_hooks as string[]) ?? []
      const { data: profileRows } = await supabase
        .from('profiles')
        .select('id, city, lat, lng')
        .in('id', [match.user_a, match.user_b])
      const userALocation = (profileRows ?? []).find((row: { id: string }) => row.id === match.user_a) ?? null
      const userBLocation = (profileRows ?? []).find((row: { id: string }) => row.id === match.user_b) ?? null
      const introVenuePreview = userALocation && userBLocation
        ? await pickIntroVenuePreview(supabase, userALocation, userBLocation)
        : null
      for (const userId of [match.user_a, match.user_b]) {
        if (blockedFromNewIntro.has(userId)) {
          skipped_upcoming_confirmed_fika++
          continue
        }
        const otherId = userId === match.user_a ? match.user_b : match.user_a
        const { data: otherProfile } = await supabase
          .from('profiles')
          .select('first_name, birthdate, bio_text, city, avatar_url')
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
        const otherAvatarUrl = (otherProfile?.avatar_url as string | null | undefined)?.trim() ?? null
        const otherIntroCardUrl = buildIntroCardUrl({
          appBase,
          avatarUrl: otherAvatarUrl,
          firstName: otherFirstName,
          age: otherAge,
        })
        const offerSequence = buildSampleOfferSequence({
          otherFirstName,
          sharedInterests: sharedInterests.slice(0, 3),
          conversationHooks,
          venuePreview: introVenuePreview,
          introCardUrl: otherIntroCardUrl,
        })
        let sequenceStarted = false
        for (let i = 0; i < offerSequence.length; i++) {
          const step = offerSequence[i]
          const res = await sendSendblueMessage({
            apiKeyId,
            apiSecret,
            phone,
            content: step.content,
            mediaUrl: step.mediaUrl ?? null,
          })
          if (!res.ok) {
            const errText = await res.text().catch(() => '')
            console.error('[sms-match-delivery] sample offer send failed', {
              userId,
              otherId,
              matchId: match.id,
              stepIndex: i,
              status: res.status,
              errText,
            })
            break
          }
          if (!sequenceStarted) {
            sequenceStarted = true
            sent++
            if (isOutside24h) sent_outside_24h++
            await setMatchOfferedState({
              supabase,
              userId,
              weekAnchorMonday,
              matchId: match.id,
              payload: {
                protocol_version: 'v2',
                phase: 'offer',
                ...(introVenuePreview?.id ? { intro_preview_venue_id: introVenuePreview.id } : {}),
              },
            })
          }
          if (i < offerSequence.length - 1) {
            await new Promise((r) => setTimeout(r, step.delayAfterMs ?? SMS_PACING_MS.quickAck))
          }
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
