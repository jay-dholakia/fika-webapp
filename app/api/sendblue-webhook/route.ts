/**
 * Sendblue webhook: receive incoming messages, route Concierge vs Match (relay).
 * POST from Sendblue with: content, from_number, to_number, sendblue_number, message_handle.
 * Optional: set SENDBLUE_WEBHOOK_SECRET and Sendblue webhook secret; we verify X-Webhook-Signature (HMAC-SHA256 of body, hex).
 */

import { NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
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
  messageProposalToConfirmSymmetric,
  messageProposalToConfirmFirstYes,
  messageProposalToConfirmSecondYes,
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
  messageSmsHelpConfirmedUpcoming,
  messageGratitudeAckUpcoming,
  messageSmsAiRateLimited,
  messageConciergeAiFallbackShort,
  messageRescheduleNotSupported,
  messageCancelAck,
  messageCancelRetryInitiator,
  messageCancelRetryOtherUser,
  messageCancelRetryHelp,
  messageCancelAlreadyInCancelRetryFlow,
  messageSmsHelp,
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
  isCancelRetryYesKeyword,
  isCancelRetryNoKeyword,
  isGratitudeOrShortAckKeyword,
  getFikaTimeMs,
  getTodayYmdInTimezone,
  pickVenueForMatch,
  messageInactiveMarketReply,
  messageAvailabilityLockAllSet,
  messageTeaserPreview,
  messageAwaitingAvailabilityReady,
  messageMatchOfferedUnrecognized,
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
  messageSmsSignupLinkSentSequence,
  messageSmsSignupLinkAlreadySent,
} from '@/lib/sms-signup'
import { insertMessageLedger } from '@/lib/message-ledger'
import {
  countConfirmedFikaAiRepliesLast24h,
  fetchConfirmedFikaConciergeReply,
  getOpenAiKeyForSms,
  getSmsAiMaxPer24h,
  CONFIRMED_FIKA_CONCIERGE_AI_CONTEXT,
} from '@/lib/sms-concierge-ai'
import { formatYoureAllSetDateLine, formatYoureAllSetVenueLine } from '@/lib/youre-all-set-format'
import {
  CANCEL_RETRY_SCHEDULING_STATUS,
  buildInitialCancelRetryFlow,
  parseCancelRetryFlow,
  applyRetryAnswer,
  outcomeFromDecisions,
} from '@/lib/cancel-retry-flow'
import { completeCancelRetryMatch } from '@/lib/cancel-retry-notify'

const CONCIERGE_RAW = (process.env.SENDBLUE_CONCIERGE_NUMBER || '').replace(/\D/g, '')
/** Normalize to 10 digits for US numbers (strip leading 1) so 13102102404 and 3102102404 match. */
const CONCIERGE = CONCIERGE_RAW.length === 11 && CONCIERGE_RAW.startsWith('1')
  ? CONCIERGE_RAW.slice(1)
  : CONCIERGE_RAW

function getAppBase(): string {
  const base = (process.env.APP_CANONICAL_URL ?? '').trim().replace(/\/$/, '')
  return base || 'https://letsfika.vercel.app'
}

async function buildYoureAllSetLines(
  supabase: SupabaseClient,
  params: {
    matchUserA: string
    matchUserB: string
    weekAnchorForSlot: string
    slotId: string
    venueId: string | null
    venueNameFallback: string
    neighborhoodFallback: string
  }
): Promise<{ dateLine: string; venueLine: string }> {
  const tz = await fetchMatchMarketTimezone(supabase, params.matchUserA, params.matchUserB)
  const dateLine = formatYoureAllSetDateLine(params.weekAnchorForSlot, params.slotId, tz)
  if (params.venueId) {
    const { data: v } = await supabase
      .from('venues')
      .select('name, address, neighborhood, city')
      .eq('id', params.venueId)
      .maybeSingle()
    const name = (v?.name as string | undefined)?.trim() || params.venueNameFallback
    const venueLine = formatYoureAllSetVenueLine(name, v?.address as string | undefined, v?.neighborhood as string | undefined, v?.city as string | undefined)
    return { dateLine, venueLine }
  }
  const venueLine = formatYoureAllSetVenueLine(
    params.venueNameFallback,
    null,
    params.neighborhoodFallback,
    null
  )
  return { dateLine, venueLine }
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

type ReactionDecision = 'yes' | 'pass' | null

function normalizeReactionDecisionToken(value: string | null | undefined): ReactionDecision {
  if (!value) return null
  const v = value.toLowerCase().trim().replace(/[_\s-]+/g, ' ')
  if (
    v === 'love' ||
    v === 'loved' ||
    v === 'heart' ||
    v === 'hearted' ||
    v === 'like' ||
    v === 'liked' ||
    v === 'thumbs up' ||
    v === 'thumbsup'
  ) {
    return 'yes'
  }
  if (
    v === 'dislike' ||
    v === 'disliked' ||
    v === 'thumbs down' ||
    v === 'thumbsdown'
  ) {
    return 'pass'
  }
  return null
}

function inferReactionDecisionFromContent(content: string): ReactionDecision {
  const c = content.toLowerCase().trim()
  if (!c || c.includes('removed a')) return null
  if (
    c.startsWith('loved ') ||
    c.startsWith('liked ') ||
    c.startsWith('hearted ') ||
    c.includes(' reacted with a heart') ||
    c.includes(' reacted with heart') ||
    c.includes(' reacted with thumbs up')
  ) {
    return 'yes'
  }
  if (
    c.startsWith('disliked ') ||
    c.includes(' reacted with thumbs down')
  ) {
    return 'pass'
  }
  return null
}

function getReactionDecision(body: Record<string, unknown>, content: string): ReactionDecision {
  const direct = normalizeReactionDecisionToken(
    typeof body.reaction === 'string'
      ? body.reaction
      : typeof body.reaction_type === 'string'
        ? body.reaction_type
        : typeof body.tapback === 'string'
          ? body.tapback
          : null
  )
  if (direct) return direct
  return inferReactionDecisionFromContent(content)
}

function getReactionTargetHandle(body: Record<string, unknown>): string | null {
  const candidates = [
    body.associated_message_handle,
    body.associatedMessageHandle,
    body.target_message_handle,
    body.targetMessageHandle,
    body.parent_message_handle,
    body.parentMessageHandle,
    body.referenced_message_handle,
    body.referencedMessageHandle,
  ]
  for (const v of candidates) {
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return null
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
    message_type?: string
    messageType?: string
    service?: string
    reaction?: string
    reaction_type?: string
    tapback?: string
    associated_message_handle?: string
    associatedMessageHandle?: string
    target_message_handle?: string
    targetMessageHandle?: string
    parent_message_handle?: string
    parentMessageHandle?: string
    referenced_message_handle?: string
    referencedMessageHandle?: string
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
  const reactionDecision = getReactionDecision(body as unknown as Record<string, unknown>, content)
  const reactionTargetHandle = getReactionTargetHandle(body as unknown as Record<string, unknown>)

  // Debug logging (visible in Vercel Functions logs)
  const fromLast4 = fromNumber.replace(/\D/g, '').slice(-4)
  console.log('[sendblue-webhook] received', {
    from: `***${fromLast4}`,
    toNumber: toNumber ? '***' + toNumber.replace(/\D/g, '').slice(-4) : '',
    contentLength: content.length,
    messageType: body.message_type ?? body.messageType ?? '',
    service: body.service ?? '',
    reactionDecision,
    hasReactionTargetHandle: Boolean(reactionTargetHandle),
  })

  if (!fromNumber || (!content && !reactionDecision)) {
    return NextResponse.json({ error: 'Missing from_number or content' }, { status: 400 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  const fromPhone = normalizeIncomingPhone(fromNumber)

  function smsFail(message: string, payload: Record<string, unknown>) {
    console.error('[sendblue-webhook]', message, payload)
    return NextResponse.json({ error: message }, { status: 500 })
  }

  async function sendConciergeAndLog(
    toPhone: string,
    content: string,
    context: string,
    opts?: { userId?: string | null; weekAnchorMonday?: string; matchId?: string; mediaUrl?: string | null }
  ) {
    const result = await sendConcierge(toPhone, content, opts?.mediaUrl)
    if (!result.ok) {
      console.error('[sendblue-webhook] sendConcierge failed', {
        context,
        error: result.error,
        toLast4: toPhone.replace(/\D/g, '').slice(-4),
      })
      throw new Error(result.error ?? 'sendblue_send_failed')
    }
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

  try {
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
    const signupSampleImageUrl = `${appBase}/images/jay-intro-overlay-literal-edited.png`
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
      return smsFail('onboarding_sessions_insert_failed', { message: insertErr.message })
    }
    const link = `${appBase}/signup?token=${token}`
    const signupMessages = messageSmsSignupLinkSentSequence(link, signupSampleImageUrl)
    for (let i = 0; i < signupMessages.length; i++) {
      await sendConciergeAndLog(fromNumber, signupMessages[i].content, i === signupMessages.length - 1 ? 'signup_link_sent_url' : 'signup_link_sent', {
        mediaUrl: signupMessages[i].mediaUrl ?? null,
      })
      if (i < signupMessages.length - 1) {
        await new Promise((r) => setTimeout(r, 1000))
      }
    }
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

  // ----- Cancel / retry intro (no rescheduling): YES/NO after a confirmed Fika was cancelled -----
  const { data: cancelRetryRows } = await supabase
    .from('match_candidates')
    .select('id, user_a, user_b, cancel_retry_flow')
    .or(`user_a.eq.${userId},user_b.eq.${userId}`)
    .eq('scheduling_status', CANCEL_RETRY_SCHEDULING_STATUS)
    .order('updated_at', { ascending: false })
    .limit(1)
  const cancelRetryRow = cancelRetryRows?.[0] as
    | { id: string; user_a: string; user_b: string; cancel_retry_flow: unknown }
    | undefined
  if (cancelRetryRow) {
    const flow = parseCancelRetryFlow(cancelRetryRow.cancel_retry_flow)
    if (flow && flow.phase === 'cancel_pending_retry') {
      if (isHelpKeyword(content)) {
        await sendConciergeAndLog(fromNumber, messageCancelRetryHelp(), 'cancel_retry_help', {
          userId,
          matchId: cancelRetryRow.id,
        })
        return NextResponse.json({ ok: true })
      }
      if (isCancelKeyword(content)) {
        await sendConciergeAndLog(fromNumber, messageCancelAlreadyInCancelRetryFlow(), 'cancel_retry_already_pending', {
          userId,
          matchId: cancelRetryRow.id,
        })
        return NextResponse.json({ ok: true })
      }

      let yesNo: boolean | null = null
      if (isCancelRetryYesKeyword(content) && !isCancelRetryNoKeyword(content)) {
        yesNo = true
      } else if (isCancelRetryNoKeyword(content)) {
        yesNo = false
      }

      if (yesNo === null) {
        await sendConciergeAndLog(
          fromNumber,
          'Reply YES or NO — want us to try this intro again another time?',
          'cancel_retry_prompt_yes_or_no',
          { userId, matchId: cancelRetryRow.id }
        )
        return NextResponse.json({ ok: true })
      }

      for (let attempt = 0; attempt < 3; attempt++) {
        const { data: fresh } = await supabase
          .from('match_candidates')
          .select('id, user_a, user_b, cancel_retry_flow')
          .eq('id', cancelRetryRow.id)
          .maybeSingle()
        const f = parseCancelRetryFlow(fresh?.cancel_retry_flow)
        if (!f || f.phase !== 'cancel_pending_retry') {
          return NextResponse.json({ ok: true })
        }
        const next = applyRetryAnswer(f, userId, fresh!.user_a, fresh!.user_b, yesNo)
        const outcome = outcomeFromDecisions(next)
        if (outcome) {
          await completeCancelRetryMatch(
            supabase,
            { id: fresh!.id, user_a: fresh!.user_a, user_b: fresh!.user_b },
            next,
            outcome
          )
          return NextResponse.json({ ok: true })
        }
        const { error: updErr } = await supabase
          .from('match_candidates')
          .update({ cancel_retry_flow: next as unknown as Record<string, unknown> })
          .eq('id', fresh!.id)
        if (!updErr) {
          return NextResponse.json({ ok: true })
        }
      }
      return NextResponse.json({ ok: true })
    }
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
        'Reply Yes or No to the time we proposed, or text Help.',
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
      'Reply Yes or No to the time we proposed, or text Help.',
      'availability_ready_no_pending',
      { userId, matchId: matchIdReady }
    )
    return NextResponse.json({ ok: true })
  }

  // Open intro in progress (sms state + match still active): do not run post–Fika “relay closed”
  // logic at all — otherwise we’d query stale confirmed rows and compete with the intro flow.
  const { data: statesWithMatch } = await supabase
    .from('sms_conversation_states')
    .select('match_id')
    .eq('user_id', userId)
    .not('match_id', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(25)
  const stateMatchIds = Array.from(
    new Set(
      (statesWithMatch ?? [])
        .map((r: { match_id: string | null }) => r.match_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
    )
  )
  let userHasActiveMatchSmsFlow = false
  if (stateMatchIds.length > 0) {
    const { data: mcForStates } = await supabase
      .from('match_candidates')
      .select('status')
      .in('id', stateMatchIds)
    userHasActiveMatchSmsFlow = (mcForStates ?? []).some((m: { status: string }) => m.status === 'active')
  }

  // ----- Relay just closed and follow-up not sent yet: send closure + feedback prompt -----
  // Omit entirely while user has an active intro — that path handles their reply first.
  if (!userHasActiveMatchSmsFlow) {
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

  // ----- Confirmed Fika upcoming: keywords deterministic; thanks → ack; else OpenAI (no state changes) -----
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
    const upcomingTz = getTimezoneForMatchFromMap(upcomingMatch, upcomingMarketMap)
    const { data: venueRowUpcoming } = await supabase
      .from('venues')
      .select('name, neighborhood, city')
      .eq('id', upcomingMatch.confirmed_venue_id)
      .single()
    const { day: upDay, time: upTime } = slotIdToDisplayTime(upcomingMatch.confirmed_slot_id)
    const venueNameUp = venueRowUpcoming?.name ?? 'the spot'
    const neighborhoodUp = venueRowUpcoming?.neighborhood ?? venueRowUpcoming?.city ?? ''
    const webappUrlUp = getAppBase()
    const inRelayUpcoming = isInRelayWindow(
      upcomingMatch.week_anchor_monday,
      upcomingMatch.confirmed_slot_id,
      upcomingTz
    )

    if (isHelpKeyword(content)) {
      await sendConciergeAndLog(
        fromNumber,
        messageSmsHelpConfirmedUpcoming({
          day: upDay,
          time: upTime,
          venueName: venueNameUp,
          neighborhood: neighborhoodUp,
        }),
        'confirmed_upcoming_help',
        { userId, matchId: upcomingMatch.id }
      )
      await new Promise((r) => setTimeout(r, 1000))
      await sendConciergeAndLog(fromNumber, webappUrlUp, 'confirmed_upcoming_help_url', { userId })
      return NextResponse.json({ ok: true })
    }

    if (isRescheduleKeyword(content)) {
      await sendConciergeAndLog(
        fromNumber,
        messageRescheduleNotSupported(webappUrlUp),
        'reschedule_not_supported',
        { userId, matchId: upcomingMatch.id }
      )
      return NextResponse.json({ ok: true })
    }
    if (isCancelKeyword(content)) {
      const otherId = upcomingMatch.user_a === userId ? upcomingMatch.user_b : upcomingMatch.user_a
      const flow = buildInitialCancelRetryFlow({
        initiatorUserId: userId,
        snapshot: {
          cancelled_confirmed_slot_id: upcomingMatch.confirmed_slot_id,
          cancelled_confirmed_venue_id: upcomingMatch.confirmed_venue_id,
          cancelled_week_anchor_monday: upcomingMatch.week_anchor_monday,
        },
      })
      const { error: cancelUpdErr } = await supabase
        .from('match_candidates')
        .update({
          scheduling_status: CANCEL_RETRY_SCHEDULING_STATUS,
          cancel_retry_flow: flow as unknown as Record<string, unknown>,
          confirmed_slot_id: null,
          confirmed_venue_id: null,
          confirmed_at: null,
        })
        .eq('id', upcomingMatch.id)
      if (cancelUpdErr) {
        console.error('[sendblue-webhook] cancel_retry persist failed', cancelUpdErr)
        await sendConciergeAndLog(fromNumber, messageCancelAck(), 'cancel_ack_fallback', { userId, matchId: upcomingMatch.id })
        return NextResponse.json({ ok: true })
      }
      await sendConciergeAndLog(fromNumber, messageCancelRetryInitiator(), 'cancel_retry_initiator', {
        userId,
        matchId: upcomingMatch.id,
      })
      const { data: otherProfileCancel } = await supabase.from('profiles').select('phone').eq('id', otherId).maybeSingle()
      const otherPhoneCancel = otherProfileCancel?.phone?.trim()
      if (otherPhoneCancel) {
        await sendConciergeAndLog(otherPhoneCancel, messageCancelRetryOtherUser(), 'cancel_retry_notify_other', {
          userId: otherId,
          matchId: upcomingMatch.id,
        })
      }
      return NextResponse.json({ ok: true })
    }

    if (isGratitudeOrShortAckKeyword(content)) {
      await sendConciergeAndLog(fromNumber, messageGratitudeAckUpcoming(), 'confirmed_upcoming_gratitude_ack', {
        userId,
        matchId: upcomingMatch.id,
      })
      return NextResponse.json({ ok: true })
    }

    const aiCount = await countConfirmedFikaAiRepliesLast24h(supabase, userId)
    if (aiCount >= getSmsAiMaxPer24h()) {
      await sendConciergeAndLog(fromNumber, messageSmsAiRateLimited(), 'confirmed_fika_concierge_ai_rate_limited', {
        userId,
        matchId: upcomingMatch.id,
      })
      return NextResponse.json({ ok: true })
    }

    const apiKey = getOpenAiKeyForSms()
    const fikaSummary = `Confirmed Fika: ${upDay} at ${upTime} at ${venueNameUp} (${neighborhoodUp}).`
    const relayWindowDescription = inRelayUpcoming
      ? 'Right now the user is inside the coordination window (~3 hours before through ~2 hours after start): messages here may be relayed to their intro for last-minute coordination.'
      : 'The user is not in that coordination window yet; it opens ~3 hours before start. They cannot change the scheduled time by text; they can reply Cancel if they cannot make it, or Help.'
    const allowedActionsLine =
      'Keyword actions only: Help and Cancel (for backing out of this Fika). Reschedule is not available by SMS. Other texts must not be treated as scheduling changes.'

    if (!apiKey) {
      await sendConciergeAndLog(fromNumber, messageConciergeAiFallbackShort(webappUrlUp), 'confirmed_fika_concierge_ai_no_key', {
        userId,
        matchId: upcomingMatch.id,
      })
      return NextResponse.json({ ok: true })
    }

    const aiReply = await fetchConfirmedFikaConciergeReply({
      apiKey,
      userMessage: content,
      fikaSummary,
      relayWindowDescription,
      allowedActionsLine,
    })
    if (!aiReply.ok) {
      console.error('[sendblue-webhook] confirmed Fika concierge AI failed', aiReply.error)
      await sendConciergeAndLog(fromNumber, messageConciergeAiFallbackShort(webappUrlUp), 'confirmed_fika_concierge_ai_error', {
        userId,
        matchId: upcomingMatch.id,
      })
      return NextResponse.json({ ok: true })
    }
    await sendConciergeAndLog(fromNumber, aiReply.text, CONFIRMED_FIKA_CONCIERGE_AI_CONTEXT, {
      userId,
      matchId: upcomingMatch.id,
    })
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
  const isMatchYesSignal = isMatchYesKeyword(content) || keyword === 'YES' || reactionDecision === 'yes'
  const isMatchPassSignal = isMatchPassKeyword(content) || keyword === 'PASS' || reactionDecision === 'pass'

  // Recovery path: if a user replies YES/PASS but match state row is missing,
  // resolve their latest active match so we still treat the reply as a match response.
  if (!matchId && (isMatchYesSignal || isMatchPassSignal)) {
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
    await sendConciergeAndLog(fromNumber, messageSmsHelp(), 'help', { userId, weekAnchorMonday, matchId: matchId ?? undefined })
    return NextResponse.json({ ok: true })
  }

  const protocolV2Enabled = process.env.SMS_PROTOCOL_V2_ENABLED === 'true'
  const appBase = getAppBase()

  if (matchState === SMS_STATES.MATCH_OFFERED && matchId) {
    if (isMatchYesSignal) {
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
        return smsFail('opt_in_upsert_failed', { userId, matchId, message: optInUpsertError.message })
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
            return smsFail('yes_users_empty_v2', { userId, weekAnchorMonday, matchId })
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
            return smsFail('pick_venue_for_match_failed_v2', {
              userId,
              weekAnchorMonday,
              matchId,
              meetingMsUtc: meetingMsV2,
            })
          }

          const { day: proposedDay, time: proposedTime } = slotIdToDisplayTime(slotId)
          const meetingDateLabelV2 = formatMeetingDateLabel(new Date(meetingMsV2), matchTzV2)
          const proposalFields = {
            meetingDateLabel: meetingDateLabelV2 || proposedDay,
            time: proposedTime,
            venueName: venue.name,
            neighborhood: venue.neighborhood ?? venue.city,
          }

          // Second person to say YES (this inbound) gets the "Awesome — we're lining up…" message;
          // first YES-er gets copy that names the other person and avoids duplicate "Awesome."
          await sendConciergeAndLog(
            fromNumber,
            messageProposalToConfirmSecondYes(proposalFields),
            'proposal_to_confirm',
            { userId, weekAnchorMonday: proposalWeekAnchorMonday, matchId }
          )

          if (otherId && otherProfile?.phone) {
            await sendConciergeAndLog(
              otherProfile.phone,
              messageProposalToConfirmFirstYes({
                otherFirstName: currentName,
                ...proposalFields,
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
          return smsFail('yes_users_empty_v1', { userId, weekAnchorMonday, matchId })
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
        const proposalFieldsV1 = {
          meetingDateLabel: meetingDateLabelV1 || proposedDay,
          time: proposedTime,
          venueName: venue.name,
          neighborhood: venue.neighborhood ?? venue.city,
        }
        await sendConciergeAndLog(
          fromNumber,
          messageProposalToConfirmSecondYes(proposalFieldsV1),
          'proposal_to_confirm',
          { userId, weekAnchorMonday: proposalWeekAnchorMonday, matchId }
        )
        if (otherId && otherPhoneProfile?.phone) {
          await sendConciergeAndLog(
            otherPhoneProfile.phone,
            messageProposalToConfirmFirstYes({
              otherFirstName: currentName,
              ...proposalFieldsV1,
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
    } else if (isMatchPassSignal) {
      const { error: passUpsertError } = await supabase.from('opt_ins').upsert(
        { match_id: matchId, user_id: userId, decision: PASS_DECISION },
        { onConflict: 'match_id,user_id' }
      )
      if (passUpsertError) {
        console.error('[sendblue-webhook] pass upsert failed', { userId, matchId, error: passUpsertError })
        return smsFail('pass_upsert_failed', { userId, matchId, message: passUpsertError.message })
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
      await sendConciergeAndLog(fromNumber, messageMatchOfferedUnrecognized(), 'match_offered_unrecognized_nudge', {
        userId,
        weekAnchorMonday,
        matchId,
      })
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
    const { data: match } = await supabase
      .from('match_candidates')
      .select('user_a, user_b, suggested_venue_id, scheduling_status, week_anchor_monday')
      .eq('id', matchId)
      .single()
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

    const weekAnchorForSlot = (match.week_anchor_monday as string | null) ?? weekAnchorMonday
    const { dateLine, venueLine } = await buildYoureAllSetLines(supabase, {
      matchUserA: match.user_a,
      matchUserB: match.user_b,
      weekAnchorForSlot,
      slotId: proposedSlotId,
      venueId: match.suggested_venue_id ?? null,
      venueNameFallback: venueName,
      neighborhoodFallback: neighborhood,
    })
    const { data: nameRows } = await supabase
      .from('profiles')
      .select('id, first_name')
      .in('id', [userId, otherId])
    const nameFor = (id: string) =>
      (nameRows ?? []).find((r: { id: string }) => r.id === id)?.first_name?.trim() ?? 'your intro'
    await sendConciergeAndLog(
      fromNumber,
      messageYoureAllSet({ otherFirstName: nameFor(otherId), dateLine, venueLine }),
      'youre_all_set',
      { userId, weekAnchorMonday, matchId }
    )
    const { data: otherProfile } = await supabase.from('profiles').select('phone').eq('id', otherId).maybeSingle()
    if (otherProfile?.phone) {
      await sendConciergeAndLog(
        otherProfile.phone,
        messageYoureAllSet({ otherFirstName: nameFor(userId), dateLine, venueLine }),
        'youre_all_set_other',
        { userId: otherId, weekAnchorMonday, matchId }
      )
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
    const { data: match } = await supabase
      .from('match_candidates')
      .select('user_a, user_b, suggested_venue_id, week_anchor_monday')
      .eq('id', matchId)
      .single()
    if (!match?.suggested_venue_id) return NextResponse.json({ ok: true })
    const proposedSlotId = matchPayload.proposed_slot_id as string
    const { data: venue } = await supabase
      .from('venues')
      .select('name, neighborhood, city, address')
      .eq('id', match.suggested_venue_id)
      .single()
    const venueName = venue?.name ?? 'the spot'
    const neighborhood = venue?.neighborhood ?? venue?.city ?? ''
    const weekAnchorForSlot = (match.week_anchor_monday as string | null) ?? weekAnchorMonday
    const { dateLine, venueLine } = await buildYoureAllSetLines(supabase, {
      matchUserA: match.user_a,
      matchUserB: match.user_b,
      weekAnchorForSlot,
      slotId: proposedSlotId,
      venueId: match.suggested_venue_id,
      venueNameFallback: venueName,
      neighborhoodFallback: neighborhood,
    })
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
    const otherUserId = match.user_a === userId ? match.user_b : match.user_a
    const { data: nameRowsFirst } = await supabase
      .from('profiles')
      .select('id, first_name')
      .in('id', [userId, otherUserId])
    const nameForFirst = (id: string) =>
      (nameRowsFirst ?? []).find((r: { id: string }) => r.id === id)?.first_name?.trim() ?? 'your intro'
    await sendConciergeAndLog(
      fromNumber,
      messageYoureAllSet({ otherFirstName: nameForFirst(otherUserId), dateLine, venueLine }),
      'youre_all_set',
      { userId, weekAnchorMonday, matchId }
    )
    const { data: otherProfile } = await supabase.from('profiles').select('phone').eq('id', otherUserId).maybeSingle()
    if (otherProfile?.phone) {
      await sendConciergeAndLog(
        otherProfile.phone,
        messageYoureAllSet({ otherFirstName: nameForFirst(userId), dateLine, venueLine }),
        'youre_all_set_other',
        { userId: otherUserId, weekAnchorMonday, matchId }
      )
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
      return smsFail('unrecognized_scheduling_day_reply', {
        userId,
        weekAnchorMonday,
        matchId,
        contentPreview: content.slice(0, 80),
      })
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
      if (!venue) {
        return smsFail('pick_venue_for_match_failed_scheduling_window', {
          userId,
          weekAnchorMonday,
          matchId,
          chosenSlot: chosenSlot ?? null,
        })
      }
      const timeStr = chosenSlot ? (slotIdToDayAndWindow(chosenSlot) ? '7pm' : '2pm') : '7pm'
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
    } else {
      return smsFail('unrecognized_scheduling_window_reply', {
        userId,
        weekAnchorMonday,
        matchId,
        contentPreview: content.slice(0, 80),
      })
    }
    return NextResponse.json({ ok: true })
  }

  if (matchState === SMS_STATES.VENUE_PROPOSED && matchId) {
    if (isConfirmKeyword(content) || keyword === 'CONFIRM') {
      const { data: match } = await supabase
        .from('match_candidates')
        .select('user_a, user_b, suggested_venue_id, week_anchor_monday, default_slot_id')
        .eq('id', matchId)
        .single()
      if (match?.suggested_venue_id) {
        const slotId =
          (typeof matchPayload.slot_id === 'string' && matchPayload.slot_id.trim()
            ? matchPayload.slot_id
            : null) ??
          (match.default_slot_id as string | null) ??
          'wed_14_30'
        await supabase.from('match_candidates').update({
          confirmed_venue_id: match.suggested_venue_id,
          confirmed_slot_id: slotId,
          scheduling_status: 'confirmed',
          confirmed_at: new Date().toISOString(),
        }).eq('id', matchId)
        const { data: venue } = await supabase
          .from('venues')
          .select('name, neighborhood, city, address')
          .eq('id', match.suggested_venue_id)
          .single()
        const venueName = venue?.name ?? 'the spot'
        const neighborhood = venue?.neighborhood ?? venue?.city ?? ''
        const weekAnchorForSlot = (match.week_anchor_monday as string | null) ?? weekAnchorMonday
        const { dateLine, venueLine } = await buildYoureAllSetLines(supabase, {
          matchUserA: match.user_a,
          matchUserB: match.user_b,
          weekAnchorForSlot,
          slotId: slotId || 'wed_19_0',
          venueId: match.suggested_venue_id,
          venueNameFallback: venueName,
          neighborhoodFallback: neighborhood,
        })
        await supabase.from('sms_conversation_states').update({
          state: SMS_STATES.CONFIRMED,
          updated_at: new Date().toISOString(),
        }).eq('id', matchStateRow!.id)
        const otherUserId = match.user_a === userId ? match.user_b : match.user_a
        const { data: nameRowsVenue } = await supabase
          .from('profiles')
          .select('id, first_name')
          .in('id', [userId, otherUserId])
        const nameForVenue = (id: string) =>
          (nameRowsVenue ?? []).find((r: { id: string }) => r.id === id)?.first_name?.trim() ?? 'your intro'
        await sendConciergeAndLog(
          fromNumber,
          messageYoureAllSet({ otherFirstName: nameForVenue(otherUserId), dateLine, venueLine }),
          'youre_all_set',
          { userId, weekAnchorMonday, matchId }
        )
        const { data: otherProfile } = await supabase.from('profiles').select('phone').eq('id', otherUserId).maybeSingle()
        if (otherProfile?.phone) {
          await sendConciergeAndLog(
            otherProfile.phone,
            messageYoureAllSet({ otherFirstName: nameForVenue(userId), dateLine, venueLine }),
            'youre_all_set_other',
            { userId: otherUserId, weekAnchorMonday, matchId }
          )
        }
      }
    } else {
      return smsFail('unrecognized_venue_proposed_reply', {
        userId,
        weekAnchorMonday,
        matchId,
        contentPreview: content.slice(0, 80),
      })
    }
    return NextResponse.json({ ok: true })
  }

  return smsFail('unhandled_inbound_sms', {
    userId,
    weekAnchorMonday,
    matchId: matchId ?? undefined,
    state,
    matchState,
    contentPreview: content.slice(0, 80),
  })
  } catch (e) {
    console.error('[sendblue-webhook] unhandled', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'internal_error' },
      { status: 500 }
    )
  }
}
