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
  messageOptInSetAvailability,
  messageSkipped,
  messageEntry,
  messageEntryAfterDeadline,
  messageOnboardingRequired,
  messageEntryReminder,
  messageMatchOffer,
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
  detectRelayIntent,
  messageRelayConfirmToSender,
  messageRelayToOther,
  messageRelayHint,
  messageRelayCouldNotDeliver,
  isFikaToday,
  isFikaTimeInPast,
  messageFikaInPast,
  messageThanksForFeedback,
  messageThanksForFeedbackAgain,
  messageSmsOptOut,
  messageSmsOptBackIn,
  messageConfirmedUpcoming,
  messageRescheduleAck,
  messageCancelAck,
  getFallbackForState,
  fallbackGeneric,
  isOptInKeyword,
  isSkipKeyword,
  isMatchYesKeyword,
  isMatchPassKeyword,
  isProposalDeclineKeyword,
  isConfirmKeyword,
  isResendLinkKeyword,
  isHelpKeyword,
  isStopKeyword,
  isRescheduleKeyword,
  isCancelKeyword,
  isGreetingKeyword,
  getFikaTimeMs,
  pickVenueForMatch,
  messageInactiveMarketReply,
} from '@/lib/sms-agent'
import { getActiveMarketSlugs } from '@/lib/admin-markets'
import { getMarketBySlug } from '@/lib/markets'
import { getTimezoneFromLatLng, getNextMondayPhrase } from '@/lib/sms-day-aware'
import { sendConcierge, isSendblueConfigured } from '@/lib/sendblue'
import { getCurrentBatchWeek, isOnboardingComplete, isPastOptInDeadline } from '@/lib/onboarding'
import type { ProfileRow, IntakeResponsesV5Row } from '@/lib/db-types'
import {
  messageSmsSignupLinkSent,
  messageSmsSignupLinkAlreadySent,
} from '@/lib/sms-signup'
import { insertMessageLedger } from '@/lib/message-ledger'

const CONCIERGE = (process.env.SENDBLUE_CONCIERGE_NUMBER || '').replace(/\D/g, '')

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
  const digits = toNumber.replace(/\D/g, '')
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
    opts?: { userId?: string | null; batchWeek?: string; matchId?: string }
  ) {
    const result = await sendConcierge(toPhone, content)
    await insertMessageLedger(supabase, {
      user_id: opts?.userId ?? null,
      direction: 'outbound',
      peer_phone: toPhone,
      content_snippet: content,
      context,
      message_handle: result.message_handle ?? null,
      batch_week: opts?.batchWeek ?? null,
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
    return NextResponse.json({ ok: true })
  }

  // ----- STOP / opt-out and opt-back-in -----
  const { data: profileForSms } = await supabase
    .from('profiles')
    .select('sms_opted_out_at')
    .eq('id', userId)
    .maybeSingle()
  if (isStopKeyword(content)) {
    await supabase.from('profiles').update({ sms_opted_out_at: new Date().toISOString() }).eq('id', userId)
    await sendConciergeAndLog(fromNumber, messageSmsOptOut(getAppBase(), formatConciergeNumber(CONCIERGE)), 'opt_out', { userId })
    return NextResponse.json({ ok: true })
  }
  if (profileForSms?.sms_opted_out_at) {
    await supabase.from('profiles').update({ sms_opted_out_at: null }).eq('id', userId)
    await sendConciergeAndLog(fromNumber, messageSmsOptBackIn(), 'opt_back_in', { userId })
    return NextResponse.json({ ok: true })
  }

  // ----- Post-Fika feedback: if we already sent "How did your Fika go?" and they're replying, store it -----
  const { data: feedbackMatches } = await supabase
    .from('match_candidates')
    .select('id, user_a, user_b, batch_week, confirmed_slot_id, post_fika_sent_at')
    .or(`user_a.eq.${userId},user_b.eq.${userId}`)
    .eq('scheduling_status', 'confirmed')
    .not('post_fika_sent_at', 'is', null)
    .not('batch_week', 'is', null)
    .not('confirmed_slot_id', 'is', null)
    .order('post_fika_sent_at', { ascending: false })
  const feedbackMatch = (feedbackMatches ?? []).find(
    (m: { batch_week: string; confirmed_slot_id: string }) =>
      m.batch_week && m.confirmed_slot_id && isFikaTimeInPast(m.batch_week, m.confirmed_slot_id)
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

  // ----- Day-of relay: if user has a confirmed Fika today, handle HERE / ON MY WAY / RUNNING LATE / CAN'T MAKE IT -----
  const { data: todayMatches } = await supabase
    .from('match_candidates')
    .select('id, user_a, user_b, batch_week, confirmed_slot_id')
    .or(`user_a.eq.${userId},user_b.eq.${userId}`)
    .eq('scheduling_status', 'confirmed')
    .not('confirmed_slot_id', 'is', null)
    .not('batch_week', 'is', null)
  const todayMatch = (todayMatches ?? []).find(
    (m: { batch_week: string; confirmed_slot_id: string }) =>
      m.batch_week && m.confirmed_slot_id && isFikaToday(m.batch_week, m.confirmed_slot_id)
  )
  if (todayMatch) {
    if (isFikaTimeInPast(todayMatch.batch_week, todayMatch.confirmed_slot_id)) {
      await sendConciergeAndLog(fromNumber, messageFikaInPast(), 'relay_fika_in_past', { userId })
      return NextResponse.json({ ok: true })
    }
    const otherId = todayMatch.user_a === userId ? todayMatch.user_b : todayMatch.user_a
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
    const intent = detectRelayIntent(content)
    const otherFirstName = otherProfile?.first_name?.trim() ?? 'Your match'
    const senderFirstName = senderProfile?.first_name?.trim() ?? 'Your match'
    if (intent) {
      const otherPhone = otherProfile?.phone?.trim()
      if (otherPhone) {
        await sendConciergeAndLog(otherPhone, messageRelayToOther(senderFirstName, intent), 'relay_to_other', { userId: otherId, matchId: todayMatch.id })
        await sendConciergeAndLog(fromNumber, messageRelayConfirmToSender(otherFirstName, intent), 'relay_confirm_sender', { userId })
      } else {
        await sendConciergeAndLog(fromNumber, messageRelayCouldNotDeliver(), 'relay_could_not_deliver', { userId })
      }
    } else {
      await sendConciergeAndLog(fromNumber, messageRelayHint(), 'relay_hint', { userId })
    }
    return NextResponse.json({ ok: true })
  }

  // ----- Confirmed Fika upcoming (not today, or they text on non–Fika day): fun reminder + CTA -----
  const { data: upcomingMatches } = await supabase
    .from('match_candidates')
    .select('id, user_a, user_b, batch_week, confirmed_slot_id, confirmed_venue_id')
    .or(`user_a.eq.${userId},user_b.eq.${userId}`)
    .eq('scheduling_status', 'confirmed')
    .not('batch_week', 'is', null)
    .not('confirmed_slot_id', 'is', null)
    .not('confirmed_venue_id', 'is', null)
  const upcomingMatch = (upcomingMatches ?? []).find((m: { batch_week: string; confirmed_slot_id: string }) => {
    const ms = getFikaTimeMs(m.batch_week, m.confirmed_slot_id)
    return ms != null && ms > Date.now()
  })
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
    await sendConciergeAndLog(fromNumber, messageConfirmedUpcoming(day, time, venueName, neighborhood, getAppBase()), 'confirmed_upcoming', { userId })
    return NextResponse.json({ ok: true })
  }

  const batchWeek = getCurrentBatchWeek()

  // Load global state (user + batch_week, no match)
  const { data: stateRow } = await supabase
    .from('sms_conversation_states')
    .select('*')
    .eq('user_id', userId)
    .eq('batch_week', batchWeek)
    .is('match_id', null)
    .maybeSingle()

  // First contact (no state yet): only send weekly opt-in if onboarding/intake is complete
  if (!stateRow) {
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
      return NextResponse.json({ ok: true })
    }
    const activeSlugs = await getActiveMarketSlugs(supabase)
    const profileMarket = (profile as { market?: string | null })?.market ?? null
    if (profileMarket != null && activeSlugs.length > 0 && !activeSlugs.includes(profileMarket)) {
      const placeLabel = getMarketBySlug(profileMarket)?.label ?? (profile as { city?: string | null })?.city ?? profileMarket
      await sendConciergeAndLog(fromNumber, messageInactiveMarketReply(placeLabel), 'inactive_market_reply', { userId })
      return NextResponse.json({ ok: true })
    }
    // Insert global state row. Only one can exist per (user_id, batch_week) after migration; if we get unique violation, another request already created it — don't send again.
    const { error: insertError } = await supabase.from('sms_conversation_states').insert({
      user_id: userId,
      batch_week: batchWeek,
      match_id: null,
      state: SMS_STATES.AWAITING_OPT_IN,
      payload: {},
      last_sendblue_message_handle: messageHandle || null,
      updated_at: new Date().toISOString(),
    })
    if (insertError) {
      if (insertError.code === '23505') {
        // Unique violation: another request (or merge/complete-intake) already created the row; don't send entry again
        await supabase.from('sms_conversation_states').update({
          updated_at: new Date().toISOString(),
        }).eq('user_id', userId).eq('batch_week', batchWeek).is('match_id', null)
        return NextResponse.json({ ok: true })
      }
      console.error('[sendblue-webhook] first_contact insert state', insertError.message)
      return NextResponse.json({ ok: true })
    }
    console.log('[sendblue-webhook] first_contact sending entry to', fromLast4)
    const nextMondayPhrase = getNextMondayPhrase(getTimezoneFromLatLng(profile?.lat ?? null, profile?.lng ?? null))
    const isGreeting = isGreetingKeyword(content)
    const entryMsg = isPastOptInDeadline(batchWeek) ? messageEntryAfterDeadline(nextMondayPhrase, { firstName: profile?.first_name ?? null, isGreeting }) : messageEntry()
    const entryResult = await sendConciergeAndLog(fromNumber, entryMsg, 'first_contact_entry', { userId, batchWeek })
    console.log('[sendblue-webhook] sendConcierge result', { ok: entryResult.ok, error: entryResult.error, message_handle: entryResult.message_handle })
    if (entryResult.message_handle) {
      await supabase.from('sms_conversation_states').update({
        last_sendblue_message_handle: entryResult.message_handle,
        updated_at: new Date().toISOString(),
      }).eq('user_id', userId).eq('batch_week', batchWeek).is('match_id', null)
    }
    return NextResponse.json({ ok: true })
  }

  const state = stateRow.state
  const keyword = content.toUpperCase().replace(/\s+/g, ' ').trim()
  const payload = (stateRow?.payload as Record<string, unknown>) ?? {}

  // Idempotency: skip if we already processed this message
  if (messageHandle && stateRow?.last_sendblue_message_handle === messageHandle) {
    return NextResponse.json({ ok: true })
  }

  // ----- Awaiting opt-in: IN / SKIP (and FIKA / HI to re-send the prompt); post-deadline = no opt-in -----
  if (state === SMS_STATES.AWAITING_OPT_IN) {
    const activeSlugsForOptIn = await getActiveMarketSlugs(supabase)
    const { data: profileForMarket } = await supabase
      .from('profiles')
      .select('market, city')
      .eq('id', userId)
      .maybeSingle()
    const userMarket = (profileForMarket as { market?: string | null })?.market ?? null
    if (userMarket != null && activeSlugsForOptIn.length > 0 && !activeSlugsForOptIn.includes(userMarket)) {
      const placeLabel = getMarketBySlug(userMarket)?.label ?? (profileForMarket as { city?: string | null })?.city ?? userMarket
      await sendConciergeAndLog(fromNumber, messageInactiveMarketReply(placeLabel), 'inactive_market_reply', { userId })
      return NextResponse.json({ ok: true })
    }
    if (isPastOptInDeadline(batchWeek)) {
      const { data: profile } = await supabase.from('profiles').select('lat, lng, first_name').eq('id', userId).maybeSingle()
      const nextMondayPhrase = getNextMondayPhrase(getTimezoneFromLatLng(profile?.lat ?? null, profile?.lng ?? null))
      const isGreeting = isGreetingKeyword(content)
      await sendConciergeAndLog(fromNumber, messageEntryAfterDeadline(nextMondayPhrase, { firstName: profile?.first_name ?? null, isGreeting }), 'entry_after_deadline', { userId, batchWeek })
      return NextResponse.json({ ok: true })
    }
    if (isOptInKeyword(content) || keyword === 'IN' || keyword === 'YES') {
      await supabase.from('weekly_match_opt_ins').upsert(
        { user_id: userId, batch_week: batchWeek, opted_in_at: new Date().toISOString() },
        { onConflict: 'user_id,batch_week' }
      )
      await supabase.rpc('upsert_global_sms_conversation_state', {
        p_user_id: userId,
        p_batch_week: batchWeek,
        p_state: SMS_STATES.OPTED_IN,
        p_payload: {},
        p_last_sendblue_message_handle: messageHandle,
      })
      const DEFAULT_APP_BASE = 'https://letsfika.vercel.app'
      const appBase = (process.env.APP_CANONICAL_URL ?? '').trim()
        ? process.env.APP_CANONICAL_URL!.trim().replace(/\/$/, '')
        : DEFAULT_APP_BASE
      const availabilityUrl = `${appBase}/app/availability`
      await sendConciergeAndLog(fromNumber, messageOptInSetAvailability(availabilityUrl), 'opt_in_set_availability', { userId, batchWeek })
    } else if (isSkipKeyword(content) || keyword === 'SKIP') {
      await supabase.rpc('upsert_global_sms_conversation_state', {
        p_user_id: userId,
        p_batch_week: batchWeek,
        p_state: SMS_STATES.AWAITING_OPT_IN,
        p_payload: { skipped: true },
        p_last_sendblue_message_handle: messageHandle,
      })
      await sendConciergeAndLog(fromNumber, messageSkipped(), 'skipped', { userId, batchWeek })
    } else if (keyword === 'FIKA' || keyword === 'HI') {
      // Short reminder only — don't re-send the full intro
      await sendConciergeAndLog(fromNumber, messageEntryReminder(), 'entry_reminder', { userId, batchWeek })
    } else {
      await sendConciergeAndLog(fromNumber, getFallbackForState(SMS_STATES.AWAITING_OPT_IN), 'fallback_awaiting_opt_in', { userId, batchWeek })
    }
    return NextResponse.json({ ok: true })
  }

  // Match-offered / YES / PASS: handled when we have a match_id in state (per-match state row)
  // For simplicity, check for match_offered state with match_id
  const { data: matchStateRow } = await supabase
          .from('sms_conversation_states')
    .select('*')
    .eq('user_id', userId)
    .eq('batch_week', batchWeek)
    .not('match_id', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const matchState = matchStateRow?.state
  const matchId = matchStateRow?.match_id
  const matchPayload = (matchStateRow?.payload as Record<string, unknown>) ?? {}

  // ----- HELP: state-aware fallback -----
  if (isHelpKeyword(content)) {
    await sendConciergeAndLog(fromNumber, getFallbackForState(matchState ?? state), 'help_fallback', { userId, batchWeek, matchId: matchId ?? undefined })
    return NextResponse.json({ ok: true })
  }

  // ----- Opted in: re-send availability link on request -----
  if (state === SMS_STATES.OPTED_IN && isResendLinkKeyword(content)) {
    const availabilityUrl = `${getAppBase()}/app/availability`
    await sendConciergeAndLog(fromNumber, messageOptInSetAvailability(availabilityUrl), 'opt_in_resend_link', { userId, batchWeek })
    return NextResponse.json({ ok: true })
  }

  if (matchState === SMS_STATES.MATCH_OFFERED && matchId) {
    if (isMatchYesKeyword(content) || keyword === 'YES') {
      const { data: otherOpt } = await supabase
        .from('opt_ins')
        .select('decision')
        .eq('match_id', matchId)
        .neq('user_id', userId)
        .maybeSingle()
      if (otherOpt?.decision === 'no') {
        await sendConciergeAndLog(fromNumber, messageMatchPassed(), 'match_passed', { userId, batchWeek, matchId })
        await supabase.from('sms_conversation_states').delete().eq('id', matchStateRow!.id)
        return NextResponse.json({ ok: true })
      }
      await supabase.from('opt_ins').upsert(
        { match_id: matchId, user_id: userId, decision: 'yes' },
        { onConflict: 'match_id,user_id' }
      )
      const { data: match } = await supabase
        .from('match_candidates')
        .select('id, user_a, user_b, reasons, overlapping_slot_ids, default_slot_id')
        .eq('id', matchId)
        .single()
      if (!match) {
        await sendConciergeAndLog(fromNumber, "That match is no longer available. We'll send you another soon.", 'match_no_longer_available', { userId, batchWeek, matchId })
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
        await sendConciergeAndLog(fromNumber, messageYesWaitingForOther(), 'yes_waiting_for_other', { userId, batchWeek, matchId })
        await supabase.from('sms_conversation_states').upsert(
          {
            user_id: userId,
            batch_week: batchWeek,
            match_id: matchId,
            state: SMS_STATES.YES_WAITING,
            payload: { ...matchPayload },
            last_sendblue_message_handle: messageHandle,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,batch_week,match_id' }
        )
      } else {
        const firstYesUserId = yesUsers[0].user_id
        const overlapping = (match.overlapping_slot_ids as string[]) ?? []
        const wedSun = overlapping.filter((id: string) => /^(wed|thu|fri|sat|sun)_/.test(id))
        const slotId = (match.default_slot_id as string) ?? wedSun[0]
        if (!slotId) {
          await sendConciergeAndLog(fromNumber, "We couldn't find a time that works for both. We'll try again next week.", 'no_overlap', { userId, batchWeek, matchId })
          return NextResponse.json({ ok: true })
        }
        const { data: userA } = await supabase.from('profiles').select('city').eq('id', match.user_a).single()
        const { data: userB } = await supabase.from('profiles').select('city').eq('id', match.user_b).single()
        const venue = await pickVenueForMatch(supabase, userA?.city ?? null, userB?.city ?? null)
        if (!venue) {
          await sendConciergeAndLog(fromNumber, "We're setting up a spot — we'll text you in a moment.", 'venue_setup', { userId, batchWeek, matchId })
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
        }), 'proposal_to_confirm', { userId, batchWeek, matchId })
        await supabase.from('match_candidates').update({
          suggested_venue_id: venue.id,
          default_slot_id: slotId,
        }).eq('id', matchId)
        await supabase.from('sms_conversation_states').upsert(
          {
            user_id: userId,
            batch_week: batchWeek,
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
          { onConflict: 'user_id,batch_week,match_id' }
        )
      }
    } else if (isMatchPassKeyword(content) || keyword === 'PASS') {
      await supabase.from('opt_ins').upsert(
        { match_id: matchId, user_id: userId, decision: 'no' },
        { onConflict: 'match_id,user_id' }
      )
      await sendConciergeAndLog(fromNumber, messagePassConfirmation(), 'pass_confirmation', { userId, batchWeek, matchId })
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
            await sendConciergeAndLog(otherProf.phone, messageMatchPassed(), 'match_passed_to_other', { userId: otherId, batchWeek, matchId })
          }
        }
        await supabase.from('sms_conversation_states').delete().eq('user_id', otherId).eq('batch_week', batchWeek).eq('match_id', matchId)
      }
      await supabase.from('sms_conversation_states').delete().eq('id', matchStateRow!.id)
    } else {
      await sendConciergeAndLog(fromNumber, getFallbackForState(SMS_STATES.MATCH_OFFERED), 'fallback_match_offered', { userId, batchWeek, matchId })
    }
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
      .select('user_a, user_b, overlapping_slot_ids')
      .eq('id', matchId)
      .single()
    const otherId = matchRow ? (matchRow.user_a === userId ? matchRow.user_b : matchRow.user_a) : null

    const cancelMatch = async () => {
      await supabase.from('match_candidates').update({
        scheduling_status: 'expired',
        updated_at: new Date().toISOString(),
      }).eq('id', matchId)
      await sendConciergeAndLog(fromNumber, messageProposalMaxRetries(), 'proposal_max_retries', { userId, batchWeek, matchId })
      if (otherId) {
        const { data: otherProf } = await supabase.from('profiles').select('phone').eq('id', otherId).maybeSingle()
        if (otherProf?.phone) {
          await sendConciergeAndLog(otherProf.phone, messageProposalMaxRetries(), 'proposal_max_retries_to_other', { userId: otherId, batchWeek, matchId })
        }
        await supabase.from('sms_conversation_states').delete().eq('user_id', otherId).eq('batch_week', batchWeek).eq('match_id', matchId)
      }
      await supabase.from('sms_conversation_states').delete().eq('id', matchStateRow!.id)
    }

    if (proposalAttempt >= 2) {
      await cancelMatch()
      return NextResponse.json({ ok: true })
    }

    const currentSlotId = (matchPayload.proposed_slot_id as string) ?? ''
    const overlapping = (matchRow?.overlapping_slot_ids as string[]) ?? []
    const wedSun = overlapping.filter((id: string) => /^(wed|thu|fri|sat|sun)_/.test(id))
    const nextSlotId = wedSun.find((id: string) => id !== currentSlotId) ?? null

    if (!nextSlotId) {
      await cancelMatch()
      return NextResponse.json({ ok: true })
    }

    const { data: userA } = await supabase.from('profiles').select('city').eq('id', matchRow!.user_a).single()
    const { data: userB } = await supabase.from('profiles').select('city').eq('id', matchRow!.user_b).single()
    const venue = await pickVenueForMatch(supabase, userA?.city ?? null, userB?.city ?? null)
    if (!venue) {
      await cancelMatch()
      return NextResponse.json({ ok: true })
    }

    const { day: newDay, time: newTime } = slotIdToDisplayTime(nextSlotId)
    await supabase.from('match_candidates').update({
      suggested_venue_id: venue.id,
      default_slot_id: nextSlotId,
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
    }), 'reproposal_to_decliner', { userId, batchWeek, matchId })
    if (otherId) {
      const { data: otherProf } = await supabase.from('profiles').select('phone').eq('id', otherId).maybeSingle()
      if (otherProf?.phone) {
        await sendConciergeAndLog(otherProf.phone, messageReProposalToOther({
          day: newDay,
          time: newTime,
          venueName: venue.name,
          neighborhood: venue.neighborhood ?? venue.city,
        }), 'reproposal_to_other', { userId: otherId, batchWeek, matchId })
      }
      await supabase.from('sms_conversation_states').upsert(
        {
          user_id: otherId,
          batch_week: batchWeek,
          match_id: matchId,
          state: SMS_STATES.AWAITING_SECOND_CONFIRM,
          payload: newPayload,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,batch_week,match_id' }
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
      }), 'proposal_to_confirm_other', { userId: otherId, batchWeek, matchId })
    }
    await supabase.from('match_candidates').update({
      suggested_venue_id: proposedVenueId,
      default_slot_id: proposedSlotId,
    }).eq('id', matchId)
    await supabase.from('sms_conversation_states').upsert(
      {
        user_id: otherId,
        batch_week: batchWeek,
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
      { onConflict: 'user_id,batch_week,match_id' }
    )
    await supabase.from('sms_conversation_states').update({
      state: SMS_STATES.CONFIRMED,
      updated_at: new Date().toISOString(),
    }).eq('id', matchStateRow!.id)
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
    await sendConciergeAndLog(fromNumber, messageYoureAllSet(dayLabel, timeStr, venueName, neighborhood), 'youre_all_set', { userId, batchWeek, matchId })
    const otherUserId = match.user_a === userId ? match.user_b : match.user_a
    const { data: otherProfile } = await supabase.from('profiles').select('phone').eq('id', otherUserId).maybeSingle()
    if (otherProfile?.phone) {
      await sendConciergeAndLog(otherProfile.phone, messageYoureAllSet(dayLabel, timeStr, venueName, neighborhood), 'youre_all_set_other', { userId: otherUserId, batchWeek, matchId })
    }
    await supabase.from('sms_conversation_states').update({
      state: SMS_STATES.CONFIRMED,
      updated_at: new Date().toISOString(),
    }).eq('user_id', otherUserId).eq('batch_week', batchWeek).eq('match_id', matchId)
    return NextResponse.json({ ok: true })
  }

  if (matchState === SMS_STATES.ACCEPTED_SCHEDULING_DAY && matchId) {
    const dayMatch = ['WED','THU','FRI','SAT','SUN'].find(d => keyword.includes(d))
    if (dayMatch) {
      await supabase.from('sms_conversation_states').update({
        state: SMS_STATES.SCHEDULING_WINDOW,
        payload: { ...matchPayload, selected_day: dayMatch },
        last_sendblue_message_handle: messageHandle,
        updated_at: new Date().toISOString(),
      }).eq('id', matchStateRow!.id)
      await sendConciergeAndLog(fromNumber, messageSchedulingWindow(), 'scheduling_window', { userId, batchWeek, matchId })
    } else {
      await sendConciergeAndLog(fromNumber, getFallbackForState(SMS_STATES.ACCEPTED_SCHEDULING_DAY), 'fallback_scheduling_day', { userId, batchWeek, matchId })
    }
    return NextResponse.json({ ok: true })
  }

  if (matchState === SMS_STATES.SCHEDULING_WINDOW && matchId) {
    const windowMatch = ['MORNING','AFTERNOON','EVENING'].find(w => keyword.includes(w))
    if (windowMatch) {
      const { data: match } = await supabase.from('match_candidates').select('user_a, user_b, overlapping_slot_ids').eq('id', matchId).single()
      const selectedDay = (matchPayload.selected_day as string) ?? 'THU'
      const dayLower = selectedDay.toLowerCase()
      const slotIds = ((match?.overlapping_slot_ids as string[]) ?? []).filter(id => id.startsWith(dayLower))
      const window = windowMatch === 'MORNING' ? 'Morning' : windowMatch === 'AFTERNOON' ? 'Afternoon' : 'Evening'
      let chosenSlot = slotIds[0]
      for (const id of slotIds) {
        const dw = slotIdToDayAndWindow(id)
        if (dw?.window === window) { chosenSlot = id; break }
        chosenSlot = id
      }
      const { data: userA } = await supabase.from('profiles').select('city').eq('id', match!.user_a).single()
      const { data: userB } = await supabase.from('profiles').select('city').eq('id', match!.user_b).single()
      const venue = await pickVenueForMatch(supabase, userA?.city ?? null, userB?.city ?? null)
      const timeStr = chosenSlot ? (slotIdToDayAndWindow(chosenSlot) ? '7pm' : '2pm') : '7pm'
      if (venue) {
        await supabase.from('match_candidates').update({
          suggested_venue_id: venue.id,
          default_slot_id: chosenSlot || undefined,
        }).eq('id', matchId)
        await supabase.from('sms_conversation_states').update({
          state: SMS_STATES.VENUE_PROPOSED,
          payload: { ...matchPayload, selected_window: window, slot_id: chosenSlot },
          last_sendblue_message_handle: messageHandle,
          updated_at: new Date().toISOString(),
        }).eq('id', matchStateRow!.id)
        await sendConciergeAndLog(fromNumber, messageVenueProposed(selectedDay, timeStr, venue.name, venue.neighborhood ?? venue.city), 'venue_proposed', { userId, batchWeek, matchId })
      }
    } else {
      await sendConciergeAndLog(fromNumber, getFallbackForState(SMS_STATES.SCHEDULING_WINDOW), 'fallback_scheduling_window', { userId, batchWeek, matchId })
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
        await sendConciergeAndLog(fromNumber, messageYoureAllSet(dayLabel, timeStr, venueName, neighborhood), 'youre_all_set', { userId, batchWeek, matchId })
        const otherUserId = match.user_a === userId ? match.user_b : match.user_a
        const { data: otherProfile } = await supabase.from('profiles').select('phone').eq('id', otherUserId).maybeSingle()
        if (otherProfile?.phone) {
          await sendConciergeAndLog(otherProfile.phone, messageYoureAllSet(dayLabel, timeStr, venueName, neighborhood), 'youre_all_set_other', { userId: otherUserId, batchWeek, matchId })
        }
      }
    } else {
      await sendConciergeAndLog(fromNumber, getFallbackForState(SMS_STATES.VENUE_PROPOSED), 'fallback_venue_proposed', { userId, batchWeek, matchId })
    }
    return NextResponse.json({ ok: true })
  }

  // ----- Unrecognized: state-aware fallback so we always respond -----
  await sendConciergeAndLog(fromNumber, getFallbackForState((matchState as string) || state), 'fallback_generic', { userId, batchWeek, matchId: matchId ?? undefined })
  return NextResponse.json({ ok: true })
}
