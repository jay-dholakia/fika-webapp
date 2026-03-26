/**
 * Sendblue webhook: receive incoming messages, route Concierge vs Match (relay).
 * POST from Sendblue with: content, from_number, to_number, sendblue_number, message_handle.
 * Optional: set SENDBLUE_WEBHOOK_SECRET and Sendblue webhook secret; we verify X-Webhook-Signature (HMAC-SHA256 of body, hex).
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createHmac, timingSafeEqual } from 'crypto'
import {
  getUserIdByPhone,
  normalizeIncomingPhone,
  SMS_STATES,
  getDaysFromSlotIds,
  slotIdToDayAndWindow,
  slotIdToDisplayTime,
  messageEntry,
  messageOnboardingRequired,
  messageEntryReminder,
  messageFikaUserInitiatedCommitment,
  messageFikaUserInitiatedLinkBody,
  messageTextFikaToGetLink,
  messageConversationContext,
  messageSchedulingDay,
  messageSchedulingWindow,
  messageVenueProposed,
  messageYoureAllSet,
  messagePassConfirmation,
  messageYesWaitingForOther,
  messageMatchPassed,
  messageProposalDeclined,
  messageProposalDeclinedToOther,
  messageProposalMaxRetries,
  messageReProposalToDecliner,
  messageReProposalToOther,
  messageProposalToConfirm,
  messageRelayConfirmToSender,
  messageRelayToOther,
  messageRelayCouldNotDeliver,
  isInRelayWindow,
  isRelayClosed,
  messageRelayClosedFeedbackPrompt,
  messageThanksForFeedback,
  messageThanksForFeedbackAgain,
  messageSmsOptOut,
  messageSmsOptBackIn,
  messageConfirmedUpcoming,
  messageRescheduleAck,
  messageCancelAck,
  getFallbackForState,
  fallbackGeneric,
  isMatchYesKeyword,
  isMatchPassKeyword,
  isProposalDeclineKeyword,
  isConfirmKeyword,
  isResendLinkKeyword,
  isHelpKeyword,
  isAvailabilityReadyKeyword,
  isStopKeyword,
  isRescheduleKeyword,
  isCancelKeyword,
  isGreetingKeyword,
  getFikaTimeMs,
  pickVenueForMatch,
  messageInactiveMarketReply,
  messageAvailabilityLockAllSet,
  messageTeaserPreview,
  messageAwaitingAvailabilityReady,
} from '@/lib/sms-agent'
import { getActiveMarketSlugs } from '@/lib/admin-markets'
import { getMarketBySlug } from '@/lib/markets'
import { sendConcierge, isSendblueConfigured } from '@/lib/sendblue'
import { getIntakeRadiusKm } from '@/lib/intake-radius'
import { getBestDefaultSlot } from '@/lib/availability-slots'
import { candidateSlotIdsForProposalFromIntake, nextAlternateProposalSlot } from '@/lib/intake-typical-times'
import { getCurrentWeekAnchorMonday, isOnboardingComplete } from '@/lib/onboarding'
import {
  buildUserMarketMap,
  fetchMatchMarketTimezone,
  getTimezoneForMatchFromMap,
} from '@/lib/match-market-timezone'
import type { ProfileRow, IntakeResponsesV5Row } from '@/lib/db-types'
import {
  messageSmsSignupLinkSent,
  messageSmsSignupLinkAlreadySent,
} from '@/lib/sms-signup'
import { insertMessageLedger } from '@/lib/message-ledger'

const CONCIERGE_RAW = (process.env.SENDBLUE_CONCIERGE_NUMBER || '').replace(/\D/g, '')
/** Normalize to 10 digits for US numbers (strip leading 1) so 13102102404 and 3102102404 match. */
const CONCIERGE = CONCIERGE_RAW.length === 11 && CONCIERGE_RAW.startsWith('1')
  ? CONCIERGE_RAW.slice(1)
  : CONCIERGE_RAW

function getAppBase(): string {
  const base = (process.env.APP_CANONICAL_URL ?? '').trim().replace(/\/$/, '')
  return base || 'https://letsfika.vercel.app'
}

function formatConciergeNumber(digits: string): string {
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  if (digits.length === 11 && digits.startsWith('1')) return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  return digits
}

function isConciergeNumber(toNumber: string): boolean {
  let digits = toNumber.replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1)
  return Boolean(CONCIERGE && (digits === CONCIERGE || digits.endsWith(CONCIERGE)))
}

function verifyWebhookSignature(rawBody: string, signatureHeader: string | null, secret: string): boolean {
  if (!signatureHeader?.trim()) return false
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
  const received = signatureHeader.replace(/^sha256=/i, '').trim()
  if (expected.length !== received.length) return false
  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(received, 'hex'))
  } catch {
    return false
  }
}

export async function POST(request: Request) {
  if (!isSendblueConfigured()) {
    return NextResponse.json({ error: 'Sendblue not configured' }, { status: 503 })
  }
  const rawBody = await request.text()
  const signatureHeader =
    request.headers.get('X-Webhook-Signature') ??
    request.headers.get('X-Sendblue-Signature') ??
    request.headers.get('X-Signature') ??
    null
  const webhookSecret = process.env.SENDBLUE_WEBHOOK_SECRET
  if (webhookSecret && !verifyWebhookSignature(rawBody, signatureHeader, webhookSecret)) {
    console.log('[sendblue-webhook] signature verification failed')
    return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 401 })
  }
  let body: {
    content?: string
    from_number?: string
    fromNumber?: string
    to_number?: string
    toNumber?: string
    sendblue_number?: string
    message_handle?: string
    messageHandle?: string
  }
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const content = (body.content ?? '').trim()
  const fromNumber = body.from_number ?? body.fromNumber ?? ''
  const toNumber = body.to_number ?? body.toNumber ?? body.sendblue_number ?? ''
  const messageHandle = body.message_handle ?? body.messageHandle ?? ''

  // Debug logging (visible in Vercel Functions logs)
  const fromLast4 = fromNumber.replace(/\D/g, '').slice(-4)
  console.log('[sendblue-webhook] received', { from: `***${fromLast4}`, toNumber: toNumber ? '***' + toNumber.replace(/\D/g, '').slice(-4) : '', contentLength: content.length })

  if (!fromNumber || !content) {
    return NextResponse.json({ error: 'Missing from_number or content' }, { status: 400 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  const fromPhone = normalizeIncomingPhone(fromNumber)

  async function sendConciergeAndLog(
    toPhone: string,
    content: string,
    context: string,
    opts?: { userId?: string | null; weekAnchorMonday?: string; matchId?: string }
  ) {
    const result = await sendConcierge(toPhone, content)
    await insertMessageLedger(supabase, {
      user_id: opts?.userId ?? null,
      direction: 'outbound',
      peer_phone: toPhone,
      content_snippet: content,
      context,
      message_handle: result.message_handle ?? null,
      week_anchor_monday: opts?.weekAnchorMonday ?? null,
      match_id: opts?.matchId ?? null,
    })
    return result
  }

  const isConcierge = isConciergeNumber(toNumber)
  console.log('[sendblue-webhook] route', { isConcierge, toNumber: toNumber ? 'set' : 'empty' })

  // ----- Concierge only (no Match number) -----
  if (!isConciergeNumber(toNumber)) {
    return NextResponse.json({ ok: true })
  }

  const userId = await getUserIdByPhone(supabase, fromPhone)
  console.log('[sendblue-webhook] user lookup', { fromLast4, userId: userId ? 'found' : 'not_found' })
  await insertMessageLedger(supabase, {
    user_id: userId ?? null,
    direction: 'inbound',
    peer_phone: fromPhone,
    content_snippet: content,
  })
  if (!userId) {
    // ----- Phone-first: unknown number → send link to profile builder; they finalize with Google -----
    // Use hardcoded production URL so the link is never the deployment/preview URL.
    // Override only by setting APP_CANONICAL_URL in Vercel (e.g. https://letsfika.co).
    const DEFAULT_SIGNUP_BASE = 'https://letsfika.vercel.app'
    const appBase = (process.env.APP_CANONICAL_URL ?? '').trim()
      ? process.env.APP_CANONICAL_URL!.trim().replace(/\/$/, '')
      : DEFAULT_SIGNUP_BASE
    const { data: existing } = await supabase
      .from('onboarding_sessions')
      .select('token')
      .eq('phone', fromPhone)
      .is('merged_into_user_id', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (existing?.token) {
      const link = `${appBase}/signup?token=${existing.token}`
      await sendConciergeAndLog(fromNumber, messageSmsSignupLinkAlreadySent(link), 'signup_link_already_sent')
      await new Promise((r) => setTimeout(r, 1000))
      await sendConciergeAndLog(fromNumber, link, 'signup_link_already_sent_url')
      return NextResponse.json({ ok: true })
    }
    const token = crypto.randomUUID()
    const { error: insertErr } = await supabase.from('onboarding_sessions').insert({
      token,
      phone: fromPhone,
      payload: {},
      updated_at: new Date().toISOString(),
    })
    if (insertErr) {
      console.error('[sendblue-webhook] onboarding_sessions insert', insertErr.message)
      await sendConciergeAndLog(fromNumber, "Something went wrong. Try again or sign up at letsfika.co", 'signup_error')
      return NextResponse.json({ ok: true })
    }
    const link = `${appBase}/signup?token=${token}`
    await sendConciergeAndLog(fromNumber, messageSmsSignupLinkSent(link), 'signup_link_sent')
    await new Promise((r) => setTimeout(r, 1000))
    await sendConciergeAndLog(fromNumber, link, 'signup_link_sent_url')
    return NextResponse.json({ ok: true })
  }

  // ----- STOP / opt-out and opt-back-in -----
  const { data: profileForSms } = await supabase
    .from('profiles')
    .select('sms_opted_out_at, sms_mode, sms_human_until')
    .eq('id', userId)
    .maybeSingle()
  if (isStopKeyword(content)) {
    await supabase.from('profiles').update({ sms_opted_out_at: new Date().toISOString() }).eq('id', userId)
    const webappUrl = getAppBase()
    await sendConciergeAndLog(fromNumber, messageSmsOptOut(webappUrl, formatConciergeNumber(CONCIERGE)), 'opt_out', { userId })
    await new Promise((r) => setTimeout(r, 1000))
    await sendConciergeAndLog(fromNumber, webappUrl, 'opt_out_url', { userId })
    return NextResponse.json({ ok: true })
  }
  if (profileForSms?.sms_opted_out_at) {
    await supabase.from('profiles').update({ sms_opted_out_at: null }).eq('id', userId)
    await sendConciergeAndLog(fromNumber, messageSmsOptBackIn(), 'opt_back_in', { userId })
    return NextResponse.json({ ok: true })
  }

  // Human handoff mode: suppress automated concierge replies while the line is in human mode.
  const smsMode = (profileForSms as { sms_mode?: string | null } | null)?.sms_mode ?? 'auto'
  const smsHumanUntil = (profileForSms as { sms_human_until?: string | null } | null)?.sms_human_until ?? null
  const humanActive =
    smsMode === 'human' &&
    (
      smsHumanUntil == null ||
      (Number.isFinite(new Date(smsHumanUntil).getTime()) && new Date(smsHumanUntil).getTime() > Date.now())
    )
  if (humanActive) {
    return NextResponse.json({ ok: true, suppressed: 'human_mode' })
  }

  // ----- READY keyword: legacy match_availability confirmation (optional; proposal-first uses YES/NO) -----
  if (isAvailabilityReadyKeyword(content)) {
    const { data: awaiting } = await supabase
      .from('sms_conversation_states')
      .select('match_id')
      .eq('user_id', userId)
      .eq('state', SMS_STATES.AWAITING_AVAILABILITY)
      .not('match_id', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const matchIdReady = (awaiting as { match_id?: string | null } | null)?.match_id ?? null
    if (!matchIdReady) {
      await sendConciergeAndLog(
        fromNumber,
        'Reply YES or NO to the time we proposed, or text HELP.',
        'availability_ready_no_pending',
        { userId }
      )
      return NextResponse.json({ ok: true })
    }

    const { data: avReadyRow } = await supabase
      .from('match_availability')
      .select('pending_sms_ready_confirmation, availability_slots, sms_ready_confirmed_at')
      .eq('user_id', userId)
      .eq('match_id', matchIdReady)
      .maybeSingle()
    const readySlots = Array.isArray(avReadyRow?.availability_slots) ? avReadyRow.availability_slots : []

    if (avReadyRow?.pending_sms_ready_confirmation && readySlots.length > 0) {
      await supabase
        .from('match_availability')
        .update({
          pending_sms_ready_confirmation: false,
          sms_ready_confirmed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId)
        .eq('match_id', matchIdReady)
      await sendConciergeAndLog(fromNumber, messageAvailabilityLockAllSet(), 'availability_ready_confirmed', {
        userId,
        matchId: matchIdReady,
      })
      return NextResponse.json({ ok: true })
    }

    if (avReadyRow?.sms_ready_confirmed_at && readySlots.length > 0) {
      await sendConciergeAndLog(
        fromNumber,
        "You're all set for this intro.",
        'availability_ready_already_confirmed',
        { userId, matchId: matchIdReady }
      )
      return NextResponse.json({ ok: true })
    }

    await sendConciergeAndLog(
      fromNumber,
      'Reply YES or NO to the time we proposed, or text HELP.',
      'availability_ready_no_pending',
      { userId, matchId: matchIdReady }
    )
    return NextResponse.json({ ok: true })
  }

  // ----- Relay just closed and follow-up not sent yet: send closure + feedback prompt -----
  const { data: recentlyClosedMatches } = await supabase
    .from('match_candidates')
    .select('id, user_a, user_b, week_anchor_monday, confirmed_slot_id, post_fika_sent_at')
    .or(`user_a.eq.${userId},user_b.eq.${userId}`)
    .eq('scheduling_status', 'confirmed')
    .is('post_fika_sent_at', null)
    .not('week_anchor_monday', 'is', null)
    .not('confirmed_slot_id', 'is', null)
    .order('updated_at', { ascending: false })
  const recentlyClosedMarketMap = await buildUserMarketMap(supabase, recentlyClosedMatches ?? [])
  const recentlyClosed = (recentlyClosedMatches ?? []).find(
    (m: { user_a: string; user_b: string; week_anchor_monday: string; confirmed_slot_id: string }) =>
      m.week_anchor_monday &&
      m.confirmed_slot_id &&
      isRelayClosed(m.week_anchor_monday, m.confirmed_slot_id, getTimezoneForMatchFromMap(m, recentlyClosedMarketMap))
  )
  if (recentlyClosed) {
    await sendConciergeAndLog(fromNumber, messageRelayClosedFeedbackPrompt(), 'relay_closed_feedback_prompt', { userId, matchId: recentlyClosed.id })
    await supabase
      .from('match_candidates')
      .update({ post_fika_sent_at: new Date().toISOString() })
      .eq('id', recentlyClosed.id)
    return NextResponse.json({ ok: true })
  }

  // ----- Post-Fika feedback: if we already sent follow-up and they're replying, store it -----
  const { data: feedbackMatches } = await supabase
    .from('match_candidates')
    .select('id, user_a, user_b, week_anchor_monday, confirmed_slot_id, post_fika_sent_at')
    .or(`user_a.eq.${userId},user_b.eq.${userId}`)
    .eq('scheduling_status', 'confirmed')
    .not('post_fika_sent_at', 'is', null)
    .not('week_anchor_monday', 'is', null)
    .not('confirmed_slot_id', 'is', null)
    .order('post_fika_sent_at', { ascending: false })
  const feedbackMarketMap = await buildUserMarketMap(supabase, feedbackMatches ?? [])
  const feedbackMatch = (feedbackMatches ?? []).find(
    (m: { user_a: string; user_b: string; week_anchor_monday: string; confirmed_slot_id: string }) =>
      m.week_anchor_monday &&
      m.confirmed_slot_id &&
      isRelayClosed(m.week_anchor_monday, m.confirmed_slot_id, getTimezoneForMatchFromMap(m, feedbackMarketMap))
  )
  if (feedbackMatch) {
    const { data: existingFeedback } = await supabase
      .from('fika_feedback')
      .select('id')
      .eq('match_id', feedbackMatch.id)
      .eq('user_id', userId)
      .limit(1)
    const isRepeat = (existingFeedback?.length ?? 0) > 0
    const { error: insertErr } = await supabase.from('fika_feedback').insert({
      match_id: feedbackMatch.id,
      user_id: userId,
      content,
    })
    if (!insertErr) {
      await sendConciergeAndLog(fromNumber, isRepeat ? messageThanksForFeedbackAgain() : messageThanksForFeedback(), 'feedback_thanks', { userId })
    }
    return NextResponse.json({ ok: true })
  }

  // ----- Free-text relay window: 3h before through 2h after confirmed Fika -----
  const { data: relayMatches } = await supabase
    .from('match_candidates')
    .select('id, user_a, user_b, week_anchor_monday, confirmed_slot_id')
    .or(`user_a.eq.${userId},user_b.eq.${userId}`)
    .eq('scheduling_status', 'confirmed')
    .not('confirmed_slot_id', 'is', null)
    .not('week_anchor_monday', 'is', null)
  const relayMarketMap = await buildUserMarketMap(supabase, relayMatches ?? [])
  const relayMatch = (relayMatches ?? []).find(
    (m: { user_a: string; user_b: string; week_anchor_monday: string; confirmed_slot_id: string }) =>
      m.week_anchor_monday &&
      m.confirmed_slot_id &&
      isInRelayWindow(m.week_anchor_monday, m.confirmed_slot_id, getTimezoneForMatchFromMap(m, relayMarketMap))
  )
  if (relayMatch) {
    const otherId = relayMatch.user_a === userId ? relayMatch.user_b : relayMatch.user_a
    const { data: otherProfile } = await supabase
      .from('profiles')
      .select('first_name, phone')
      .eq('id', otherId)
      .maybeSingle()
    const { data: senderProfile } = await supabase
      .from('profiles')
      .select('first_name')
      .eq('id', userId)
      .maybeSingle()
    const otherFirstName = otherProfile?.first_name?.trim() ?? 'your intro'
    const senderFirstName = senderProfile?.first_name?.trim() ?? 'Your intro'
    const otherPhone = otherProfile?.phone?.trim()
    if (otherPhone) {
      await sendConciergeAndLog(otherPhone, messageRelayToOther(senderFirstName, content), 'relay_to_other', { userId: otherId, matchId: relayMatch.id })
      await sendConciergeAndLog(fromNumber, messageRelayConfirmToSender(otherFirstName), 'relay_confirm_sender', { userId, matchId: relayMatch.id })
    } else {
      await sendConciergeAndLog(fromNumber, messageRelayCouldNotDeliver(), 'relay_could_not_deliver', { userId, matchId: relayMatch.id })
    }
    return NextResponse.json({ ok: true })
  }

  // ----- Confirmed Fika upcoming (not today, or they text on non–Fika day): fun reminder + CTA -----
  const { data: upcomingMatches } = await supabase
    .from('match_candidates')
    .select('id, user_a, user_b, week_anchor_monday, confirmed_slot_id, confirmed_venue_id')
    .or(`user_a.eq.${userId},user_b.eq.${userId}`)
    .eq('scheduling_status', 'confirmed')
    .not('week_anchor_monday', 'is', null)
    .not('confirmed_slot_id', 'is', null)
    .not('confirmed_venue_id', 'is', null)
  const upcomingMarketMap = await buildUserMarketMap(supabase, upcomingMatches ?? [])
  const upcomingMatch = (upcomingMatches ?? []).find(
    (m: { user_a: string; user_b: string; week_anchor_monday: string; confirmed_slot_id: string }) => {
      const tz = getTimezoneForMatchFromMap(m, upcomingMarketMap)
      const ms = getFikaTimeMs(m.week_anchor_monday, m.confirmed_slot_id, tz)
      return ms != null && ms > Date.now()
    }
  )
  if (upcomingMatch) {
    if (isRescheduleKeyword(content)) {
      await sendConciergeAndLog(fromNumber, messageRescheduleAck(), 'reschedule_ack', { userId })
      return NextResponse.json({ ok: true })
    }
    if (isCancelKeyword(content)) {
      await sendConciergeAndLog(fromNumber, messageCancelAck(), 'cancel_ack', { userId })
      return NextResponse.json({ ok: true })
    }
    const { data: venue } = await supabase
      .from('venues')
      .select('name, neighborhood, city')
      .eq('id', upcomingMatch.confirmed_venue_id)
      .single()
    const { day, time } = slotIdToDisplayTime(upcomingMatch.confirmed_slot_id)
    const venueName = venue?.name ?? 'the spot'
    const neighborhood = venue?.neighborhood ?? venue?.city ?? ''
    const webappUrl = getAppBase()
    await sendConciergeAndLog(fromNumber, messageConfirmedUpcoming(day, time, venueName, neighborhood, webappUrl), 'confirmed_upcoming', { userId })
    await new Promise((r) => setTimeout(r, 1000))
    await sendConciergeAndLog(fromNumber, webappUrl, 'confirmed_upcoming_url', { userId })
    return NextResponse.json({ ok: true })
  }

  const weekAnchorMonday = getCurrentWeekAnchorMonday()

  // Load global state (user + week_anchor_monday, no match)
  const { data: stateRow } = await supabase
    .from('sms_conversation_states')
    .select('*')
    .eq('user_id', userId)
    .eq('week_anchor_monday', weekAnchorMonday)
    .is('match_id', null)
    .maybeSingle()

  // Per-match state takes priority and may live on a prior week_anchor_monday
  // (e.g. user replies after Monday rollover).
  const { data: matchStateRow } = await supabase
    .from('sms_conversation_states')
    .select('*')
    .eq('user_id', userId)
    .not('match_id', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // First contact (no state yet): confirm setup; we reach out when we find a good Fika intro for them.
  if (!stateRow && !matchStateRow) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, first_name, birthdate, city, avatar_url, intent_confirmed_at, lat, lng, market')
      .eq('id', userId)
      .maybeSingle()
    const { data: intake } = await supabase
      .from('intake_responses_v5')
      .select('user_id, completed_at')
      .eq('user_id', userId)
      .maybeSingle()
    if (!isOnboardingComplete((profile ?? null) as ProfileRow | null, (intake ?? null) as IntakeResponsesV5Row | null)) {
      console.log('[sendblue-webhook] user needs onboarding', { fromLast4 })
      const DEFAULT_APP_BASE = 'https://letsfika.vercel.app'
      const appBase = (process.env.APP_CANONICAL_URL ?? '').trim()
        ? process.env.APP_CANONICAL_URL!.trim().replace(/\/$/, '')
        : DEFAULT_APP_BASE
      const onboardingUrl = `${appBase}/app/onboarding`
      await sendConciergeAndLog(fromNumber, messageOnboardingRequired(onboardingUrl), 'onboarding_required', { userId })
      await new Promise((r) => setTimeout(r, 1000))
      await sendConciergeAndLog(fromNumber, onboardingUrl, 'onboarding_required_url', { userId })
      return NextResponse.json({ ok: true })
    }
    const activeSlugs = await getActiveMarketSlugs(supabase)
    const profileMarket = (profile as { market?: string | null })?.market ?? null
    if (profileMarket != null && activeSlugs.length > 0 && !activeSlugs.includes(profileMarket)) {
      const placeLabel = getMarketBySlug(profileMarket)?.label ?? (profile as { city?: string | null })?.city ?? profileMarket
      await sendConciergeAndLog(fromNumber, messageInactiveMarketReply(placeLabel), 'inactive_market_reply', { userId })
      return NextResponse.json({ ok: true })
    }

    await sendConciergeAndLog(fromNumber, messageEntry(), 'first_contact_ready_for_intro', { userId, weekAnchorMonday })
    return NextResponse.json({ ok: true })
  }

  const state = stateRow?.state ?? SMS_STATES.GLOBAL_READY
  const keyword = content.toUpperCase().replace(/\s+/g, ' ').trim()
  const payload = (stateRow?.payload as Record<string, unknown>) ?? {}

  // Idempotency: skip if we already processed this message
  if (messageHandle && stateRow?.last_sendblue_message_handle === messageHandle) {
    return NextResponse.json({ ok: true })
  }

  let matchState = matchStateRow?.state
  let matchId = matchStateRow?.match_id
  let matchPayload = (matchStateRow?.payload as Record<string, unknown>) ?? {}

  // Recovery path: if a user replies YES/PASS but match state row is missing,
  // resolve their latest active match so we still treat the reply as a match response.
  if (!matchId && (isMatchYesKeyword(content) || keyword === 'YES' || isMatchPassKeyword(content) || keyword === 'PASS')) {
    const { data: recentMatches } = await supabase
      .from('match_candidates')
      .select('id, week_anchor_monday, created_at')
      .or(`user_a.eq.${userId},user_b.eq.${userId}`)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(5)

    const candidateMatchIds = (recentMatches ?? []).map((m: { id: string }) => m.id)
    if (candidateMatchIds.length > 0) {
      const { data: myOptIns } = await supabase
        .from('opt_ins')
        .select('match_id, decision')
        .eq('user_id', userId)
        .in('match_id', candidateMatchIds)
      const optedMatchIds = new Set(
        (myOptIns ?? [])
          .filter((o: { decision?: string | null }) => o.decision === 'yes' || o.decision === 'no')
          .map((o: { match_id: string }) => o.match_id)
      )
      const recovered = (recentMatches ?? []).find((m: { id: string }) => !optedMatchIds.has(m.id)) ??
        (recentMatches ?? [])[0]
      if (recovered?.id) {
        matchId = recovered.id
        matchState = SMS_STATES.MATCH_OFFERED
        matchPayload = {}
        await supabase
          .from('sms_conversation_states')
          .upsert(
            {
              user_id: userId,
              week_anchor_monday: recovered.week_anchor_monday ?? weekAnchorMonday,
              match_id: recovered.id,
              state: SMS_STATES.MATCH_OFFERED,
              payload: { recovered_missing_match_state: true },
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'user_id,week_anchor_monday,match_id' }
          )
      }
    }
  }

  if (isHelpKeyword(content)) {
    await sendConciergeAndLog(fromNumber, getFallbackForState(matchState ?? state), 'help_fallback', { userId, weekAnchorMonday, matchId: matchId ?? undefined })
    return NextResponse.json({ ok: true })
  }

  const protocolV2Enabled = process.env.SMS_PROTOCOL_V2_ENABLED === 'true'
  const appBase = getAppBase()

  if (matchState === SMS_STATES.MATCH_OFFERED && matchId) {
    if (isMatchYesKeyword(content) || keyword === 'YES') {
      const { data: otherOpt } = await supabase
        .from('opt_ins')
        .select('decision')
        .eq('match_id', matchId)
        .neq('user_id', userId)
        .maybeSingle()
      if (otherOpt?.decision === 'no') {
        await sendConciergeAndLog(fromNumber, messageMatchPassed(), 'match_passed', { userId, weekAnchorMonday, matchId })
        await supabase.from('sms_conversation_states').delete().eq('id', matchStateRow!.id)
        return NextResponse.json({ ok: true })
      }
      await supabase.from('opt_ins').upsert(
        { match_id: matchId, user_id: userId, decision: 'yes' },
        { onConflict: 'match_id,user_id' }
      )
      const { data: match } = await supabase
        .from('match_candidates')
        .select('id, user_a, user_b, reasons, default_slot_id')
        .eq('id', matchId)
        .single()
      if (!match) {
        await sendConciergeAndLog(fromNumber, "That match is no longer available. We'll send you another soon.", 'match_no_longer_available', { userId, weekAnchorMonday, matchId })
        return NextResponse.json({ ok: true })
      }
      const { data: yesOpts } = await supabase
        .from('opt_ins')
        .select('user_id, answered_at')
        .eq('match_id', matchId)
        .eq('decision', 'yes')
        .order('answered_at', { ascending: true })
      const yesUsers = yesOpts ?? []
      if (yesUsers.length === 1) {
        await sendConciergeAndLog(fromNumber, messageYesWaitingForOther(), 'yes_waiting_for_other', { userId, weekAnchorMonday, matchId })
        await supabase.from('sms_conversation_states').upsert(
          {
            user_id: userId,
            week_anchor_monday: weekAnchorMonday,
            match_id: matchId,
            state: SMS_STATES.YES_WAITING,
            payload: { ...matchPayload },
            last_sendblue_message_handle: messageHandle,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,week_anchor_monday,match_id' }
        )
      } else {
        if (protocolV2Enabled) {
          const { data: pair } = await supabase
            .from('match_candidates')
            .select('user_a, user_b')
            .eq('id', matchId)
            .maybeSingle()
          const otherId = pair ? (pair.user_a === userId ? pair.user_b : pair.user_a) : null
          const { data: currentProfile } = await supabase
            .from('profiles')
            .select('first_name')
            .eq('id', userId)
            .maybeSingle()
          const { data: otherProfile } = otherId
            ? await supabase
                .from('profiles')
                .select('phone, first_name, bio_text')
                .eq('id', otherId)
                .maybeSingle()
            : { data: null as { phone?: string | null; first_name?: string | null; bio_text?: string | null } | null }
          const currentName = currentProfile?.first_name?.trim() ?? 'Someone'
          const otherName = otherProfile?.first_name?.trim() ?? 'Someone'
          const trimmedOtherBio = (otherProfile?.bio_text as string | undefined)?.trim()
          const otherBio = trimmedOtherBio
            ? trimmedOtherBio.slice(0, 120)
            : 'Looking forward to a good conversation.'

          // Current user teaser + link
          await sendConciergeAndLog(
            fromNumber,
            messageTeaserPreview({ otherFirstName: otherName, otherBio }),
            'v2_teaser_preview',
            { userId, weekAnchorMonday, matchId }
          )
          await new Promise((r) => setTimeout(r, 1000))
          await sendConciergeAndLog(fromNumber, `${appBase}/app/yourfika`, 'v2_teaser_yourfika_url', {
            userId,
            weekAnchorMonday,
            matchId,
          })

          // Other user teaser + link (only if we have phone)
          if (otherProfile?.phone) {
            const { data: myBioProfile } = await supabase
              .from('profiles')
              .select('bio_text')
              .eq('id', userId)
              .maybeSingle()
            const trimmedMyBio = (myBioProfile?.bio_text as string | undefined)?.trim()
            const myBio = trimmedMyBio
              ? trimmedMyBio.slice(0, 120)
              : 'Looking forward to a good conversation.'
            await sendConciergeAndLog(
              otherProfile.phone,
              messageTeaserPreview({ otherFirstName: currentName, otherBio: myBio }),
              'v2_teaser_preview_other',
              { userId: otherId ?? undefined, weekAnchorMonday, matchId }
            )
            await new Promise((r) => setTimeout(r, 1000))
            await sendConciergeAndLog(
              otherProfile.phone,
              `${appBase}/app/yourfika`,
              'v2_teaser_yourfika_url_other',
              { userId: otherId ?? undefined, weekAnchorMonday, matchId }
            )
            await new Promise((r) => setTimeout(r, 1000))
          }

          // Proposal-first scheduling: after both YES, propose a concrete time+place.
          // Slot pool comes from intake q_typical_fika_times (intersection → union → full grid fallback).
          const firstYesUserId = yesUsers[0].user_id
          const { data: userA } = await supabase.from('profiles').select('city, lat, lng').eq('id', match.user_a).single()
          const { data: userB } = await supabase.from('profiles').select('city, lat, lng').eq('id', match.user_b).single()
          const [intakeA, intakeB] = await Promise.all([
            supabase.from('intake_responses_v5').select('responses').eq('user_id', match.user_a).maybeSingle(),
            supabase.from('intake_responses_v5').select('responses').eq('user_id', match.user_b).maybeSingle(),
          ])
          const candidateSlots = candidateSlotIdsForProposalFromIntake(
            intakeA?.data?.responses ?? null,
            intakeB?.data?.responses ?? null
          )
          const slotId = getBestDefaultSlot(candidateSlots) ?? candidateSlots[0] ?? null
          if (!slotId) {
            await sendConciergeAndLog(
              fromNumber,
              "We couldn't find a time that works for both. We'll reach out when we find another good Fika intro for you.",
              'no_overlap',
              { userId, weekAnchorMonday, matchId }
            )
            return NextResponse.json({ ok: true })
          }
          const radiusA = getIntakeRadiusKm(intakeA?.data?.responses ?? null)
          const radiusB = getIntakeRadiusKm(intakeB?.data?.responses ?? null)
          const matchTzV2 = await fetchMatchMarketTimezone(supabase, match.user_a, match.user_b)
          const meetingMsV2 = getFikaTimeMs(weekAnchorMonday, slotId, matchTzV2)
          const venue = await pickVenueForMatch(
            supabase,
            { city: userA?.city ?? null, lat: userA?.lat ?? null, lng: userA?.lng ?? null, radius_km: radiusA },
            { city: userB?.city ?? null, lat: userB?.lat ?? null, lng: userB?.lng ?? null, radius_km: radiusB },
            { meetingAtUtc: meetingMsV2 != null ? new Date(meetingMsV2) : undefined }
          )
          if (!venue) {
            await sendConciergeAndLog(fromNumber, "We're setting up a spot — we'll text you in a moment.", 'venue_setup', {
              userId,
              weekAnchorMonday,
              matchId,
            })
            return NextResponse.json({ ok: true })
          }

          const { day: proposedDay, time: proposedTime } = slotIdToDisplayTime(slotId)
          const { data: firstYesProfile } = await supabase
            .from('profiles')
            .select('first_name')
            .eq('id', firstYesUserId)
            .single()
          const firstYesName = firstYesProfile?.first_name?.trim() ?? 'Your match'

          await sendConciergeAndLog(
            fromNumber,
            messageProposalToConfirm({
              otherFirstName: firstYesName,
              day: proposedDay,
              time: proposedTime,
              venueName: venue.name,
              neighborhood: venue.neighborhood ?? venue.city,
            }),
            'proposal_to_confirm',
            { userId, weekAnchorMonday, matchId }
          )

          await supabase.from('match_candidates').update({
            suggested_venue_id: venue.id,
            default_slot_id: slotId,
            overlapping_slot_ids: candidateSlots,
          }).eq('id', matchId)

          await supabase.from('sms_conversation_states').upsert(
            {
              user_id: userId,
              week_anchor_monday: weekAnchorMonday,
              match_id: matchId,
              state: SMS_STATES.AWAITING_SECOND_CONFIRM,
              payload: {
                proposed_slot_id: slotId,
                proposed_venue_id: venue.id,
                proposed_day: proposedDay,
                proposed_time: proposedTime,
                venue_name: venue.name,
                neighborhood: venue.neighborhood ?? venue.city,
                first_yes_user_id: firstYesUserId,
                proposal_attempt: 1,
              },
              last_sendblue_message_handle: messageHandle,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'user_id,week_anchor_monday,match_id' }
          )
          return NextResponse.json({ ok: true })
        }

        const firstYesUserId = yesUsers[0].user_id
        const { data: userA } = await supabase.from('profiles').select('city, lat, lng').eq('id', match.user_a).single()
        const { data: userB } = await supabase.from('profiles').select('city, lat, lng').eq('id', match.user_b).single()
        const [intakeA, intakeB] = await Promise.all([
          supabase.from('intake_responses_v5').select('responses').eq('user_id', match.user_a).maybeSingle(),
          supabase.from('intake_responses_v5').select('responses').eq('user_id', match.user_b).maybeSingle(),
        ])
        const candidateSlots = candidateSlotIdsForProposalFromIntake(
          intakeA?.data?.responses ?? null,
          intakeB?.data?.responses ?? null
        )
        const slotId = getBestDefaultSlot(candidateSlots) ?? candidateSlots[0] ?? null
        if (!slotId) {
          await sendConciergeAndLog(fromNumber, "We couldn't find a time that works for both. We'll reach out when we find another good Fika intro for you.", 'no_overlap', { userId, weekAnchorMonday, matchId })
          return NextResponse.json({ ok: true })
        }
        const radiusA = getIntakeRadiusKm(intakeA?.data?.responses ?? null)
        const radiusB = getIntakeRadiusKm(intakeB?.data?.responses ?? null)
        const matchTzV1 = await fetchMatchMarketTimezone(supabase, match.user_a, match.user_b)
        const meetingMsV1 = getFikaTimeMs(weekAnchorMonday, slotId, matchTzV1)
        const venue = await pickVenueForMatch(
          supabase,
          { city: userA?.city ?? null, lat: userA?.lat ?? null, lng: userA?.lng ?? null, radius_km: radiusA },
          { city: userB?.city ?? null, lat: userB?.lat ?? null, lng: userB?.lng ?? null, radius_km: radiusB },
          { meetingAtUtc: meetingMsV1 != null ? new Date(meetingMsV1) : undefined }
        )
        if (!venue) {
          await sendConciergeAndLog(fromNumber, "We're setting up a spot — we'll text you in a moment.", 'venue_setup', { userId, weekAnchorMonday, matchId })
          return NextResponse.json({ ok: true })
        }
        const { day: proposedDay, time: proposedTime } = slotIdToDisplayTime(slotId)
        const { data: otherProfile } = await supabase
          .from('profiles')
          .select('first_name')
          .eq('id', firstYesUserId)
          .single()
        const otherName = otherProfile?.first_name?.trim() ?? 'Your match'
        await sendConciergeAndLog(fromNumber, messageProposalToConfirm({
          otherFirstName: otherName,
          day: proposedDay,
          time: proposedTime,
          venueName: venue.name,
          neighborhood: venue.neighborhood ?? venue.city,
        }), 'proposal_to_confirm', { userId, weekAnchorMonday, matchId })
        await supabase.from('match_candidates').update({
          suggested_venue_id: venue.id,
          default_slot_id: slotId,
          overlapping_slot_ids: candidateSlots,
        }).eq('id', matchId)
        await supabase.from('sms_conversation_states').upsert(
          {
            user_id: userId,
            week_anchor_monday: weekAnchorMonday,
            match_id: matchId,
            state: SMS_STATES.AWAITING_SECOND_CONFIRM,
            payload: {
              proposed_slot_id: slotId,
              proposed_venue_id: venue.id,
              proposed_day: proposedDay,
              proposed_time: proposedTime,
              venue_name: venue.name,
              neighborhood: venue.neighborhood ?? venue.city,
              first_yes_user_id: firstYesUserId,
              proposal_attempt: 1,
            },
            last_sendblue_message_handle: messageHandle,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,week_anchor_monday,match_id' }
        )
      }
    } else if (isMatchPassKeyword(content) || keyword === 'PASS') {
      await supabase.from('opt_ins').upsert(
        { match_id: matchId, user_id: userId, decision: 'no' },
        { onConflict: 'match_id,user_id' }
      )
      await sendConciergeAndLog(fromNumber, messagePassConfirmation(), 'pass_confirmation', { userId, weekAnchorMonday, matchId })
      const { data: matchRow } = await supabase.from('match_candidates').select('user_a, user_b').eq('id', matchId).single()
      const otherId = matchRow ? (matchRow.user_a === userId ? matchRow.user_b : matchRow.user_a) : null
      if (matchRow?.user_a != null && matchRow?.user_b != null) {
        const exA = matchRow.user_a < matchRow.user_b ? matchRow.user_a : matchRow.user_b
        const exB = matchRow.user_a < matchRow.user_b ? matchRow.user_b : matchRow.user_a
        await supabase.from('match_exclusions').upsert(
          { user_a: exA, user_b: exB },
          { onConflict: 'user_a,user_b' }
        )
      }
      if (otherId) {
        const { data: otherOpt } = await supabase.from('opt_ins').select('decision').eq('match_id', matchId).eq('user_id', otherId).maybeSingle()
        if (otherOpt?.decision === 'yes') {
          const { data: otherProf } = await supabase.from('profiles').select('phone').eq('id', otherId).maybeSingle()
          if (otherProf?.phone) {
            await sendConciergeAndLog(otherProf.phone, messageMatchPassed(), 'match_passed_to_other', { userId: otherId, weekAnchorMonday, matchId })
          }
        }
        await supabase.from('sms_conversation_states').delete().eq('user_id', otherId).eq('week_anchor_monday', weekAnchorMonday).eq('match_id', matchId)
      }
      await supabase.from('sms_conversation_states').delete().eq('id', matchStateRow!.id)
    } else {
      await sendConciergeAndLog(fromNumber, getFallbackForState(SMS_STATES.MATCH_OFFERED), 'fallback_match_offered', { userId, weekAnchorMonday, matchId })
    }
    return NextResponse.json({ ok: true })
  }

  if (
    state === SMS_STATES.GLOBAL_READY ||
    state === SMS_STATES.AWAITING_OPT_IN ||
    state === SMS_STATES.OPTED_IN
  ) {
    await sendConciergeAndLog(fromNumber, messageEntryReminder(), 'global_ready_match_first', { userId, weekAnchorMonday })
    return NextResponse.json({ ok: true })
  }

  // ----- Decline proposed time/venue (AWAITING_SECOND_CONFIRM or AWAITING_FIRST_CONFIRM): re-propose once (cap 2 total) or cancel -----
  if (
    matchId &&
    (matchState === SMS_STATES.AWAITING_SECOND_CONFIRM || matchState === SMS_STATES.AWAITING_FIRST_CONFIRM) &&
    isProposalDeclineKeyword(content)
  ) {
    const proposalAttempt = (matchPayload.proposal_attempt as number) ?? 1
    const { data: matchRow } = await supabase
      .from('match_candidates')
      .select('user_a, user_b')
      .eq('id', matchId)
      .single()
    const otherId = matchRow ? (matchRow.user_a === userId ? matchRow.user_b : matchRow.user_a) : null

    const cancelMatch = async () => {
      await supabase.from('match_candidates').update({
        scheduling_status: 'expired',
        updated_at: new Date().toISOString(),
      }).eq('id', matchId)
      await sendConciergeAndLog(fromNumber, messageProposalMaxRetries(), 'proposal_max_retries', { userId, weekAnchorMonday, matchId })
      if (otherId) {
        const { data: otherProf } = await supabase.from('profiles').select('phone').eq('id', otherId).maybeSingle()
        if (otherProf?.phone) {
          await sendConciergeAndLog(otherProf.phone, messageProposalMaxRetries(), 'proposal_max_retries_to_other', { userId: otherId, weekAnchorMonday, matchId })
        }
        await supabase.from('sms_conversation_states').delete().eq('user_id', otherId).eq('week_anchor_monday', weekAnchorMonday).eq('match_id', matchId)
      }
      await supabase.from('sms_conversation_states').delete().eq('id', matchStateRow!.id)
    }

    if (proposalAttempt >= 2) {
      await cancelMatch()
      return NextResponse.json({ ok: true })
    }

    const currentSlotId = (matchPayload.proposed_slot_id as string) ?? ''
    const [intakeA, intakeB] = await Promise.all([
      supabase.from('intake_responses_v5').select('responses').eq('user_id', matchRow!.user_a).maybeSingle(),
      supabase.from('intake_responses_v5').select('responses').eq('user_id', matchRow!.user_b).maybeSingle(),
    ])
    const candidateSlots = candidateSlotIdsForProposalFromIntake(
      intakeA?.data?.responses ?? null,
      intakeB?.data?.responses ?? null
    )
    const nextSlotId = nextAlternateProposalSlot(currentSlotId, candidateSlots)

    if (!nextSlotId) {
      await cancelMatch()
      return NextResponse.json({ ok: true })
    }

    const { data: userA } = await supabase.from('profiles').select('city, lat, lng').eq('id', matchRow!.user_a).single()
    const { data: userB } = await supabase.from('profiles').select('city, lat, lng').eq('id', matchRow!.user_b).single()
    const radiusA = getIntakeRadiusKm(intakeA?.data?.responses ?? null)
    const radiusB = getIntakeRadiusKm(intakeB?.data?.responses ?? null)
    const matchTzRe = await fetchMatchMarketTimezone(supabase, matchRow!.user_a, matchRow!.user_b)
    const meetingMsRe = getFikaTimeMs(weekAnchorMonday, nextSlotId, matchTzRe)
    const venue = await pickVenueForMatch(
      supabase,
      { city: userA?.city ?? null, lat: userA?.lat ?? null, lng: userA?.lng ?? null, radius_km: radiusA },
      { city: userB?.city ?? null, lat: userB?.lat ?? null, lng: userB?.lng ?? null, radius_km: radiusB },
      { meetingAtUtc: meetingMsRe != null ? new Date(meetingMsRe) : undefined }
    )
    if (!venue) {
      await cancelMatch()
      return NextResponse.json({ ok: true })
    }

    const { day: newDay, time: newTime } = slotIdToDisplayTime(nextSlotId)
    await supabase.from('match_candidates').update({
      suggested_venue_id: venue.id,
      default_slot_id: nextSlotId,
      overlapping_slot_ids: candidateSlots,
      updated_at: new Date().toISOString(),
    }).eq('id', matchId)

    const newPayload = {
      proposed_slot_id: nextSlotId,
      proposed_venue_id: venue.id,
      proposed_day: newDay,
      proposed_time: newTime,
      venue_name: venue.name,
      neighborhood: venue.neighborhood ?? venue.city,
      proposal_attempt: 2,
    }

    await sendConciergeAndLog(fromNumber, messageReProposalToDecliner({
      day: newDay,
      time: newTime,
      venueName: venue.name,
      neighborhood: venue.neighborhood ?? venue.city,
    }), 'reproposal_to_decliner', { userId, weekAnchorMonday, matchId })
    if (otherId) {
      const { data: otherProf } = await supabase.from('profiles').select('phone').eq('id', otherId).maybeSingle()
      if (otherProf?.phone) {
        await sendConciergeAndLog(otherProf.phone, messageReProposalToOther({
          day: newDay,
          time: newTime,
          venueName: venue.name,
          neighborhood: venue.neighborhood ?? venue.city,
        }), 'reproposal_to_other', { userId: otherId, weekAnchorMonday, matchId })
      }
      await supabase.from('sms_conversation_states').upsert(
        {
          user_id: otherId,
          week_anchor_monday: weekAnchorMonday,
          match_id: matchId,
          state: SMS_STATES.AWAITING_SECOND_CONFIRM,
          payload: newPayload,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,week_anchor_monday,match_id' }
      )
    }
    await supabase.from('sms_conversation_states').update({
      state: SMS_STATES.AWAITING_SECOND_CONFIRM,
      payload: newPayload,
      last_sendblue_message_handle: messageHandle,
      updated_at: new Date().toISOString(),
    }).eq('id', matchStateRow!.id)
    return NextResponse.json({ ok: true })
  }

  if (matchState === SMS_STATES.AWAITING_SECOND_CONFIRM && matchId && (isMatchYesKeyword(content) || keyword === 'YES')) {
    const proposedSlotId = matchPayload.proposed_slot_id as string
    const proposedVenueId = matchPayload.proposed_venue_id as string
    const proposedDay = matchPayload.proposed_day as string
    const proposedTime = matchPayload.proposed_time as string
    const venueName = (matchPayload.venue_name as string) ?? 'the spot'
    const neighborhood = (matchPayload.neighborhood as string) ?? ''
    const firstYesUserId = matchPayload.first_yes_user_id as string | undefined
    const { data: match } = await supabase.from('match_candidates').select('user_a, user_b').eq('id', matchId).single()
    if (!match) return NextResponse.json({ ok: true })
    const otherId = (firstYesUserId && firstYesUserId !== userId) ? firstYesUserId : (match.user_a === userId ? match.user_b : match.user_a)
    const { data: otherProfile } = await supabase.from('profiles').select('phone, first_name').eq('id', otherId).maybeSingle()
    const currentName = (await supabase.from('profiles').select('first_name').eq('id', userId).single()).data?.first_name?.trim() ?? 'Your match'
    if (otherProfile?.phone) {
      await sendConciergeAndLog(otherProfile.phone, messageProposalToConfirm({
        otherFirstName: currentName,
        day: proposedDay,
        time: proposedTime,
        venueName,
        neighborhood,
      }), 'proposal_to_confirm_other', { userId: otherId, weekAnchorMonday, matchId })
    }
    await supabase.from('match_candidates').update({
      suggested_venue_id: proposedVenueId,
      default_slot_id: proposedSlotId,
    }).eq('id', matchId)
    await supabase.from('sms_conversation_states').upsert(
      {
        user_id: otherId,
        week_anchor_monday: weekAnchorMonday,
        match_id: matchId,
        state: SMS_STATES.AWAITING_FIRST_CONFIRM,
        payload: {
          proposed_slot_id: proposedSlotId,
          proposed_venue_id: proposedVenueId,
          proposed_day: proposedDay,
          proposed_time: proposedTime,
          venue_name: venueName,
          neighborhood,
          first_yes_user_id: userId,
          proposal_attempt: (matchPayload.proposal_attempt as number) ?? 1,
        },
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,week_anchor_monday,match_id' }
    )
    await supabase.from('sms_conversation_states').update({
      state: SMS_STATES.CONFIRMED,
      updated_at: new Date().toISOString(),
    }).eq('id', matchStateRow!.id)
    return NextResponse.json({ ok: true })
  }

  if (matchState === SMS_STATES.AWAITING_AVAILABILITY && matchId) {
    if (isMatchPassKeyword(content) || keyword === 'PASS') {
      await supabase.from('opt_ins').upsert(
        { match_id: matchId, user_id: userId, decision: 'no' },
        { onConflict: 'match_id,user_id' }
      )
      await sendConciergeAndLog(fromNumber, messagePassConfirmation(), 'v2_pass_after_teaser', {
        userId,
        weekAnchorMonday,
        matchId,
      })
      const { data: matchRow } = await supabase
        .from('match_candidates')
        .select('user_a, user_b')
        .eq('id', matchId)
        .maybeSingle()
      const otherId = matchRow ? (matchRow.user_a === userId ? matchRow.user_b : matchRow.user_a) : null
      if (otherId) {
        const { data: otherOpt } = await supabase
          .from('opt_ins')
          .select('decision')
          .eq('match_id', matchId)
          .eq('user_id', otherId)
          .maybeSingle()
        if (otherOpt?.decision === 'yes') {
          const { data: otherProf } = await supabase
            .from('profiles')
            .select('phone')
            .eq('id', otherId)
            .maybeSingle()
          if (otherProf?.phone) {
            await sendConciergeAndLog(otherProf.phone, messageMatchPassed(), 'v2_match_passed_to_other', {
              userId: otherId,
              weekAnchorMonday,
              matchId,
            })
          }
        }
        await supabase
          .from('sms_conversation_states')
          .delete()
          .eq('user_id', otherId)
          .eq('week_anchor_monday', weekAnchorMonday)
          .eq('match_id', matchId)
      }
      await supabase.from('match_candidates').update({
        scheduling_status: 'expired',
        updated_at: new Date().toISOString(),
      }).eq('id', matchId)
      await supabase.from('sms_conversation_states').delete().eq('id', matchStateRow!.id)
      return NextResponse.json({ ok: true })
    }
    await sendConciergeAndLog(
      fromNumber,
      messageAwaitingAvailabilityReady(),
      'v2_awaiting_availability_nudge',
      { userId, weekAnchorMonday, matchId }
    )
    return NextResponse.json({ ok: true })
  }

  if (matchState === SMS_STATES.AWAITING_FIRST_CONFIRM && matchId && (isMatchYesKeyword(content) || keyword === 'YES')) {
    const { data: match } = await supabase.from('match_candidates').select('user_a, user_b, suggested_venue_id').eq('id', matchId).single()
    if (!match?.suggested_venue_id) return NextResponse.json({ ok: true })
    const proposedSlotId = matchPayload.proposed_slot_id as string
    const { data: venue } = await supabase.from('venues').select('name, neighborhood, city').eq('id', match.suggested_venue_id).single()
    const venueName = venue?.name ?? 'the spot'
    const neighborhood = venue?.neighborhood ?? venue?.city ?? ''
    const { day: dayLabel, time: timeStr } = slotIdToDisplayTime(proposedSlotId)
    await supabase.from('match_candidates').update({
      confirmed_venue_id: match.suggested_venue_id,
      confirmed_slot_id: proposedSlotId,
      scheduling_status: 'confirmed',
      confirmed_at: new Date().toISOString(),
    }).eq('id', matchId)
    await supabase.from('sms_conversation_states').update({
      state: SMS_STATES.CONFIRMED,
      updated_at: new Date().toISOString(),
    }).eq('id', matchStateRow!.id)
    await sendConciergeAndLog(fromNumber, messageYoureAllSet(dayLabel, timeStr, venueName, neighborhood), 'youre_all_set', { userId, weekAnchorMonday, matchId })
    const otherUserId = match.user_a === userId ? match.user_b : match.user_a
    const { data: otherProfile } = await supabase.from('profiles').select('phone').eq('id', otherUserId).maybeSingle()
    if (otherProfile?.phone) {
      await sendConciergeAndLog(otherProfile.phone, messageYoureAllSet(dayLabel, timeStr, venueName, neighborhood), 'youre_all_set_other', { userId: otherUserId, weekAnchorMonday, matchId })
    }
    await supabase.from('sms_conversation_states').update({
      state: SMS_STATES.CONFIRMED,
      updated_at: new Date().toISOString(),
    }).eq('user_id', otherUserId).eq('week_anchor_monday', weekAnchorMonday).eq('match_id', matchId)
    return NextResponse.json({ ok: true })
  }

  if (matchState === SMS_STATES.ACCEPTED_SCHEDULING_DAY && matchId) {
    const dayMatch = ['WED','THU','FRI','SAT'].find(d => keyword.includes(d))
    if (dayMatch) {
      await supabase.from('sms_conversation_states').update({
        state: SMS_STATES.SCHEDULING_WINDOW,
        payload: { ...matchPayload, selected_day: dayMatch },
        last_sendblue_message_handle: messageHandle,
        updated_at: new Date().toISOString(),
      }).eq('id', matchStateRow!.id)
      await sendConciergeAndLog(fromNumber, messageSchedulingWindow(), 'scheduling_window', { userId, weekAnchorMonday, matchId })
    } else {
      await sendConciergeAndLog(fromNumber, getFallbackForState(SMS_STATES.ACCEPTED_SCHEDULING_DAY), 'fallback_scheduling_day', { userId, weekAnchorMonday, matchId })
    }
    return NextResponse.json({ ok: true })
  }

  if (matchState === SMS_STATES.SCHEDULING_WINDOW && matchId) {
    const windowMatch = ['MORNING','AFTERNOON','EVENING'].find(w => keyword.includes(w))
    if (windowMatch) {
      const { data: match } = await supabase.from('match_candidates').select('user_a, user_b').eq('id', matchId).single()
      const selectedDay = (matchPayload.selected_day as string) ?? 'THU'
      const dayLower = selectedDay.toLowerCase()
      const [intakeAWin, intakeBWin] = await Promise.all([
        supabase.from('intake_responses_v5').select('responses').eq('user_id', match!.user_a).maybeSingle(),
        supabase.from('intake_responses_v5').select('responses').eq('user_id', match!.user_b).maybeSingle(),
      ])
      const intakeCandidateSlots = candidateSlotIdsForProposalFromIntake(
        intakeAWin?.data?.responses ?? null,
        intakeBWin?.data?.responses ?? null
      )
      let slotIds = intakeCandidateSlots.filter((id) => id.startsWith(dayLower))
      if (slotIds.length === 0) slotIds = intakeCandidateSlots
      const window = windowMatch === 'MORNING' ? 'Morning' : windowMatch === 'AFTERNOON' ? 'Afternoon' : 'Evening'
      let chosenSlot = slotIds[0]
      for (const id of slotIds) {
        const dw = slotIdToDayAndWindow(id)
        if (dw?.window === window) { chosenSlot = id; break }
        chosenSlot = id
      }
      const { data: userA } = await supabase.from('profiles').select('city, lat, lng').eq('id', match!.user_a).single()
      const { data: userB } = await supabase.from('profiles').select('city, lat, lng').eq('id', match!.user_b).single()
      const radiusA = getIntakeRadiusKm(intakeAWin?.data?.responses ?? null)
      const radiusB = getIntakeRadiusKm(intakeBWin?.data?.responses ?? null)
      const matchTzWin = await fetchMatchMarketTimezone(supabase, match!.user_a, match!.user_b)
      const meetingMsWin = chosenSlot ? getFikaTimeMs(weekAnchorMonday, chosenSlot, matchTzWin) : null
      const venue = await pickVenueForMatch(
        supabase,
        { city: userA?.city ?? null, lat: userA?.lat ?? null, lng: userA?.lng ?? null, radius_km: radiusA },
        { city: userB?.city ?? null, lat: userB?.lat ?? null, lng: userB?.lng ?? null, radius_km: radiusB },
        { meetingAtUtc: meetingMsWin != null ? new Date(meetingMsWin) : undefined }
      )
      const timeStr = chosenSlot ? (slotIdToDayAndWindow(chosenSlot) ? '7pm' : '2pm') : '7pm'
      if (venue) {
        await supabase.from('match_candidates').update({
          suggested_venue_id: venue.id,
          default_slot_id: chosenSlot || undefined,
          overlapping_slot_ids: intakeCandidateSlots,
        }).eq('id', matchId)
        await supabase.from('sms_conversation_states').update({
          state: SMS_STATES.VENUE_PROPOSED,
          payload: { ...matchPayload, selected_window: window, slot_id: chosenSlot },
          last_sendblue_message_handle: messageHandle,
          updated_at: new Date().toISOString(),
        }).eq('id', matchStateRow!.id)
        await sendConciergeAndLog(fromNumber, messageVenueProposed(selectedDay, timeStr, venue.name, venue.neighborhood ?? venue.city), 'venue_proposed', { userId, weekAnchorMonday, matchId })
      }
    } else {
      await sendConciergeAndLog(fromNumber, getFallbackForState(SMS_STATES.SCHEDULING_WINDOW), 'fallback_scheduling_window', { userId, weekAnchorMonday, matchId })
    }
    return NextResponse.json({ ok: true })
  }

  if (matchState === SMS_STATES.VENUE_PROPOSED && matchId) {
    if (isConfirmKeyword(content) || keyword === 'CONFIRM') {
      const { data: match } = await supabase.from('match_candidates').select('user_a, user_b, suggested_venue_id').eq('id', matchId).single()
      if (match?.suggested_venue_id) {
        await supabase.from('match_candidates').update({
          confirmed_venue_id: match.suggested_venue_id,
          confirmed_slot_id: matchPayload.slot_id,
          scheduling_status: 'confirmed',
          confirmed_at: new Date().toISOString(),
        }).eq('id', matchId)
        const { data: venue } = await supabase.from('venues').select('name, neighborhood, city').eq('id', match.suggested_venue_id).single()
        const venueName = venue?.name ?? 'the spot'
        const neighborhood = venue?.neighborhood ?? venue?.city ?? ''
        const slotId = matchPayload.slot_id as string
        const dayLabel = slotId ? slotIdToDayAndWindow(slotId)?.day ?? 'Thursday' : 'Thursday'
        const timeStr = '7pm'
        await supabase.from('sms_conversation_states').update({
          state: SMS_STATES.CONFIRMED,
          updated_at: new Date().toISOString(),
        }).eq('id', matchStateRow!.id)
        await sendConciergeAndLog(fromNumber, messageYoureAllSet(dayLabel, timeStr, venueName, neighborhood), 'youre_all_set', { userId, weekAnchorMonday, matchId })
        const otherUserId = match.user_a === userId ? match.user_b : match.user_a
        const { data: otherProfile } = await supabase.from('profiles').select('phone').eq('id', otherUserId).maybeSingle()
        if (otherProfile?.phone) {
          await sendConciergeAndLog(otherProfile.phone, messageYoureAllSet(dayLabel, timeStr, venueName, neighborhood), 'youre_all_set_other', { userId: otherUserId, weekAnchorMonday, matchId })
        }
      }
    } else {
      await sendConciergeAndLog(fromNumber, getFallbackForState(SMS_STATES.VENUE_PROPOSED), 'fallback_venue_proposed', { userId, weekAnchorMonday, matchId })
    }
    return NextResponse.json({ ok: true })
  }

  // ----- Unrecognized: state-aware fallback so we always respond -----
  await sendConciergeAndLog(fromNumber, getFallbackForState((matchState as string) || state), 'fallback_generic', { userId, weekAnchorMonday, matchId: matchId ?? undefined })
  return NextResponse.json({ ok: true })
}
