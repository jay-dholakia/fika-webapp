// Send match offer (intro) to users who have a new match_candidate.
// Can be invoked by admin/event-driven flows or scheduled jobs. Requires SENDBLUE_API_KEY_ID, SENDBLUE_API_SECRET_KEY.

declare const Deno: { env: { get(key: string): string | undefined } }
// @ts-ignore Deno
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
// @ts-ignore Deno
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { fetchUserIdsBlockedFromNewIntro } from '../_shared/intro-eligibility.ts'

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

type RevealCopyBits = {
  otherFirstName: string
  otherWorkLabel: string | null
  sharedInterests: string[]
}

function buildSocialRevealLine2(bits: RevealCopyBits): string {
  const interests = bits.sharedInterests.filter(Boolean).slice(0, 2)
  const interestsLabel = interests.length > 0 ? ` who loves ${interests.join(' + ')}` : ''
  const work = bits.otherWorkLabel?.trim()
  const workLabel = work ? `a ${work}` : 'someone'
  const overlap = interests.length > 0 ? `You both like talking about recent wins + local spots.` : `You both like talking about recent wins + local spots.`
  return `${bits.otherFirstName} is ${workLabel}${interestsLabel}. ${overlap}`
}

function formatLocalShort(utcIso: string, ianaTz: string): string {
  const d = new Date(utcIso)
  if (Number.isNaN(d.getTime())) return utcIso
  return new Intl.DateTimeFormat('en-US', {
    timeZone: ianaTz,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d)
}

function buildSocialRevealLine1(params: { firstName?: string | null; whenLocal: string; venueName: string; otherName: string }) {
  const name = params.firstName?.trim()
  const who = name ? `Hey ${name}` : 'Hey'
  return `${who} — for your Fika Social today at ${params.whenLocal} at ${params.venueName}, you’ll be meeting ${params.otherName}.`
}

function buildSocialRevealCta(): string {
  return `React 👍 to this message to confirm you’re all set.`
}

function buildRevealPrompt(firstName: string | null | undefined): string {
  const trimmed = firstName?.trim()
  if (trimmed) {
    return `Hey ${trimmed} - we found a good Fika intro for you. Want to see it? Reply Yes or No.`
  }
  return 'We found a good Fika intro for you. Want to see it? Reply Yes or No.'
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
  firstName?: string | null
}): OfferSequenceMessage[] {
  return [{ content: buildRevealPrompt(params.firstName), delayAfterMs: SMS_PACING_MS.quickAck }]
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

  const { data: existing } = await supabase
    .from('sms_conversation_states')
    .select('intro_offer_sent_at')
    .eq('user_id', userId)
    .eq('week_anchor_monday', weekAnchorMonday)
    .eq('match_id', matchId)
    .maybeSingle()

  const introOfferSentAt =
    existing?.intro_offer_sent_at != null ? existing.intro_offer_sent_at : updatedAt

  const baseRow = {
    user_id: userId,
    week_anchor_monday: weekAnchorMonday,
    match_id: matchId,
    state: 'match_offered',
    payload,
    updated_at: updatedAt,
    intro_offer_sent_at: introOfferSentAt,
  }

  const { data: updatedRows, error: updateError } = await supabase
    .from('sms_conversation_states')
    .update({
      state: 'match_offered',
      payload,
      updated_at: updatedAt,
      intro_offer_sent_at: introOfferSentAt,
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
      intro_offer_sent_at: introOfferSentAt,
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
      return new Response(JSON.stringify({ ok: false, error: 'SMS_OUTBOUND_DISABLED' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    const apiKeyId = Deno.env.get('SENDBLUE_API_KEY_ID')
    const apiSecret = Deno.env.get('SENDBLUE_API_SECRET_KEY')
    if (!apiKeyId || !apiSecret) {
      return new Response(JSON.stringify({ ok: false, error: 'Sendblue not configured' }), { status: 503 })
    }
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )
    const weekAnchorMonday = getCurrentWeekAnchorMonday()
    const body = await req.json().catch(() => ({}))
    const requestedIds = Array.isArray(body?.match_ids)
      ? (body.match_ids as unknown[]).filter((x) => typeof x === 'string' && x.trim().length > 0) as string[]
      : []

    // Bulk/cron (no match_ids): scope to this calendar week's anchor only.
    // Admin + Fika sweep pass explicit match_ids: rows use the *session* week_anchor_monday,
    // which may differ from "today's" Monday in UTC — do not filter by week when ids are provided.
    let matchesQuery = supabase
      .from('match_candidates')
      .select('id, user_a, user_b, reasons, status, fika_social_id, week_anchor_monday')
      .eq('status', 'active')
    if (requestedIds.length > 0) {
      matchesQuery = matchesQuery.in('id', requestedIds)
    } else {
      matchesQuery = matchesQuery.eq('week_anchor_monday', weekAnchorMonday)
    }
    const { data: matches } = await matchesQuery

    const { data: alreadyOffered } = await supabase
      .from('sms_conversation_states')
      .select('match_id')
      .eq('week_anchor_monday', weekAnchorMonday)
      .eq('state', 'match_offered')
    const offeredSet = new Set((alreadyOffered ?? []).map((r: { match_id: string }) => r.match_id))

    const blockedFromNewIntro = await fetchUserIdsBlockedFromNewIntro(supabase)

    let sent = 0
    let skipped_no_recent_inbound = 0
    let sent_outside_24h = 0
    let skipped_outside_24h_cap = 0
    let skipped_not_in_requested = 0
    let skipped_blocked_from_new_intro = 0
    for (const match of matches ?? []) {
      if (requestedIds.length > 0 && !requestedIds.includes(match.id)) {
        skipped_not_in_requested++
        continue
      }
      const stateWeek = String(
        (match as { week_anchor_monday?: string }).week_anchor_monday ?? weekAnchorMonday
      )
      // Only dedupe "already offered" for bulk runs; explicit match_ids = intentional resend path.
      if (requestedIds.length === 0 && offeredSet.has(match.id)) continue
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
          skipped_blocked_from_new_intro++
          continue
        }
        const otherId = userId === match.user_a ? match.user_b : match.user_a
        const { data: myProfile } = await supabase
          .from('profiles')
          .select('phone, first_name')
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
        const offerSequence = buildSampleOfferSequence({
          firstName: myProfile.first_name as string | null | undefined,
        })

        // Social Fika: at T−6h we send a single lightweight reveal (3 short texts) and await a 👍 reaction confirm.
        if (match.fika_social_id) {
          const otherId = userId === match.user_a ? match.user_b : match.user_a
          const { data: otherProfile } = await supabase
            .from('profiles')
            .select('first_name')
            .eq('id', otherId)
            .maybeSingle()
          const { data: otherIntakeRow } = await supabase
            .from('intake_responses_v5')
            .select('responses')
            .eq('user_id', otherId)
            .maybeSingle()

          const { data: social } = await supabase
            .from('fika_socials')
            .select('id, fika_starts_at, iana_tz, venues:venues(name)')
            .eq('id', match.fika_social_id)
            .maybeSingle()

          const otherName = otherProfile?.first_name?.trim() || 'Someone'
          const venueName = (social?.venues?.name as string | undefined)?.trim() || 'the venue'
          const tz = (social?.iana_tz as string | undefined)?.trim() || 'America/Los_Angeles'
          const whenLocal = social?.fika_starts_at ? formatLocalShort(String(social.fika_starts_at), tz) : 'today'

          const reasonsRoot = (match.reasons as Record<string, unknown>) ?? {}
          const rawReasons = ((reasonsRoot.raw as Record<string, unknown> | undefined) ?? reasonsRoot) as Record<string, unknown>
          const copyReasons = ((reasonsRoot.copy as Record<string, unknown> | undefined) ?? reasonsRoot) as Record<string, unknown>
          const sharedInterests =
            (copyReasons.shared_interests as string[]) ?? (rawReasons.shared_interests as string[]) ?? []
          const otherWorkLabel = (() => {
            const responses = (otherIntakeRow?.responses ?? null) as any
            const raw = responses?.q_work
            return typeof raw === 'string' ? raw : null
          })()

          const line1 = buildSocialRevealLine1({
            firstName: myProfile.first_name as string | null | undefined,
            whenLocal,
            venueName,
            otherName,
          })
          const line2 = buildSocialRevealLine2({
            otherFirstName: otherName,
            otherWorkLabel,
            sharedInterests,
          })
          const line3 = buildSocialRevealCta()

          const lines = [line1, line2, line3]
          let started = false
          for (let i = 0; i < lines.length; i++) {
            const res = await sendSendblueMessage({
              apiKeyId,
              apiSecret,
              phone,
              content: lines[i]!,
            })
            if (!res.ok) {
              const errText = await res.text().catch(() => '')
              console.error('[sms-match-delivery] social reveal send failed', {
                userId,
                otherId,
                matchId: match.id,
                stepIndex: i,
                status: res.status,
                errText,
              })
              break
            }
            if (!started) {
              started = true
              sent++
              if (isOutside24h) sent_outside_24h++
              await setMatchOfferedState({
                supabase,
                userId,
                weekAnchorMonday: stateWeek,
                matchId: match.id,
                payload: {
                  protocol_version: 'social_v1',
                  phase: 'social_revealed_waiting_confirm',
                  fika_social_id: match.fika_social_id,
                },
              })
            }
            if (i < lines.length - 1) {
              await new Promise((r) => setTimeout(r, SMS_PACING_MS.beat))
            }
          }
          continue
        }

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
              weekAnchorMonday: stateWeek,
              matchId: match.id,
              payload: {
                protocol_version: 'v2',
                phase: 'reveal_pending',
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

    if (requestedIds.length > 0 && sent === 0) {
      return new Response(
        JSON.stringify({
          ok: false,
          error:
            'No SMS segments sent for the requested match_ids (see skipped_* counts: wrong week was filtered before fix; missing phone; Sendblue failure; intro-eligibility block; or 24h outbound cap).',
          week_anchor_monday_scope: weekAnchorMonday,
          sent,
          requested: requestedIds.length,
          sent_outside_24h,
          skipped_no_recent_inbound,
          skipped_outside_24h_cap,
          skipped_not_in_requested,
          skipped_blocked_from_new_intro,
        }),
        /** Use 200 + ok:false so the gateway does not log EDGE_FUNCTION_ERROR for an expected business outcome. */
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
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
        skipped_blocked_from_new_intro,
        skipped_upcoming_confirmed_fika: skipped_blocked_from_new_intro,
      })
    )
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500 })
  }
})
