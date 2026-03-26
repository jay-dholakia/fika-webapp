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
  messageRescheduleLimitReached,
  messageRescheduleHeadsUpToOther,
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
  getTodayYmdInTimezone,
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
import { candidateSlotIdsForProposalFromIntake, getTypicalFikaSelectionsFromResponses, nextAlternateProposalSlot } from '@/lib/intake-typical-times'
import { getCurrentWeekAnchorMonday, isOnboardingComplete } from '@/lib/onboarding'
import {
  buildUserMarketMap,
  fetchMatchMarketTimezone,
  getTimezoneForMatchFromMap,
} from '@/lib/match-market-timezone'
import { localDateTimeInTzToUtcMs } from '@/lib/wall-time-to-utc'
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

function formatMeetingDateLabel(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: '2-digit',
  }).format(date)
}

/**
 * Add calendar days to a YYYY-MM-DD value, in a given IANA timezone.
 * This avoids “48 hours” drift and matches the “same local calendar day + 2” rule.
 */
function addDaysYmdInTimezone(ymd: string, days: number, timeZone: string): string {
  const [yStr, mStr, dStr] = ymd.split('-')
  const y = Number.parseInt(yStr, 10)
  const m = Number.parseInt(mStr, 10)
  const d = Number.parseInt(dStr, 10)
  const base = new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
  base.setUTCDate(base.getUTCDate() + days)
  return base.toLocaleDateString('en-CA', { timeZone })
}

function getWeekAnchorMondayForYmd(ymd: string): string {
  // Anchor is Monday YYYY-MM-DD (UTC), consistent with getCurrentWeekAnchorMonday().
  const d = new Date(`${ymd}T12:00:00Z`)
  const day = d.getUTCDay()
  const date = d.getUTCDate()
  const diff = date - day + (day === 0 ? -6 : 1)
  const monday = new Date(d)
  monday.setUTCDate(diff)
  return monday.toISOString().slice(0, 10)
}

function dayPrefixForYmdInTz(ymd: string, timeZone: string): 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun' {
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(new Date(`${ymd}T12:00:00Z`))
  const w = weekday.toLowerCase()
  if (w.startsWith('mon')) return 'mon'
  if (w.startsWith('tue')) return 'tue'
  if (w.startsWith('wed')) return 'wed'
  if (w.startsWith('thu')) return 'thu'
  if (w.startsWith('fri')) return 'fri'
  if (w.startsWith('sat')) return 'sat'
  return 'sun'
}

type TypicalTimeKey =
  | 'weekday_morning'
  | 'weekday_afternoon'
  | 'weekday_evening'
  | 'weekend_morning'
  | 'weekend_afternoon'
  | 'weekend_evening'

function typicalKeysFromSelections(selections: string[]): Set<TypicalTimeKey> {
  const set = new Set<TypicalTimeKey>()
  for (const opt of selections) {
    switch (opt) {
      case 'Weekday mornings':
        set.add('weekday_morning')
        break
      case 'Weekday afternoons':
        set.add('weekday_afternoon')
        break
      case 'Weekday evenings':
        set.add('weekday_evening')
        break
      case 'Weekend mornings':
        set.add('weekend_morning')
        break
      case 'Weekend afternoons':
        set.add('weekend_afternoon')
        break
      case 'Weekend evenings':
        set.add('weekend_evening')
        break
      default:
        break
    }
  }
  return set
}

function defaultTypicalKeys(): TypicalTimeKey[] {
  return [
    'weekday_morning',
    'weekday_afternoon',
    'weekday_evening',
    'weekend_morning',
    'weekend_afternoon',
    'weekend_evening',
  ]
}

const TIMES_BY_KEY: Record<TypicalTimeKey, Array<{ hour: number; min: number }>> = {
  weekday_morning: [{ hour: 9, min: 30 }, { hour: 10, min: 30 }],
  weekday_afternoon: [{ hour: 13, min: 0 }, { hour: 14, min: 30 }],
  weekday_evening: [{ hour: 18, min: 0 }, { hour: 18, min: 30 }],
  weekend_morning: [{ hour: 9, min: 30 }, { hour: 10, min: 30 }],
  weekend_afternoon: [{ hour: 13, min: 0 }, { hour: 14, min: 30 }],
  weekend_evening: [{ hour: 18, min: 0 }, { hour: 18, min: 30 }],
}

function generateProposalCandidates(params: {
  responsesA: unknown
  responsesB: unknown
  timeZone: string
}): Array<{ ymd: string; weekAnchorMonday: string; slotId: string; meetingMsUtc: number }> {
  const { responsesA, responsesB, timeZone } = params
  const selA = getTypicalFikaSelectionsFromResponses(responsesA)
  const selB = getTypicalFikaSelectionsFromResponses(responsesB)
  const keysA = typicalKeysFromSelections(selA)
  const keysB = typicalKeysFromSelections(selB)

  const intersection: TypicalTimeKey[] = Array.from(keysA).filter((k) => keysB.has(k))
  const union: TypicalTimeKey[] = Array.from(new Set([...Array.from(keysA), ...Array.from(keysB)]))
  const keys: TypicalTimeKey[] = intersection.length ? intersection : union.length ? union : defaultTypicalKeys()

  const todayYmd = getTodayYmdInTimezone(timeZone)
  const startYmd = addDaysYmdInTimezone(todayYmd, 2, timeZone)

  const out: Array<{ ymd: string; weekAnchorMonday: string; slotId: string; meetingMsUtc: number }> = []
  for (let i = 0; i < 7; i++) {
    const ymd = addDaysYmdInTimezone(startYmd, i, timeZone)
    const dayPrefix = dayPrefixForYmdInTz(ymd, timeZone)
    const isWeekend = dayPrefix === 'sat' || dayPrefix === 'sun'

    for (const k of keys) {
      const kWeekend = k.startsWith('weekend_')
      if (kWeekend !== isWeekend) continue
      for (const t of TIMES_BY_KEY[k]) {
        const slotId = `${dayPrefix}_${t.hour.toString().padStart(2, '0')}_${t.min.toString().padStart(2, '0')}`
        const meetingMsUtc = localDateTimeInTzToUtcMs(ymd, t.hour, t.min, timeZone)
        if (meetingMsUtc == null) continue
        out.push({ ymd, weekAnchorMonday: getWeekAnchorMondayForYmd(ymd), slotId, meetingMsUtc })
      }
    }
  }
  return out
}

const OPT_IN_DECISION = 'opt_in'
const PASS_DECISION = 'pass'

function isOptInDecision(decision: string | null | undefined): boolean {
  return decision === OPT_IN_DECISION || decision === 'yes'
}

function isPassDecision(decision: string | null | undefined): boolean {
  return decision === PASS_DECISION || decision === 'no'
}

function isDuplicateKeyError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code
  const message = (error as { message?: string } | null)?.message ?? ''
  return code === '23505' || message.toLowerCase().includes('duplicate key')
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

  async function setPerMatchSmsState(params: {
    userId: string
    weekAnchorMonday: string
    matchId: string
    state: string
    payload?: Record<string, unknown>
    lastSendblueMessageHandle?: string | null
  }) {
    const { userId, weekAnchorMonday, matchId, state, payload, lastSendblueMessageHandle } = params
    const updatedAt = new Date().toISOString()
    const stateRow = {
      user_id: userId,
      week_anchor_monday: weekAnchorMonday,
      match_id: matchId,
      state,
      payload: payload ?? {},
      updated_at: updatedAt,
      ...(lastSendblueMessageHandle !== undefined ? { last_sendblue_message_handle: lastSendblueMessageHandle } : {}),
    }

    const { data: updatedRows, error: updateError } = await supabase
      .from('sms_conversation_states')
      .update({
        state,
        payload: payload ?? {},
        updated_at: updatedAt,
        ...(lastSendblueMessageHandle !== undefined ? { last_sendblue_message_handle: lastSendblueMessageHandle } : {}),
      })
      .eq('user_id', userId)
      .eq('week_anchor_monday', weekAnchorMonday)
      .eq('match_id', matchId)
      .select('id')
      .limit(1)

    if (updateError) {
      console.error('[sendblue-webhook] per-match state update failed', {
        userId,
        weekAnchorMonday,
        matchId,
        state,
        error: updateError,
      })
      return { ok: false as const, error: updateError }
    }
    if ((updatedRows ?? []).length > 0) return { ok: true as const }

    const { error: insertError } = await supabase.from('sms_conversation_states').insert(stateRow)
    if (!insertError) return { ok: true as const }
    if (!isDuplicateKeyError(insertError)) {
      console.error('[sendblue-webhook] per-match state insert failed', {
        userId,
        weekAnchorMonday,
        matchId,
        state,
        error: insertError,
      })
      return { ok: false as const, error: insertError }
    }

    const { error: retryUpdateError } = await supabase
      .from('sms_conversation_states')
      .update({
        state,
        payload: payload ?? {},
        updated_at: updatedAt,
        ...(lastSendblueMessageHandle !== undefined ? { last_sendblue_message_handle: lastSendblueMessageHandle } : {}),
      })
      .eq('user_id', userId)
      .eq('week_anchor_monday', weekAnchorMonday)
      .eq('match_id', matchId)
    if (retryUpdateError) {
      console.error('[sendblue-webhook] per-match state retry update failed', {
        userId,
        weekAnchorMonday,
        matchId,
        state,
        error: retryUpdateError,
      })
      return { ok: false as const, error: retryUpdateError }
    }
    return { ok: true as const }
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
      // One reschedule per person per match.
      const { data: myMatchState } = await supabase
        .from('sms_conversation_states')
        .select('payload, week_anchor_monday')
        .eq('user_id', userId)
        .eq('match_id', upcomingMatch.id)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      const myPayload = (myMatchState?.payload as Record<string, unknown>) ?? {}
      const rescheduleRequests = (myPayload.reschedule_requests as Record<string, number> | null) ?? {}
      const already = (rescheduleRequests[userId] ?? 0) >= 1
      if (already) {
        await sendConciergeAndLog(fromNumber, messageRescheduleLimitReached(), 'reschedule_limit_reached', { userId, matchId: upcomingMatch.id })
        return NextResponse.json({ ok: true })
      }

      const otherUserId = upcomingMatch.user_a === userId ? upcomingMatch.user_b : upcomingMatch.user_a
      const { data: otherProfile } = await supabase.from('profiles').select('phone').eq('id', otherUserId).maybeSingle()
      if (otherProfile?.phone) {
        await sendConciergeAndLog(otherProfile.phone, messageRescheduleHeadsUpToOther(), 'reschedule_heads_up_other', {
          userId: otherUserId,
          matchId: upcomingMatch.id,
        })
      }

      // Invalidate the old confirmed plan immediately so reminders don't fire.
      await supabase.from('match_candidates').update({
        scheduling_status: 'rescheduling',
        confirmed_slot_id: null,
        confirmed_venue_id: null,
        confirmed_at: null,
      }).eq('id', upcomingMatch.id)

      // Propose an immediate alternative (same as normal proposal logic).
      const matchTz = await fetchMatchMarketTimezone(supabase, upcomingMatch.user_a, upcomingMatch.user_b)
      const [intakeA, intakeB] = await Promise.all([
        supabase.from('intake_responses_v5').select('responses').eq('user_id', upcomingMatch.user_a).maybeSingle(),
        supabase.from('intake_responses_v5').select('responses').eq('user_id', upcomingMatch.user_b).maybeSingle(),
      ])
      const candidates = generateProposalCandidates({
        responsesA: intakeA?.data?.responses ?? null,
        responsesB: intakeB?.data?.responses ?? null,
        timeZone: matchTz,
      })
      const oldSlotId = upcomingMatch.confirmed_slot_id as string | null
      const pick = candidates.find((c) => (oldSlotId ? c.slotId !== oldSlotId : true)) ?? null
      if (!pick) {
        await sendConciergeAndLog(
          fromNumber,
          "We couldn't find a time that works for both. We'll reach out when we find another good Fika intro for you.",
          'reschedule_no_overlap',
          { userId, matchId: upcomingMatch.id }
        )
        return NextResponse.json({ ok: true })
      }

      const { data: profA } = await supabase.from('profiles').select('city, lat, lng, phone, first_name').eq('id', upcomingMatch.user_a).maybeSingle()
      const { data: profB } = await supabase.from('profiles').select('city, lat, lng, phone, first_name').eq('id', upcomingMatch.user_b).maybeSingle()
      const radiusA = getIntakeRadiusKm(intakeA?.data?.responses ?? null)
      const radiusB = getIntakeRadiusKm(intakeB?.data?.responses ?? null)

      const venue = await pickVenueForMatch(
        supabase,
        { city: profA?.city ?? null, lat: profA?.lat ?? null, lng: profA?.lng ?? null, radius_km: radiusA },
        { city: profB?.city ?? null, lat: profB?.lat ?? null, lng: profB?.lng ?? null, radius_km: radiusB },
        { meetingAtUtc: new Date(pick.meetingMsUtc) }
      )
      if (!venue) {
        await sendConciergeAndLog(fromNumber, "We're setting up a spot — we'll text you in a moment.", 'reschedule_venue_setup', {
          userId,
          matchId: upcomingMatch.id,
        })
        return NextResponse.json({ ok: true })
      }

      const proposalWeekAnchorMonday = pick.weekAnchorMonday
      const slotId = pick.slotId
      const meetingMsUtc = pick.meetingMsUtc
      const { day: proposedDay, time: proposedTime } = slotIdToDisplayTime(slotId)
      const meetingDateLabel = formatMeetingDateLabel(new Date(meetingMsUtc), matchTz)

      // Update match and set symmetric confirmation state for both users.
      await supabase.from('match_candidates').update({
        suggested_venue_id: venue.id,
        default_slot_id: slotId,
        overlapping_slot_ids: candidates.map((c) => c.slotId),
        week_anchor_monday: proposalWeekAnchorMonday,
        scheduling_status: 'rescheduling',
      }).eq('id', upcomingMatch.id)

      const nextRescheduleRequests = { ...rescheduleRequests, [userId]: (rescheduleRequests[userId] ?? 0) + 1 }
      const newPayload = {
        proposed_slot_id: slotId,
        proposed_meeting_ms_utc: meetingMsUtc,
        proposed_venue_id: venue.id,
        proposed_day: proposedDay,
        proposed_time: proposedTime,
        venue_name: venue.name,
        neighborhood: venue.neighborhood ?? venue.city,
        proposal_attempt: 1,
        reschedule_requests: nextRescheduleRequests,
      }

      const nameA = profA?.first_name?.trim() ?? 'Your match'
      const nameB = profB?.first_name?.trim() ?? 'Your match'

      // Send proposal to the requester
      await sendConciergeAndLog(
        fromNumber,
        messageProposalToConfirm({
          otherFirstName: otherUserId === upcomingMatch.user_a ? nameA : nameB,
          meetingDateLabel: meetingDateLabel || proposedDay,
          time: proposedTime,
          venueName: venue.name,
          neighborhood: venue.neighborhood ?? venue.city,
        }),
        'reschedule_proposal_to_confirm',
        { userId, matchId: upcomingMatch.id, weekAnchorMonday: proposalWeekAnchorMonday }
      )

      // Send proposal to the other person (if we have phone)
      if (otherProfile?.phone) {
        await sendConciergeAndLog(
          otherProfile.phone,
          messageProposalToConfirm({
            otherFirstName: otherUserId === upcomingMatch.user_a ? nameB : nameA,
            meetingDateLabel: meetingDateLabel || proposedDay,
            time: proposedTime,
            venueName: venue.name,
            neighborhood: venue.neighborhood ?? venue.city,
          }),
          'reschedule_proposal_to_confirm_other',
          { userId: otherUserId, matchId: upcomingMatch.id, weekAnchorMonday: proposalWeekAnchorMonday }
        )
      }

      await setPerMatchSmsState({
        userId,
        weekAnchorMonday: proposalWeekAnchorMonday,
        matchId: upcomingMatch.id,
        state: SMS_STATES.AWAITING_SECOND_CONFIRM,
        payload: { ...newPayload },
        lastSendblueMessageHandle: messageHandle,
      })
      await setPerMatchSmsState({
        userId: otherUserId,
        weekAnchorMonday: proposalWeekAnchorMonday,
        matchId: upcomingMatch.id,
        state: SMS_STATES.AWAITING_SECOND_CONFIRM,
        payload: { ...newPayload },
      })

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
          .filter((o: { decision?: string | null }) => isOptInDecision(o.decision) || isPassDecision(o.decision))
          .map((o: { match_id: string }) => o.match_id)
      )
      const recovered = (recentMatches ?? []).find((m: { id: string }) => !optedMatchIds.has(m.id)) ??
        (recentMatches ?? [])[0]
      if (recovered?.id) {
        matchId = recovered.id
        matchState = SMS_STATES.MATCH_OFFERED
        matchPayload = {}
        await setPerMatchSmsState({
          userId,
          weekAnchorMonday: recovered.week_anchor_monday ?? weekAnchorMonday,
          matchId: recovered.id,
          state: SMS_STATES.MATCH_OFFERED,
          payload: { recovered_missing_match_state: true },
        })
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
      if (isPassDecision(otherOpt?.decision)) {
        await sendConciergeAndLog(fromNumber, messageMatchPassed(), 'match_passed', { userId, weekAnchorMonday, matchId })
        await supabase.from('sms_conversation_states').delete().eq('id', matchStateRow!.id)
        return NextResponse.json({ ok: true })
      }
      const { error: optInUpsertError } = await supabase.from('opt_ins').upsert(
        { match_id: matchId, user_id: userId, decision: OPT_IN_DECISION },
        { onConflict: 'match_id,user_id' }
      )
      if (optInUpsertError) {
        console.error('[sendblue-webhook] opt_in upsert failed', { userId, matchId, error: optInUpsertError })
        await sendConciergeAndLog(
          fromNumber,
          "Got your YES — we're syncing your intro now. We'll text you in a moment.",
          'yes_sync_retry_optin_write_failed',
          { userId, weekAnchorMonday, matchId }
        )
        return NextResponse.json({ ok: true })
      }
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
        .eq('decision', OPT_IN_DECISION)
        .order('answered_at', { ascending: true })
      const yesUsers = yesOpts ?? []
      if (yesUsers.length === 1) {
        await sendConciergeAndLog(fromNumber, messageYesWaitingForOther(), 'yes_waiting_for_other', { userId, weekAnchorMonday, matchId })
        await setPerMatchSmsState({
          userId,
          weekAnchorMonday,
          matchId,
          state: SMS_STATES.YES_WAITING,
          payload: { ...matchPayload },
          lastSendblueMessageHandle: messageHandle,
        })
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
          const firstYesUserId = yesUsers[0]?.user_id
          if (!firstYesUserId) {
            await sendConciergeAndLog(
              fromNumber,
              "Got your YES — we're syncing your intro now. We'll text you in a moment.",
              'yes_sync_retry_v2',
              { userId, weekAnchorMonday, matchId }
            )
            return NextResponse.json({ ok: true })
          }
          const { data: userA } = await supabase.from('profiles').select('city, lat, lng').eq('id', match.user_a).single()
          const { data: userB } = await supabase.from('profiles').select('city, lat, lng').eq('id', match.user_b).single()
          const [intakeA, intakeB] = await Promise.all([
            supabase.from('intake_responses_v5').select('responses').eq('user_id', match.user_a).maybeSingle(),
            supabase.from('intake_responses_v5').select('responses').eq('user_id', match.user_b).maybeSingle(),
          ])
          const radiusA = getIntakeRadiusKm(intakeA?.data?.responses ?? null)
          const radiusB = getIntakeRadiusKm(intakeB?.data?.responses ?? null)
          const matchTzV2 = await fetchMatchMarketTimezone(supabase, match.user_a, match.user_b)
          const candidates = generateProposalCandidates({
            responsesA: intakeA?.data?.responses ?? null,
            responsesB: intakeB?.data?.responses ?? null,
            timeZone: matchTzV2,
          })
          const pick = candidates[0] ?? null
          if (!pick) {
            await sendConciergeAndLog(
              fromNumber,
              "We couldn't find a time that works for both. We'll reach out when we find another good Fika intro for you.",
              'no_overlap',
              { userId, weekAnchorMonday, matchId }
            )
            return NextResponse.json({ ok: true })
          }
          const proposalWeekAnchorMonday = pick.weekAnchorMonday
          const slotId = pick.slotId
          const meetingMsV2 = pick.meetingMsUtc
          const venue = await pickVenueForMatch(
            supabase,
            { city: userA?.city ?? null, lat: userA?.lat ?? null, lng: userA?.lng ?? null, radius_km: radiusA },
            { city: userB?.city ?? null, lat: userB?.lat ?? null, lng: userB?.lng ?? null, radius_km: radiusB },
            { meetingAtUtc: new Date(meetingMsV2) }
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
          const meetingDateLabelV2 = formatMeetingDateLabel(new Date(meetingMsV2), matchTzV2)
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
              meetingDateLabel: meetingDateLabelV2 || proposedDay,
              time: proposedTime,
              venueName: venue.name,
              neighborhood: venue.neighborhood ?? venue.city,
            }),
            'proposal_to_confirm',
            { userId, weekAnchorMonday: proposalWeekAnchorMonday, matchId }
          )

          if (otherId && otherProfile?.phone) {
            await sendConciergeAndLog(
              otherProfile.phone,
              messageProposalToConfirm({
                otherFirstName: currentName,
                meetingDateLabel: meetingDateLabelV2 || proposedDay,
                time: proposedTime,
                venueName: venue.name,
                neighborhood: venue.neighborhood ?? venue.city,
              }),
              'proposal_to_confirm_other_symmetric',
              { userId: otherId, weekAnchorMonday: proposalWeekAnchorMonday, matchId }
            )
          }

          await supabase.from('match_candidates').update({
            suggested_venue_id: venue.id,
            default_slot_id: slotId,
            overlapping_slot_ids: candidates.map((c) => c.slotId),
            week_anchor_monday: proposalWeekAnchorMonday,
          }).eq('id', matchId)

          await setPerMatchSmsState({
            userId,
            weekAnchorMonday: proposalWeekAnchorMonday,
            matchId,
            state: SMS_STATES.AWAITING_SECOND_CONFIRM,
            payload: {
              proposed_slot_id: slotId,
              proposed_meeting_ms_utc: meetingMsV2,
              proposed_venue_id: venue.id,
              proposed_day: proposedDay,
              proposed_time: proposedTime,
              venue_name: venue.name,
              neighborhood: venue.neighborhood ?? venue.city,
              first_yes_user_id: firstYesUserId,
              proposal_attempt: 1,
            },
            lastSendblueMessageHandle: messageHandle,
          })
          if (otherId) {
            await setPerMatchSmsState({
              userId: otherId,
              weekAnchorMonday: proposalWeekAnchorMonday,
              matchId,
              state: SMS_STATES.AWAITING_SECOND_CONFIRM,
              payload: {
                proposed_slot_id: slotId,
                proposed_meeting_ms_utc: meetingMsV2,
                proposed_venue_id: venue.id,
                proposed_day: proposedDay,
                proposed_time: proposedTime,
                venue_name: venue.name,
                neighborhood: venue.neighborhood ?? venue.city,
                first_yes_user_id: firstYesUserId,
                proposal_attempt: 1,
              },
            })
          }
          return NextResponse.json({ ok: true })
        }

        const firstYesUserId = yesUsers[0]?.user_id
        if (!firstYesUserId) {
          await sendConciergeAndLog(
            fromNumber,
            "Got your YES — we're syncing your intro now. We'll text you in a moment.",
            'yes_sync_retry_v1',
            { userId, weekAnchorMonday, matchId }
          )
          return NextResponse.json({ ok: true })
        }
        const { data: userA } = await supabase.from('profiles').select('city, lat, lng').eq('id', match.user_a).single()
        const { data: userB } = await supabase.from('profiles').select('city, lat, lng').eq('id', match.user_b).single()
        const [intakeA, intakeB] = await Promise.all([
          supabase.from('intake_responses_v5').select('responses').eq('user_id', match.user_a).maybeSingle(),
          supabase.from('intake_responses_v5').select('responses').eq('user_id', match.user_b).maybeSingle(),
        ])
        const radiusA = getIntakeRadiusKm(intakeA?.data?.responses ?? null)
        const radiusB = getIntakeRadiusKm(intakeB?.data?.responses ?? null)
        const matchTzV1 = await fetchMatchMarketTimezone(supabase, match.user_a, match.user_b)
        const candidates = generateProposalCandidates({
          responsesA: intakeA?.data?.responses ?? null,
          responsesB: intakeB?.data?.responses ?? null,
          timeZone: matchTzV1,
        })
        const pick = candidates[0] ?? null
        if (!pick) {
          await sendConciergeAndLog(fromNumber, "We couldn't find a time that works for both. We'll reach out when we find another good Fika intro for you.", 'no_overlap', {
            userId,
            weekAnchorMonday,
            matchId,
          })
          return NextResponse.json({ ok: true })
        }

        const proposalWeekAnchorMonday = pick.weekAnchorMonday
        const slotId = pick.slotId
        const meetingMsV1 = pick.meetingMsUtc
        const venue = await pickVenueForMatch(
          supabase,
          { city: userA?.city ?? null, lat: userA?.lat ?? null, lng: userA?.lng ?? null, radius_km: radiusA },
          { city: userB?.city ?? null, lat: userB?.lat ?? null, lng: userB?.lng ?? null, radius_km: radiusB },
          { meetingAtUtc: new Date(meetingMsV1) }
        )
        if (!venue) {
          await sendConciergeAndLog(fromNumber, "We're setting up a spot — we'll text you in a moment.", 'venue_setup', { userId, weekAnchorMonday, matchId })
          return NextResponse.json({ ok: true })
        }
        const { day: proposedDay, time: proposedTime } = slotIdToDisplayTime(slotId)
        const meetingDateLabelV1 = formatMeetingDateLabel(new Date(meetingMsV1), matchTzV1)
        const { data: currentProfile } = await supabase
          .from('profiles')
          .select('first_name')
          .eq('id', userId)
          .single()
        const { data: otherProfile } = await supabase
          .from('profiles')
          .select('first_name')
          .eq('id', firstYesUserId)
          .single()
        const otherName = otherProfile?.first_name?.trim() ?? 'Your match'
        const currentName = currentProfile?.first_name?.trim() ?? 'Your match'
        const { data: pair } = await supabase
          .from('match_candidates')
          .select('user_a, user_b')
          .eq('id', matchId)
          .maybeSingle()
        const otherId = pair ? (pair.user_a === userId ? pair.user_b : pair.user_a) : null
        const { data: otherPhoneProfile } = otherId
          ? await supabase.from('profiles').select('phone').eq('id', otherId).maybeSingle()
          : { data: null as { phone?: string | null } | null }
        await sendConciergeAndLog(fromNumber, messageProposalToConfirm({
          otherFirstName: otherName,
          meetingDateLabel: meetingDateLabelV1 || proposedDay,
          time: proposedTime,
          venueName: venue.name,
          neighborhood: venue.neighborhood ?? venue.city,
        }), 'proposal_to_confirm', { userId, weekAnchorMonday: proposalWeekAnchorMonday, matchId })
        if (otherId && otherPhoneProfile?.phone) {
          await sendConciergeAndLog(
            otherPhoneProfile.phone,
            messageProposalToConfirm({
              otherFirstName: currentName,
              meetingDateLabel: meetingDateLabelV1 || proposedDay,
              time: proposedTime,
              venueName: venue.name,
              neighborhood: venue.neighborhood ?? venue.city,
            }),
            'proposal_to_confirm_other_symmetric',
            { userId: otherId, weekAnchorMonday: proposalWeekAnchorMonday, matchId }
          )
        }
        await supabase.from('match_candidates').update({
          suggested_venue_id: venue.id,
          default_slot_id: slotId,
          overlapping_slot_ids: candidates.map((c) => c.slotId),
          week_anchor_monday: proposalWeekAnchorMonday,
        }).eq('id', matchId)
        await setPerMatchSmsState({
          userId,
          weekAnchorMonday: proposalWeekAnchorMonday,
          matchId,
          state: SMS_STATES.AWAITING_SECOND_CONFIRM,
          payload: {
            proposed_slot_id: slotId,
            proposed_meeting_ms_utc: meetingMsV1,
            proposed_venue_id: venue.id,
            proposed_day: proposedDay,
            proposed_time: proposedTime,
            venue_name: venue.name,
            neighborhood: venue.neighborhood ?? venue.city,
            first_yes_user_id: firstYesUserId,
            proposal_attempt: 1,
          },
          lastSendblueMessageHandle: messageHandle,
        })
        if (otherId) {
          await setPerMatchSmsState({
            userId: otherId,
            weekAnchorMonday: proposalWeekAnchorMonday,
            matchId,
            state: SMS_STATES.AWAITING_SECOND_CONFIRM,
            payload: {
              proposed_slot_id: slotId,
              proposed_meeting_ms_utc: meetingMsV1,
              proposed_venue_id: venue.id,
              proposed_day: proposedDay,
              proposed_time: proposedTime,
              venue_name: venue.name,
              neighborhood: venue.neighborhood ?? venue.city,
              first_yes_user_id: firstYesUserId,
              proposal_attempt: 1,
            },
          })
        }
      }
    } else if (isMatchPassKeyword(content) || keyword === 'PASS') {
      const { error: passUpsertError } = await supabase.from('opt_ins').upsert(
        { match_id: matchId, user_id: userId, decision: PASS_DECISION },
        { onConflict: 'match_id,user_id' }
      )
      if (passUpsertError) {
        console.error('[sendblue-webhook] pass upsert failed', { userId, matchId, error: passUpsertError })
        await sendConciergeAndLog(
          fromNumber,
          "Got your PASS — we're syncing this update now. We'll text you in a moment.",
          'pass_sync_retry_optin_write_failed',
          { userId, weekAnchorMonday, matchId }
        )
        return NextResponse.json({ ok: true })
      }
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
        if (isOptInDecision(otherOpt?.decision)) {
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
    !matchId &&
    (state === SMS_STATES.GLOBAL_READY ||
      state === SMS_STATES.AWAITING_OPT_IN ||
      state === SMS_STATES.OPTED_IN)
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
    const matchTzRe = await fetchMatchMarketTimezone(supabase, matchRow!.user_a, matchRow!.user_b)
    const candidates = generateProposalCandidates({
      responsesA: intakeA?.data?.responses ?? null,
      responsesB: intakeB?.data?.responses ?? null,
      timeZone: matchTzRe,
    })
    const nextPick = (candidates.find((c) => c.slotId !== currentSlotId) ?? null)

    if (!nextPick) {
      await cancelMatch()
      return NextResponse.json({ ok: true })
    }

    const { data: userA } = await supabase.from('profiles').select('city, lat, lng').eq('id', matchRow!.user_a).single()
    const { data: userB } = await supabase.from('profiles').select('city, lat, lng').eq('id', matchRow!.user_b).single()
    const radiusA = getIntakeRadiusKm(intakeA?.data?.responses ?? null)
    const radiusB = getIntakeRadiusKm(intakeB?.data?.responses ?? null)
    const proposalWeekAnchorMonday = nextPick.weekAnchorMonday
    const nextSlotId = nextPick.slotId
    const meetingMsRe = nextPick.meetingMsUtc
    const venue = await pickVenueForMatch(
      supabase,
      { city: userA?.city ?? null, lat: userA?.lat ?? null, lng: userA?.lng ?? null, radius_km: radiusA },
      { city: userB?.city ?? null, lat: userB?.lat ?? null, lng: userB?.lng ?? null, radius_km: radiusB },
      { meetingAtUtc: new Date(meetingMsRe) }
    )
    if (!venue) {
      await cancelMatch()
      return NextResponse.json({ ok: true })
    }

    const { day: newDay, time: newTime } = slotIdToDisplayTime(nextSlotId)
    const meetingDateLabelRe = formatMeetingDateLabel(new Date(meetingMsRe), matchTzRe)
    await supabase.from('match_candidates').update({
      suggested_venue_id: venue.id,
      default_slot_id: nextSlotId,
      overlapping_slot_ids: candidates.map((c) => c.slotId),
      week_anchor_monday: proposalWeekAnchorMonday,
    }).eq('id', matchId)

    const newPayload = {
      proposed_slot_id: nextSlotId,
      proposed_meeting_ms_utc: meetingMsRe,
      proposed_venue_id: venue.id,
      proposed_day: newDay,
      proposed_time: newTime,
      venue_name: venue.name,
      neighborhood: venue.neighborhood ?? venue.city,
      proposal_attempt: 2,
    }

    await sendConciergeAndLog(fromNumber, messageReProposalToDecliner({
      meetingDateLabel: meetingDateLabelRe || newDay,
      time: newTime,
      venueName: venue.name,
      neighborhood: venue.neighborhood ?? venue.city,
    }), 'reproposal_to_decliner', { userId, weekAnchorMonday: proposalWeekAnchorMonday, matchId })
    if (otherId) {
      const { data: otherProf } = await supabase.from('profiles').select('phone').eq('id', otherId).maybeSingle()
      if (otherProf?.phone) {
        await sendConciergeAndLog(otherProf.phone, messageReProposalToOther({
          meetingDateLabel: meetingDateLabelRe || newDay,
          time: newTime,
          venueName: venue.name,
          neighborhood: venue.neighborhood ?? venue.city,
        }), 'reproposal_to_other', { userId: otherId, weekAnchorMonday: proposalWeekAnchorMonday, matchId })
      }
      await setPerMatchSmsState({
        userId: otherId,
        weekAnchorMonday: proposalWeekAnchorMonday,
        matchId,
        state: SMS_STATES.AWAITING_SECOND_CONFIRM,
        payload: newPayload,
      })
    }
    await setPerMatchSmsState({
      userId,
      weekAnchorMonday: proposalWeekAnchorMonday,
      matchId,
      state: SMS_STATES.AWAITING_SECOND_CONFIRM,
      payload: newPayload,
      lastSendblueMessageHandle: messageHandle,
    })
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
    const { data: match } = await supabase.from('match_candidates').select('user_a, user_b, suggested_venue_id, scheduling_status').eq('id', matchId).single()
    if (!match) return NextResponse.json({ ok: true })
    const otherId = (firstYesUserId && firstYesUserId !== userId) ? firstYesUserId : (match.user_a === userId ? match.user_b : match.user_a)
    await setPerMatchSmsState({
      userId,
      weekAnchorMonday,
      matchId,
      state: SMS_STATES.CONFIRMED,
      payload: {
        ...matchPayload,
      },
      lastSendblueMessageHandle: messageHandle,
    })

    const { data: otherState } = await supabase
      .from('sms_conversation_states')
      .select('state')
      .eq('user_id', otherId)
      .eq('week_anchor_monday', weekAnchorMonday)
      .eq('match_id', matchId)
      .maybeSingle()

    const otherConfirmed = otherState?.state === SMS_STATES.CONFIRMED
    if (!otherConfirmed) {
      await sendConciergeAndLog(fromNumber, messageYesWaitingForOther(), 'proposal_yes_waiting_for_other', {
        userId,
        weekAnchorMonday,
        matchId,
      })
      return NextResponse.json({ ok: true })
    }

    if (match.scheduling_status !== 'confirmed' && match.suggested_venue_id) {
      await supabase.from('match_candidates').update({
        confirmed_venue_id: match.suggested_venue_id,
        confirmed_slot_id: proposedSlotId,
        scheduling_status: 'confirmed',
        confirmed_at: new Date().toISOString(),
      }).eq('id', matchId)
    }

    const { day: dayLabel, time: timeStr } = slotIdToDisplayTime(proposedSlotId)
    await sendConciergeAndLog(fromNumber, messageYoureAllSet(dayLabel, timeStr, venueName, neighborhood), 'youre_all_set', { userId, weekAnchorMonday, matchId })
    const { data: otherProfile } = await supabase.from('profiles').select('phone').eq('id', otherId).maybeSingle()
    if (otherProfile?.phone) {
      await sendConciergeAndLog(otherProfile.phone, messageYoureAllSet(dayLabel, timeStr, venueName, neighborhood), 'youre_all_set_other', { userId: otherId, weekAnchorMonday, matchId })
    }
    await setPerMatchSmsState({
      userId: otherId,
      weekAnchorMonday,
      matchId,
      state: SMS_STATES.CONFIRMED,
      payload: { ...matchPayload },
    })
    return NextResponse.json({ ok: true })
  }

  if (matchState === SMS_STATES.AWAITING_AVAILABILITY && matchId) {
    if (isMatchPassKeyword(content) || keyword === 'PASS') {
      const { error: passUpsertError } = await supabase.from('opt_ins').upsert(
        { match_id: matchId, user_id: userId, decision: PASS_DECISION },
        { onConflict: 'match_id,user_id' }
      )
      if (passUpsertError) {
        console.error('[sendblue-webhook] v2 pass upsert failed', { userId, matchId, error: passUpsertError })
        await sendConciergeAndLog(
          fromNumber,
          "Got your PASS — we're syncing this update now. We'll text you in a moment.",
          'v2_pass_sync_retry_optin_write_failed',
          { userId, weekAnchorMonday, matchId }
        )
        return NextResponse.json({ ok: true })
      }
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
        if (isOptInDecision(otherOpt?.decision)) {
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
      let slotIds = intakeCandidateSlots.filter((id: string) => id.startsWith(dayLower))
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
