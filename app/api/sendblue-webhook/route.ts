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
  messageEntry,
  messageOnboardingRequired,
  messageEntryReminder,
  messageFikaUserInitiatedCommitment,
  messageFikaUserInitiatedLinkBody,
  messageTextFikaToGetLink,
  messageOptInWindowClosed,
  messageOptInFilledUp,
  messageRsvpCancelled,
  isCancellationSignal,
  messageSmsOptOut,
  messageSmsOptBackIn,
  messageSmsHelp,
  isMatchYesKeyword,
  isMatchPassKeyword,
  isResendLinkKeyword,
  isHelpKeyword,
  isStopKeyword,
  messageInactiveMarketReply,
  messageWeeklyOptInYes,
  messageWeeklyOptInNo,
} from '@/lib/sms-agent'
import { pickVenueForMatch } from '@/lib/sms-agent'
import { parseAvailability, findEarliestOverlap, formatProposedTime, windowStartToUtc, type TimeWindow } from '@/lib/match/availability'
import { getActiveMarketSlugs } from '@/lib/admin-markets'
import { getMarketBySlug } from '@/lib/markets'
import { sendConcierge, isSendblueConfigured, prepareOutboundAiPresence, markConversationRead } from '@/lib/sendblue'
import { DEFAULT_RADIUS_KM } from '@/lib/intake-radius'
import { getIntakeSingle } from '@/lib/intake-response-utils'
import { isOnboardingComplete } from '@/lib/onboarding'
import { localDateTimeInTzToUtcMs } from '@/lib/wall-time-to-utc'
import type { ProfileRow, IntakeResponsesV5Row } from '@/lib/db-types'
import { handleSmsOnboarding } from '@/lib/sms-onboarding'
import { insertMessageLedger } from '@/lib/message-ledger'
import {
  countGlobalReadyAiRepliesLast24h,
  fetchGlobalReadyConciergeReply,
  getOpenAiKeyForSms,
  getSmsAiMaxGlobalReadyPer24h,
  GLOBAL_READY_CONCIERGE_AI_CONTEXT,
} from '@/lib/sms-concierge-ai'
import { SMS_PACING_MS, sleepForSmsPacing } from '@/lib/sms-pacing'
import { haversineMiles } from '@/lib/fika-social-geo'

const CONCIERGE_RAW = (process.env.SENDBLUE_CONCIERGE_NUMBER || '').replace(/\D/g, '')
/** Normalize to 10 digits for US numbers (strip leading 1) so 13102102404 and 3102102404 match. */
const CONCIERGE = CONCIERGE_RAW.length === 11 && CONCIERGE_RAW.startsWith('1')
  ? CONCIERGE_RAW.slice(1)
  : CONCIERGE_RAW

function getAppBase(): string {
  const base = (process.env.APP_CANONICAL_URL ?? '').trim().replace(/\/$/, '')
  return base || 'https://letsfika.vercel.app'
}

function ageFromBirthdateLabel(birthdate: string | null | undefined): string | null {
  if (!birthdate) return null
  const date = new Date(birthdate)
  if (Number.isNaN(date.getTime())) return null
  const today = new Date()
  let age = today.getFullYear() - date.getFullYear()
  const m = today.getMonth() - date.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < date.getDate())) age--
  return age >= 0 ? String(age) : null
}

function buildIntroCardUrl(params: {
  appBase: string
  avatarUrl?: string | null
  firstName?: string | null
  age?: string | null
}): string | null {
  const avatarUrl = params.avatarUrl?.trim()
  if (!avatarUrl) return null
  const url = new URL('/api/intro-card', params.appBase)
  url.searchParams.set('avatar', avatarUrl)
  if (params.firstName?.trim()) url.searchParams.set('name', params.firstName.trim())
  if (params.age?.trim()) url.searchParams.set('age', params.age.trim())
  return url.toString()
}

function buildVenueMapsUrl(params: {
  name?: string | null
  address?: string | null
  city?: string | null
  lat?: number | null
  lng?: number | null
}): string | null {
  const name = params.name?.trim() ?? ''
  const address = params.address?.trim() ?? ''
  const city = params.city?.trim() ?? ''
  const lat = typeof params.lat === 'number' ? params.lat : Number(params.lat)
  const lng = typeof params.lng === 'number' ? params.lng : Number(params.lng)

  const businessQuery = [name, address || city].filter(Boolean).join(', ').trim()
  if (businessQuery) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(businessQuery)}`
  }
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}`
  }
  return null
}

function buildVenuePreviewUrl(appBase: string, venueId: string | null | undefined): string | null {
  const id = venueId?.trim()
  if (!id) return null
  return new URL(`/v/${encodeURIComponent(id)}`, appBase).toString()
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

  // Fire-and-forget: mark conversation as read so the user sees the read receipt
  markConversationRead(fromPhone).catch(() => {})

  function smsFail(message: string, payload: Record<string, unknown>) {
    console.error('[sendblue-webhook]', message, payload)
    return NextResponse.json({ error: message }, { status: 500 })
  }

  async function sendConciergeAndLog(
    toPhone: string,
    content: string,
    context: string,
    opts?: { userId?: string | null; matchId?: string; mediaUrl?: string | null }
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
      match_id: opts?.matchId ?? null,
    })
    return result
  }

  async function setPerMatchSmsState(params: {
    userId: string
    matchId: string
    state: string
    payload?: Record<string, unknown>
    lastSendblueMessageHandle?: string | null
  }) {
    const { userId, matchId, state, payload, lastSendblueMessageHandle } = params
    const updatedAt = new Date().toISOString()
    const stateRow = {
      user_id: userId,
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
      .eq('match_id', matchId)
      .select('id')
      .limit(1)

    if (updateError) {
      console.error('[sendblue-webhook] per-match state update failed', {
        userId,
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
      .eq('match_id', matchId)
    if (retryUpdateError) {
      console.error('[sendblue-webhook] per-match state retry update failed', {
        userId,
        matchId,
        state,
        error: retryUpdateError,
      })
      return { ok: false as const, error: retryUpdateError }
    }
    return { ok: true as const }
  }

  async function setGlobalSmsState(params: {
    userId: string
    state: string
    payload?: Record<string, unknown>
    lastSendblueMessageHandle?: string | null
  }) {
    const { userId, state, payload, lastSendblueMessageHandle } = params
    const updatedAt = new Date().toISOString()
    const stateRow = {
      user_id: userId,
      match_id: null,
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
      .is('match_id', null)
      .select('id')
      .limit(1)

    if (updateError) {
      console.error('[sendblue-webhook] global state update failed', {
        userId,
        state,
        error: updateError,
      })
      return { ok: false as const, error: updateError }
    }
    if ((updatedRows ?? []).length > 0) return { ok: true as const }

    const { error: insertError } = await supabase.from('sms_conversation_states').insert(stateRow)
    if (!insertError) return { ok: true as const }
    if (!isDuplicateKeyError(insertError)) {
      console.error('[sendblue-webhook] global state insert failed', {
        userId,
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
      .is('match_id', null)
    if (retryUpdateError) {
      console.error('[sendblue-webhook] global state retry update failed', {
        userId,
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
    // ----- Phone-first: unknown number → conversational SMS onboarding -----
    const DEFAULT_APP_BASE = 'https://letsfika.vercel.app'
    const appBase = (process.env.APP_CANONICAL_URL ?? '').trim()
      ? process.env.APP_CANONICAL_URL!.trim().replace(/\/$/, '')
      : DEFAULT_APP_BASE
    const openaiKey = process.env.EXPO_PUBLIC_OPENAI_API_KEY || process.env.OPENAI_API_KEY
    try {
      await handleSmsOnboarding({
        supabase,
        fromPhone,
        content,
        messageHandle: messageHandle || undefined,
        send: async (msg, ctx, opts) => { await sendConciergeAndLog(fromNumber, msg, ctx, { mediaUrl: opts?.mediaUrl }) },
        appBase,
        openaiKey,
      })
    } catch (e) {
      console.error('[sendblue-webhook] sms-onboarding error', e)
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
    await sleepForSmsPacing(SMS_PACING_MS.quickAck)
    await sendConciergeAndLog(fromNumber, webappUrl, 'opt_out_url', { userId })
    return NextResponse.json({ ok: true })
  }
  if (profileForSms?.sms_opted_out_at) {
    await supabase.from('profiles').update({ sms_opted_out_at: null }).eq('id', userId)
    await setGlobalSmsState({ userId, state: SMS_STATES.GLOBAL_READY, payload: {} })
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

  // Load global state (most recent non-match row)
  const { data: stateRow } = await supabase
    .from('sms_conversation_states')
    .select('*')
    .eq('user_id', userId)
    .is('match_id', null)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // Per-match state takes priority.
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
      await sleepForSmsPacing(SMS_PACING_MS.quickAck)
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

    const keyword = content.toUpperCase().replace(/\s+/g, ' ').trim()

    await sendConciergeAndLog(fromNumber, messageEntry(), 'first_contact_ready_for_intro', { userId })
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

  // --- 1v1 per-match state handlers ---
  // These run before global state handlers so a user with an active 1v1 intro always goes here first.
  if (matchId && ['1v1_offered', '1v1_accepted', '1v1_awaiting_availability', '1v1_proposed', '1v1_confirmed', '1v1_morning_reminder'].includes(matchState ?? '')) {
    const activeMatchId = matchId as string

    const { data: matchRow } = await supabase
      .from('match_candidates')
      .select('id, user_a, user_b, reasons')
      .eq('id', activeMatchId)
      .maybeSingle()

    const matchReasons = (matchRow?.reasons as Record<string, unknown>) ?? {}
    const matchUserA = (matchRow?.user_a as string | null) ?? null
    const matchUserB = (matchRow?.user_b as string | null) ?? null
    const otherUserId = matchUserA === userId ? matchUserB : matchUserA

    const cancelMatch = async () => {
      // Load other user's state and profile before deleting rows
      const NOTIFIABLE_STATES = ['1v1_accepted', '1v1_awaiting_availability', '1v1_proposed', '1v1_confirmed', '1v1_morning_reminder']
      let otherShouldBeNotified = false
      let otherPhone: string | null = null
      let otherFirstName: string | null = null
      if (otherUserId) {
        const [{ data: otherStateRow }, { data: otherProf }] = await Promise.all([
          supabase.from('sms_conversation_states').select('state').eq('user_id', otherUserId).eq('match_id', activeMatchId).maybeSingle(),
          supabase.from('profiles').select('phone, first_name').eq('id', otherUserId).maybeSingle(),
        ])
        otherShouldBeNotified = NOTIFIABLE_STATES.includes((otherStateRow?.state as string | null) ?? '')
        otherPhone = (otherProf?.phone as string | null)?.trim() ?? null
        otherFirstName = (otherProf?.first_name as string | null)?.trim() ?? null
      }

      await supabase.from('match_candidates').update({ status: 'cancelled' }).eq('id', activeMatchId)
      for (const uid of [userId, ...(otherUserId ? [otherUserId] : [])]) {
        await supabase.from('sms_conversation_states').delete().eq('user_id', uid).eq('match_id', activeMatchId)
        await setGlobalSmsState({ userId: uid, state: SMS_STATES.GLOBAL_READY, payload: {} })
      }

      await sendConciergeAndLog(
        fromNumber,
        "No worries — we'll reach out when we have another great intro.",
        'match_cancelled_self',
        { userId, matchId: activeMatchId }
      )

      if (otherShouldBeNotified && otherPhone && otherUserId) {
        const myName = (await supabase.from('profiles').select('first_name').eq('id', userId).maybeSingle())
          .data?.first_name?.trim() ?? null
        const partnerLine = myName ? `Unfortunately ${myName} had to cancel` : `Unfortunately your Fika had to be cancelled`
        await sendConciergeAndLog(
          otherPhone,
          `${partnerLine} — we're sorry about that. We'll find you another great intro soon ☕`,
          'match_cancelled_other',
          { userId: otherUserId, matchId: activeMatchId }
        )
      }
    }

    if (matchState === '1v1_offered') {
      if (isMatchYesSignal) {
        await setPerMatchSmsState({
          userId,
          matchId: activeMatchId,
          state: '1v1_accepted',
          payload: { accepted_at: new Date().toISOString() },
        })

        // Fetch other user's acceptance state + profile, and our own name, in parallel
        const [{ data: otherStateRow }, { data: otherProf }, { data: myProf }] = await Promise.all([
          otherUserId
            ? supabase.from('sms_conversation_states')
                .select('state')
                .eq('user_id', otherUserId)
                .eq('match_id', activeMatchId)
                .maybeSingle()
            : Promise.resolve({ data: null }),
          otherUserId
            ? supabase.from('profiles').select('first_name, phone').eq('id', otherUserId).maybeSingle()
            : Promise.resolve({ data: null }),
          supabase.from('profiles').select('first_name').eq('id', userId).maybeSingle(),
        ])

        const otherAlreadyAccepted = (otherStateRow?.state as string | null) === '1v1_accepted'
        const otherFirstName = (otherProf?.first_name as string | null)?.trim() || 'them'
        const otherPhone = (otherProf?.phone as string | null)?.trim() ?? null
        const myFirstName = (myProf?.first_name as string | null)?.trim() || 'them'

        if (otherAlreadyAccepted) {
          // Both accepted — suggest a venue, then ask for availability
          const [{ data: myProfFull }, { data: otherProfFull }, { data: myIntake }, { data: otherIntake }] = await Promise.all([
            supabase.from('profiles').select('lat, lng').eq('id', userId).maybeSingle(),
            otherUserId ? supabase.from('profiles').select('lat, lng').eq('id', otherUserId).maybeSingle() : Promise.resolve({ data: null }),
            supabase.from('intake_responses_v5').select('responses').eq('user_id', userId).maybeSingle(),
            otherUserId ? supabase.from('intake_responses_v5').select('responses').eq('user_id', otherUserId).maybeSingle() : Promise.resolve({ data: null }),
          ])
          const myLoc = { lat: myProfFull?.lat as number | null, lng: myProfFull?.lng as number | null, radius_km: getIntakeSingle(myIntake?.responses, 'q_radius') ? Number(getIntakeSingle(myIntake?.responses, 'q_radius')) : null }
          const otherLoc = { lat: otherProfFull?.lat as number | null, lng: otherProfFull?.lng as number | null, radius_km: getIntakeSingle(otherIntake?.responses, 'q_radius') ? Number(getIntakeSingle(otherIntake?.responses, 'q_radius')) : null }
          const venue = await pickVenueForMatch(supabase, myLoc, otherLoc)
          const venueLine = venue ? (venue.neighborhood ? `${venue.name} (${venue.neighborhood})` : venue.name) : null

          // Tomorrow's date as the start of the 5-day window
          const tomorrow = new Date()
          tomorrow.setDate(tomorrow.getDate() + 1)
          tomorrow.setHours(0, 0, 0, 0)
          const windowStart = tomorrow.toISOString()

          const venuePayload = venue ? { venue_id: venue.id, venue_name: venue.name, venue_neighborhood: venue.neighborhood ?? null } : {}
          const sharedPayload = { both_accepted_at: new Date().toISOString(), window_start: windowStart, ...venuePayload }

          const availMsg = (partnerName: string) => [
            `You're both down to meet each other for Fika! ☕`,
            '',
            venueLine ? `It looks like ${venueLine} is a great spot that's not too far from either of you.` : '',
            '',
            `Send over your availability for the next 5 days starting tomorrow and let's make it happen!`,
            `(e.g. "Tomorrow after 5, Thursday 3–6pm, Friday anytime after noon")`,
          ].filter(Boolean).join('\n')

          await Promise.all([
            setPerMatchSmsState({ userId, matchId: activeMatchId, state: '1v1_awaiting_availability', payload: sharedPayload }),
            otherUserId ? setPerMatchSmsState({ userId: otherUserId, matchId: activeMatchId, state: '1v1_awaiting_availability', payload: sharedPayload }) : Promise.resolve(),
            sendConciergeAndLog(fromNumber, availMsg(otherFirstName), 'match_both_accepted_avail_ask', { userId, matchId: activeMatchId }),
            otherPhone && otherUserId
              ? sendConciergeAndLog(otherPhone, availMsg(myFirstName), 'match_both_accepted_avail_ask', { userId: otherUserId, matchId: activeMatchId })
              : Promise.resolve(),
          ])
        } else {
          // Other person hasn't accepted yet — tell this user we're checking
          await sendConciergeAndLog(
            fromNumber,
            `Great — we're checking with ${otherFirstName}. We'll confirm as soon as you're both in.`,
            'match_accepted_waiting',
            { userId, matchId: activeMatchId }
          )
        }

        return NextResponse.json({ ok: true })
      }

      if (isCancellationSignal(content) || isMatchPassSignal) {
        await cancelMatch()
        return NextResponse.json({ ok: true })
      }

      await sendConciergeAndLog(
        fromNumber,
        "Reply Yes to accept the intro, or No to pass.",
        'match_offered_nudge',
        { userId, matchId: activeMatchId }
      )
      return NextResponse.json({ ok: true })
    }

    if (matchState === '1v1_accepted') {
      if (isCancellationSignal(content) || isMatchPassSignal) {
        await cancelMatch()
        return NextResponse.json({ ok: true })
      }

      // Check if other person has also accepted (mutually confirmed) or we're still waiting
      let otherAlsoAccepted = false
      let otherFirstNameForNudge = 'the other person'
      if (otherUserId) {
        const [{ data: otherStateRow }, { data: otherProfNudge }] = await Promise.all([
          supabase.from('sms_conversation_states')
            .select('state')
            .eq('user_id', otherUserId)
            .eq('match_id', activeMatchId)
            .maybeSingle(),
          supabase.from('profiles').select('first_name').eq('id', otherUserId).maybeSingle(),
        ])
        otherAlsoAccepted = (otherStateRow?.state as string | null) === '1v1_accepted'
        otherFirstNameForNudge = (otherProfNudge?.first_name as string | null)?.trim() || 'the other person'
      }

      if (!otherAlsoAccepted) {
        await sendConciergeAndLog(
          fromNumber,
          `Still waiting to hear from ${otherFirstNameForNudge} — we'll confirm as soon as you're both in.`,
          'match_accepted_pending_nudge',
          { userId, matchId: activeMatchId }
        )
        return NextResponse.json({ ok: true })
      }

      // Both accepted — nudge that we're waiting on availability
      await sendConciergeAndLog(
        fromNumber,
        `Still waiting on availability from ${otherFirstNameForNudge} — we'll set up a time as soon as we hear back.`,
        'match_accepted_nudge',
        { userId, matchId: activeMatchId }
      )
      return NextResponse.json({ ok: true })
    }

    if (matchState === '1v1_awaiting_availability') {
      // Treat any incoming message as a free-text availability reply
      const windowStart = typeof matchPayload.window_start === 'string' ? new Date(matchPayload.window_start) : new Date()
      const windows = await parseAvailability(content, windowStart)

      if (windows.length === 0) {
        await sendConciergeAndLog(
          fromNumber,
          `We had trouble reading that — could you be a bit more specific?\n(e.g. "Thursday after 4pm, Friday noon to 6pm")`,
          'avail_parse_failed',
          { userId, matchId: activeMatchId }
        )
        return NextResponse.json({ ok: true })
      }

      // Store this user's parsed availability in payload
      const updatedPayload = { ...matchPayload, availability: windows }
      await setPerMatchSmsState({ userId, matchId: activeMatchId, state: '1v1_awaiting_availability', payload: updatedPayload })

      // Check if other user has already submitted availability
      let otherAvailability: unknown[] | null = null
      let otherPhone2: string | null = null
      let otherFirstName2 = 'them'
      if (otherUserId) {
        const [{ data: otherStateRow2 }, { data: otherProf2 }] = await Promise.all([
          supabase.from('sms_conversation_states').select('payload').eq('user_id', otherUserId).eq('match_id', activeMatchId).maybeSingle(),
          supabase.from('profiles').select('first_name, phone').eq('id', otherUserId).maybeSingle(),
        ])
        const otherPayload2 = (otherStateRow2?.payload as Record<string, unknown>) ?? {}
        if (Array.isArray(otherPayload2.availability) && otherPayload2.availability.length > 0) {
          otherAvailability = otherPayload2.availability as unknown[]
        }
        otherPhone2 = (otherProf2?.phone as string | null)?.trim() ?? null
        otherFirstName2 = (otherProf2?.first_name as string | null)?.trim() || 'them'
      }

      if (!otherAvailability) {
        // Other user hasn't sent availability yet — acknowledge and wait
        await sendConciergeAndLog(
          fromNumber,
          `Got it! Waiting to hear from ${otherFirstName2} and we'll lock in a time ☕`,
          'avail_received_waiting',
          { userId, matchId: activeMatchId }
        )
        return NextResponse.json({ ok: true })
      }

      // Both availability collected — find overlap
      const overlap = findEarliestOverlap(windows, otherAvailability as Parameters<typeof findEarliestOverlap>[0])

      if (!overlap) {
        // No overlap — graceful exit
        await supabase.from('match_candidates').update({ status: 'scheduling_stalled' }).eq('id', activeMatchId)
        const exitMsg = `Looks like timing is a bit tricky right now — we'll circle back when things open up ☕`
        await Promise.all([
          sendConciergeAndLog(fromNumber, exitMsg, 'avail_no_overlap', { userId, matchId: activeMatchId }),
          otherPhone2 && otherUserId
            ? sendConciergeAndLog(otherPhone2, exitMsg, 'avail_no_overlap', { userId: otherUserId, matchId: activeMatchId })
            : Promise.resolve(),
          setGlobalSmsState({ userId, state: SMS_STATES.GLOBAL_READY, payload: {} }),
          otherUserId ? setGlobalSmsState({ userId: otherUserId, state: SMS_STATES.GLOBAL_READY, payload: {} }) : Promise.resolve(),
        ])
        // Clean up per-match rows
        for (const uid of [userId, ...(otherUserId ? [otherUserId] : [])]) {
          await supabase.from('sms_conversation_states').delete().eq('user_id', uid).eq('match_id', activeMatchId)
        }
        return NextResponse.json({ ok: true })
      }

      // Overlap found — propose time + venue
      const venueNameStored = typeof matchPayload.venue_name === 'string' ? matchPayload.venue_name : null
      const venueNeighborhoodStored = typeof matchPayload.venue_neighborhood === 'string' ? matchPayload.venue_neighborhood : null
      const venueLine2 = venueNameStored
        ? (venueNeighborhoodStored ? `${venueNameStored} (${venueNeighborhoodStored})` : venueNameStored)
        : 'the venue'
      const proposedTimeStr = formatProposedTime(overlap)
      const proposalMsg = `How does ${proposedTimeStr} at ${venueLine2} sound?\nReply Yes to confirm, or No if that doesn't work.`
      // Store both users' availability so we can try another slot if one is rejected
      const availKeyMe = userId === matchUserA ? 'availability_a' : 'availability_b'
      const availKeyOther = userId === matchUserA ? 'availability_b' : 'availability_a'
      const proposedPayload = {
        ...matchPayload,
        proposed_slot: overlap,
        proposal_attempt: 1,
        [availKeyMe]: windows,
        [availKeyOther]: otherAvailability,
      }

      await Promise.all([
        setPerMatchSmsState({ userId, matchId: activeMatchId, state: '1v1_proposed', payload: proposedPayload }),
        otherUserId ? setPerMatchSmsState({ userId: otherUserId, matchId: activeMatchId, state: '1v1_proposed', payload: proposedPayload }) : Promise.resolve(),
        sendConciergeAndLog(fromNumber, proposalMsg, 'schedule_proposed', { userId, matchId: activeMatchId }),
        otherPhone2 && otherUserId
          ? sendConciergeAndLog(otherPhone2, proposalMsg, 'schedule_proposed', { userId: otherUserId, matchId: activeMatchId })
          : Promise.resolve(),
      ])
      return NextResponse.json({ ok: true })
    }

    if (matchState === '1v1_proposed') {
      if (isCancellationSignal(content) || isMatchPassSignal) {
        await cancelMatch()
        return NextResponse.json({ ok: true })
      }

      if (isMatchYesSignal) {
        // Check if other user has also confirmed
        let otherConfirmed = false
        let otherPhone3: string | null = null
        let otherFirstName3 = 'them'
        if (otherUserId) {
          const [{ data: otherStateRow3 }, { data: otherProf3 }] = await Promise.all([
            supabase.from('sms_conversation_states').select('state').eq('user_id', otherUserId).eq('match_id', activeMatchId).maybeSingle(),
            supabase.from('profiles').select('first_name, phone').eq('id', otherUserId).maybeSingle(),
          ])
          otherConfirmed = (otherStateRow3?.state as string | null) === '1v1_confirmed'
          otherPhone3 = (otherProf3?.phone as string | null)?.trim() ?? null
          otherFirstName3 = (otherProf3?.first_name as string | null)?.trim() || 'them'
        }

        await setPerMatchSmsState({ userId, matchId: activeMatchId, state: '1v1_confirmed', payload: matchPayload })

        if (otherConfirmed) {
          // Both confirmed — send final confirmation to both
          const proposedSlot = matchPayload.proposed_slot as { date: string; startHour: number; endHour: number } | undefined
          const timeStr = proposedSlot ? formatProposedTime(proposedSlot) : 'soon'
          const venueNameC = typeof matchPayload.venue_name === 'string' ? matchPayload.venue_name : 'the venue'
          const confirmMsg = `You're all set ☕ See you ${timeStr} at ${venueNameC}.`
          await Promise.all([
            sendConciergeAndLog(fromNumber, confirmMsg, 'fika_confirmed', { userId, matchId: activeMatchId }),
            otherPhone3 && otherUserId
              ? sendConciergeAndLog(otherPhone3, confirmMsg, 'fika_confirmed', { userId: otherUserId, matchId: activeMatchId })
              : Promise.resolve(),
          ])
          // Write event_starts_at into match_candidates.reasons so morning/reveals crons can fire
          if (proposedSlot && activeMatchId) {
            const { data: mcRow } = await supabase.from('match_candidates').select('reasons').eq('id', activeMatchId).maybeSingle()
            const existingReasons = (mcRow?.reasons as Record<string, unknown>) ?? {}
            const slotUtc = windowStartToUtc(proposedSlot)
            const payloadVenueId = typeof matchPayload.venue_id === 'string' ? matchPayload.venue_id : null
            await supabase.from('match_candidates').update({
              reasons: {
                ...existingReasons,
                event_starts_at: slotUtc.toISOString(),
                photo_sent_with_intro: true,
                ...(payloadVenueId && !existingReasons.venue_id ? { venue_id: payloadVenueId } : {}),
              },
            }).eq('id', activeMatchId)
          }
        } else {
          await sendConciergeAndLog(
            fromNumber,
            `Great — waiting to hear from ${otherFirstName3} and then you're all set!`,
            'schedule_confirmed_waiting',
            { userId, matchId: activeMatchId }
          )
        }
        return NextResponse.json({ ok: true })
      }

      // No — try another slot from stored availability, excluding the rejected date
      const attempt = typeof matchPayload.proposal_attempt === 'number' ? matchPayload.proposal_attempt : 1
      const rejectedSlot = matchPayload.proposed_slot as { date: string; startHour: number; endHour: number } | undefined
      const availA = Array.isArray(matchPayload.availability_a) ? (matchPayload.availability_a as TimeWindow[]) : []
      const availB = Array.isArray(matchPayload.availability_b) ? (matchPayload.availability_b as TimeWindow[]) : []
      const excludeDates = rejectedSlot ? [rejectedSlot.date] : []
      const nextOverlap = attempt < 2 ? findEarliestOverlap(availA, availB, excludeDates) : null

      // Load both profiles for names + other user's phone
      const [{ data: myProf5 }, { data: otherProf5 }] = await Promise.all([
        supabase.from('profiles').select('first_name').eq('id', userId).maybeSingle(),
        otherUserId ? supabase.from('profiles').select('first_name, phone').eq('id', otherUserId).maybeSingle() : Promise.resolve({ data: null }),
      ])
      const myName5 = (myProf5?.first_name as string | null)?.trim() || null
      const otherName5 = (otherProf5?.first_name as string | null)?.trim() || null
      const otherPhone5 = (otherProf5?.phone as string | null)?.trim() ?? null

      if (nextOverlap) {
        // Found another slot — propose it to both
        const nextTimeStr = formatProposedTime(nextOverlap)
        const venueNameAlt = typeof matchPayload.venue_name === 'string' ? matchPayload.venue_name : 'the venue'
        const venueNeighborhoodAlt = typeof matchPayload.venue_neighborhood === 'string' ? matchPayload.venue_neighborhood : null
        const venueLine5 = venueNeighborhoodAlt ? `${venueNameAlt} (${venueNeighborhoodAlt})` : venueNameAlt
        const altProposalMsg = `No worries — how about ${nextTimeStr} at ${venueLine5} instead?`
        const nextPayload = { ...matchPayload, proposed_slot: nextOverlap, proposal_attempt: attempt + 1 }
        await Promise.all([
          setPerMatchSmsState({ userId, matchId: activeMatchId, state: '1v1_proposed', payload: nextPayload }),
          otherUserId ? setPerMatchSmsState({ userId: otherUserId, matchId: activeMatchId, state: '1v1_proposed', payload: nextPayload }) : Promise.resolve(),
          sendConciergeAndLog(fromNumber, altProposalMsg, 'schedule_alt_proposed', { userId, matchId: activeMatchId }),
          otherPhone5 && otherUserId
            ? sendConciergeAndLog(otherPhone5, altProposalMsg, 'schedule_alt_proposed', { userId: otherUserId, matchId: activeMatchId })
            : Promise.resolve(),
        ])
      } else {
        // No more slots or second rejection — graceful close with a rain-check tone
        await supabase.from('match_candidates').update({ status: 'scheduling_stalled' }).eq('id', activeMatchId)
        const stallMsgFor = (otherName: string | null) =>
          `Looks like timing isn't working out this week — we'll try to set up a Fika with ${otherName ?? 'them'} again soon ☕`
        await Promise.all([
          sendConciergeAndLog(fromNumber, stallMsgFor(otherName5), 'schedule_stalled', { userId, matchId: activeMatchId }),
          otherPhone5 && otherUserId
            ? sendConciergeAndLog(otherPhone5, stallMsgFor(myName5), 'schedule_stalled', { userId: otherUserId, matchId: activeMatchId })
            : Promise.resolve(),
          setGlobalSmsState({ userId, state: SMS_STATES.GLOBAL_READY, payload: {} }),
          otherUserId ? setGlobalSmsState({ userId: otherUserId, state: SMS_STATES.GLOBAL_READY, payload: {} }) : Promise.resolve(),
        ])
        for (const uid of [userId, ...(otherUserId ? [otherUserId] : [])]) {
          await supabase.from('sms_conversation_states').delete().eq('user_id', uid).eq('match_id', activeMatchId)
        }
      }
      return NextResponse.json({ ok: true })
    }

    // 1v1_confirmed / 1v1_morning_reminder — Fika is locked in; handle cancel or nudge with confirmed details
    if (matchState === '1v1_confirmed' || matchState === '1v1_morning_reminder') {
      if (isCancellationSignal(content) || isMatchPassSignal) {
        await cancelMatch()
        return NextResponse.json({ ok: true })
      }
      const slot = matchPayload.proposed_slot as { date: string; startHour: number } | undefined
      const venueName = typeof matchPayload.venue_name === 'string' ? matchPayload.venue_name : null
      const timeStr = slot ? formatProposedTime(slot as Parameters<typeof formatProposedTime>[0]) : null
      const detail = [timeStr, venueName].filter(Boolean).join(' at ')
      await sendConciergeAndLog(
        fromNumber,
        detail ? `You're all set ☕ See you ${detail}.` : `You're all set ☕`,
        'confirmed_nudge',
        { userId, matchId: activeMatchId }
      )
      return NextResponse.json({ ok: true })
    }
  }

  // Event invite: user replied to event invite (also handles legacy weekly_opt_in_sent rows)
  if (state === SMS_STATES.SOCIAL_INVITED || state === 'weekly_opt_in_sent') {
    const marketSlug = (payload.market_slug as string | undefined) ?? null
    const eventId = (payload.event_id as string | undefined) ?? null
    const sentAt = (payload.sent_at as string | undefined) ?? null

    // Cancellation from a user who already RSVPd yes
    if (isCancellationSignal(content) && eventId) {
      await supabase.from('weekly_rsvps')
        .update({ decision: 'cancelled', decided_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('event_id', eventId)
        .eq('decision', 'yes')
      await setGlobalSmsState({ userId, state: SMS_STATES.GLOBAL_READY, payload: {} })
      await sendConciergeAndLog(fromNumber, messageRsvpCancelled(), 'rsvp_cancelled', { userId })
      return NextResponse.json({ ok: true })
    }

    if (isMatchYesSignal) {
      // Deadline check
      if (sentAt && eventId) {
        const { data: eventRow } = await supabase
          .from('weekly_fika_events')
          .select('opt_in_deadline_hours')
          .eq('id', eventId)
          .maybeSingle()
        const deadlineHours = (eventRow?.opt_in_deadline_hours as number | null) ?? 24
        const sentMs = new Date(sentAt).getTime()
        const deadlineMs = sentMs + deadlineHours * 3600 * 1000
        if (Date.now() > deadlineMs) {
          await setGlobalSmsState({ userId, state: SMS_STATES.GLOBAL_READY, payload: {} })
          await sendConciergeAndLog(fromNumber, messageOptInWindowClosed(), 'weekly_opt_in_window_closed', { userId })
          return NextResponse.json({ ok: true })
        }
      }

      // Capacity check
      if (eventId) {
        const { data: eventCap } = await supabase
          .from('weekly_fika_events')
          .select('max_capacity')
          .eq('id', eventId)
          .maybeSingle()
        const maxCap = (eventCap?.max_capacity as number | null) ?? null
        if (maxCap !== null) {
          const { count } = await supabase
            .from('weekly_rsvps')
            .select('id', { count: 'exact', head: true })
            .eq('event_id', eventId)
            .eq('decision', 'yes')
          if ((count ?? 0) >= maxCap) {
            await setGlobalSmsState({ userId, state: SMS_STATES.GLOBAL_READY, payload: {} })
            await sendConciergeAndLog(fromNumber, messageOptInFilledUp(), 'weekly_opt_in_filled_up', { userId })
            return NextResponse.json({ ok: true })
          }
        }
      }

      if (eventId) {
        await supabase.from('weekly_rsvps').upsert(
          { user_id: userId, market_slug: marketSlug, event_id: eventId, decision: 'yes', decided_at: new Date().toISOString() },
          { onConflict: 'user_id,event_id' }
        )
      }
      await setGlobalSmsState({ userId, state: SMS_STATES.SOCIAL_RSVP_ACCEPTED, payload: { event_id: eventId, market_slug: marketSlug } })
      await sendConciergeAndLog(fromNumber, messageWeeklyOptInYes(), 'rsvp_accepted', { userId })
      return NextResponse.json({ ok: true })
    }

    if (isMatchPassSignal) {
      if (eventId) {
        await supabase.from('weekly_rsvps').upsert(
          { user_id: userId, market_slug: marketSlug, event_id: eventId, decision: 'no', decided_at: new Date().toISOString() },
          { onConflict: 'user_id,event_id' }
        )
      }
      await setGlobalSmsState({ userId, state: SMS_STATES.GLOBAL_READY, payload: {} })
      await sendConciergeAndLog(fromNumber, messageWeeklyOptInNo(), 'weekly_opt_in_no', { userId })
      return NextResponse.json({ ok: true })
    }

    await sendConciergeAndLog(fromNumber, 'Reply Yes to join this Fika, or No to skip.', 'weekly_opt_in_nudge', { userId })
    return NextResponse.json({ ok: true })
  }

  // RSVP accepted: user is confirmed for an event, waiting for it to happen
  if (state === SMS_STATES.SOCIAL_RSVP_ACCEPTED) {
    const rsvpEventId = (payload.event_id as string | undefined) ?? null
    if (isCancellationSignal(content) && rsvpEventId) {
      await supabase
        .from('weekly_rsvps')
        .update({ decision: 'cancelled', decided_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('event_id', rsvpEventId)
        .eq('decision', 'yes')
      await setGlobalSmsState({ userId, state: SMS_STATES.GLOBAL_READY, payload: {} })
      await sendConciergeAndLog(fromNumber, messageRsvpCancelled(), 'rsvp_accepted_cancelled', { userId })
      return NextResponse.json({ ok: true })
    }
    // If day-before confirm SMS was sent and user replies Yes, stamp their confirmation
    if (isMatchYesSignal && rsvpEventId) {
      const { data: eventForConfirm } = await supabase
        .from('weekly_fika_events')
        .select('day_before_sms_sent_at')
        .eq('id', rsvpEventId)
        .maybeSingle()
      if (eventForConfirm?.day_before_sms_sent_at) {
        await supabase
          .from('weekly_rsvps')
          .update({ day_before_confirmed_at: new Date().toISOString() })
          .eq('user_id', userId)
          .eq('event_id', rsvpEventId)
          .eq('decision', 'yes')
        await sendConciergeAndLog(fromNumber, "Confirmed ✓ See you there ☕", 'rsvp_day_before_confirmed', { userId })
        return NextResponse.json({ ok: true })
      }
    }
    await sendConciergeAndLog(fromNumber, "You're in! Text 'cancel' if your plans change.", 'rsvp_accepted_nudge', { userId })
    return NextResponse.json({ ok: true })
  }

  // Morning reminder sent — holding state until reveal fires 30 min before the event
  if (state === SMS_STATES.SOCIAL_MORNING_REMINDER) {
    const morningEventId = (payload.event_id as string | undefined) ?? null
    if (isCancellationSignal(content) && morningEventId) {
      await supabase
        .from('weekly_rsvps')
        .update({ decision: 'cancelled', decided_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('event_id', morningEventId)
        .eq('decision', 'yes')
      await setGlobalSmsState({ userId, state: SMS_STATES.GLOBAL_READY, payload: {} })
      await sendConciergeAndLog(fromNumber, messageRsvpCancelled(), 'morning_reminder_cancelled', { userId })
      return NextResponse.json({ ok: true })
    }
    await sendConciergeAndLog(fromNumber, "You're all set — see you there ☕", 'morning_reminder_nudge', { userId })
    return NextResponse.json({ ok: true })
  }

  if (isHelpKeyword(content)) {
    await sendConciergeAndLog(fromNumber, messageSmsHelp(), 'help', { userId, matchId: matchId ?? undefined })
    return NextResponse.json({ ok: true })
  }

  const appBase = getAppBase()

  if (!matchId && state === SMS_STATES.GLOBAL_READY && isCancellationSignal(content)) {
    const nowIso = new Date().toISOString()
    const { data: upcomingRsvp } = await supabase
      .from('weekly_rsvps')
      .select('id, event_id, weekly_fika_events!inner(event_starts_at)')
      .eq('user_id', userId)
      .eq('decision', 'yes')
      .gt('weekly_fika_events.event_starts_at', nowIso)
      .order('weekly_fika_events.event_starts_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (upcomingRsvp) {
      await supabase.from('weekly_rsvps')
        .update({ decision: 'cancelled', decided_at: nowIso })
        .eq('id', upcomingRsvp.id)
      await sendConciergeAndLog(fromNumber, messageRsvpCancelled(), 'rsvp_cancelled_global_ready', { userId })
      return NextResponse.json({ ok: true })
    }
  }

  if (!matchId && state === SMS_STATES.GLOBAL_READY) {
    const { data: profileForGlobal } = await supabase
      .from('profiles')
      .select('id, first_name, birthdate, city, avatar_url, intent_confirmed_at, lat, lng, market')
      .eq('id', userId)
      .maybeSingle()
    const { data: intakeForGlobal } = await supabase
      .from('intake_responses_v5')
      .select('user_id, completed_at')
      .eq('user_id', userId)
      .maybeSingle()
    if (!isOnboardingComplete((profileForGlobal ?? null) as ProfileRow | null, (intakeForGlobal ?? null) as IntakeResponsesV5Row | null)) {
      const DEFAULT_APP_BASE = 'https://letsfika.vercel.app'
      const appBaseOb = (process.env.APP_CANONICAL_URL ?? '').trim()
        ? process.env.APP_CANONICAL_URL!.trim().replace(/\/$/, '')
        : DEFAULT_APP_BASE
      const onboardingUrl = `${appBaseOb}/app/onboarding`
      await sendConciergeAndLog(fromNumber, messageOnboardingRequired(onboardingUrl), 'onboarding_required', { userId })
      await sleepForSmsPacing(SMS_PACING_MS.quickAck)
      await sendConciergeAndLog(fromNumber, onboardingUrl, 'onboarding_required_url', { userId })
      return NextResponse.json({ ok: true })
    }
    const activeSlugsGr = await getActiveMarketSlugs(supabase)
    const profileMarketGr = (profileForGlobal as { market?: string | null })?.market ?? null
    if (profileMarketGr != null && activeSlugsGr.length > 0 && !activeSlugsGr.includes(profileMarketGr)) {
      const placeLabel = getMarketBySlug(profileMarketGr)?.label ?? (profileForGlobal as { city?: string | null })?.city ?? profileMarketGr
      await sendConciergeAndLog(fromNumber, messageInactiveMarketReply(placeLabel), 'inactive_market_reply_global', { userId })
      return NextResponse.json({ ok: true })
    }

    const aiCountGr = await countGlobalReadyAiRepliesLast24h(supabase, userId)
    if (aiCountGr >= getSmsAiMaxGlobalReadyPer24h()) {
      const rateResult = await sendConciergeAndLog(fromNumber, messageEntryReminder(), 'global_ready_match_first', { userId })
      await setGlobalSmsState({
        userId,
        state,
        payload,
        lastSendblueMessageHandle: rateResult.message_handle ?? messageHandle ?? null,
      })
      return NextResponse.json({ ok: true })
    }

    const apiKeyGr = getOpenAiKeyForSms()
    if (!apiKeyGr) {
      const noKeyResult = await sendConciergeAndLog(fromNumber, messageEntryReminder(), 'global_ready_match_first', { userId })
      await setGlobalSmsState({
        userId,
        state,
        payload,
        lastSendblueMessageHandle: noKeyResult.message_handle ?? messageHandle ?? null,
      })
      return NextResponse.json({ ok: true })
    }

    await prepareOutboundAiPresence(fromNumber)

    const appUrlGr = getAppBase()
    const firstNameGr = (profileForGlobal as { first_name?: string | null })?.first_name?.trim() ?? ''
    const marketLabelGr = profileMarketGr ? getMarketBySlug(profileMarketGr)?.label ?? profileMarketGr : undefined
    const aiReplyGr = await fetchGlobalReadyConciergeReply({
      apiKey: apiKeyGr,
      userMessage: content,
      firstName: firstNameGr || undefined,
      marketLabel: marketLabelGr,
      appBaseUrl: appUrlGr,
    })
    if (!aiReplyGr.ok) {
      console.error('[sendblue-webhook] global ready concierge AI failed', aiReplyGr.error)
      const errResult = await sendConciergeAndLog(fromNumber, messageEntryReminder(), 'global_ready_match_first', { userId })
      await setGlobalSmsState({
        userId,
        state,
        payload,
        lastSendblueMessageHandle: errResult.message_handle ?? messageHandle ?? null,
      })
      return NextResponse.json({ ok: true })
    }
    const sendResultGr = await sendConciergeAndLog(fromNumber, aiReplyGr.text, GLOBAL_READY_CONCIERGE_AI_CONTEXT, {
      userId,
    })
    await setGlobalSmsState({
      userId,
      state,
      payload,
      lastSendblueMessageHandle: sendResultGr.message_handle ?? messageHandle ?? null,
    })
    return NextResponse.json({ ok: true })
  }


  // social_reveal_sent: reveal SMS was sent ~30 min before the meeting. If the event hasn't passed,
  // give a short holding reply. If it has passed, reset to global_ready.
  if (!matchId && state === SMS_STATES.SOCIAL_REVEAL_SENT) {
    const revealEventId = (payload.event_id as string | undefined) ?? null
    let eventPassed = true
    if (revealEventId) {
      const { data: revealEvent } = await supabase
        .from('weekly_fika_events')
        .select('event_starts_at')
        .eq('id', revealEventId)
        .maybeSingle()
      if (revealEvent?.event_starts_at && new Date(revealEvent.event_starts_at as string).getTime() > Date.now()) {
        eventPassed = false
      }
    }

    if (!eventPassed) {
      await sendConciergeAndLog(fromNumber, "You're all set — see you there ☕", 'reveal_sent_pre_event_nudge', { userId })
      return NextResponse.json({ ok: true })
    }

    // Event has passed — reset to global_ready and handle like a normal global_ready message
    await setGlobalSmsState({ userId, state: SMS_STATES.GLOBAL_READY, payload: {} })
    const { data: profileForConfirmed } = await supabase
      .from('profiles')
      .select('first_name, market')
      .eq('id', userId)
      .maybeSingle()
    const apiKeyConfirmed = getOpenAiKeyForSms()
    if (apiKeyConfirmed) {
      const aiCount = await countGlobalReadyAiRepliesLast24h(supabase, userId)
      if (aiCount < getSmsAiMaxGlobalReadyPer24h()) {
        await prepareOutboundAiPresence(fromNumber)
        const firstNameC = (profileForConfirmed as { first_name?: string | null } | null)?.first_name?.trim() ?? ''
        const marketSlugC = (profileForConfirmed as { market?: string | null } | null)?.market ?? null
        const marketLabelC = marketSlugC ? getMarketBySlug(marketSlugC)?.label ?? marketSlugC : undefined
        const aiReply = await fetchGlobalReadyConciergeReply({
          apiKey: apiKeyConfirmed,
          userMessage: content,
          firstName: firstNameC || undefined,
          marketLabel: marketLabelC,
          appBaseUrl: getAppBase(),
        })
        if (aiReply.ok) {
          const sr = await sendConciergeAndLog(fromNumber, aiReply.text, GLOBAL_READY_CONCIERGE_AI_CONTEXT, { userId })
          await setGlobalSmsState({ userId, state: SMS_STATES.GLOBAL_READY, payload: {}, lastSendblueMessageHandle: sr.message_handle ?? messageHandle ?? null })
          return NextResponse.json({ ok: true })
        }
      }
    }
    await sendConciergeAndLog(fromNumber, messageEntryReminder(), 'reveal_sent_post_event_fallback', { userId })
    return NextResponse.json({ ok: true })
  }

  return smsFail('unhandled_inbound_sms', {
    userId,
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
