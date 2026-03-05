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
  messageOptInConfirmation,
  messageSkipped,
  messageEntry,
  messageMatchOffer,
  messageConversationContext,
  messageSchedulingDay,
  messageSchedulingWindow,
  messageVenueProposed,
  messageYoureAllSet,
  messagePassConfirmation,
  pickVenueForMatch,
} from '@/lib/sms-agent'
import { sendConcierge, sendMatch, isSendblueConfigured } from '@/lib/sendblue'
import { getCurrentBatchWeek } from '@/lib/onboarding'
import {
  messageSmsSignupLinkSent,
  messageSmsSignupLinkAlreadySent,
} from '@/lib/sms-signup'

const CONCIERGE = (process.env.SENDBLUE_CONCIERGE_NUMBER || '').replace(/\D/g, '')
const MATCH = (process.env.SENDBLUE_MATCH_NUMBER || '').replace(/\D/g, '')

function isConciergeNumber(toNumber: string): boolean {
  const digits = toNumber.replace(/\D/g, '')
  return Boolean(CONCIERGE && (digits === CONCIERGE || digits.endsWith(CONCIERGE)))
}

function isMatchNumber(toNumber: string): boolean {
  const digits = toNumber.replace(/\D/g, '')
  return Boolean(MATCH && (digits === MATCH || digits.endsWith(MATCH)))
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

  const isConcierge = isConciergeNumber(toNumber)
  const isMatch = isMatchNumber(toNumber)
  console.log('[sendblue-webhook] route', { isConcierge, isMatch, toNumber: toNumber ? 'set' : 'empty' })

  // ----- Relay (Fika Match number) -----
  if (isMatchNumber(toNumber)) {
    const userId = await getUserIdByPhone(supabase, fromPhone)
    if (!userId) {
      await sendMatch(fromNumber, "We don't have your number on file. Text the Fika Concierge number to get set up.")
      return NextResponse.json({ ok: true })
    }
    const { data: match } = await supabase
      .from('match_candidates')
      .select('id, user_a, user_b, confirmed_venue_id')
      .or(`user_a.eq.${userId},user_b.eq.${userId}`)
      .eq('scheduling_status', 'confirmed')
      .not('confirmed_venue_id', 'is', null)
      .order('confirmed_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!match) {
      await sendMatch(fromNumber, "You don't have an active Fika to coordinate right now.")
      return NextResponse.json({ ok: true })
    }
    const otherUserId = match.user_a === userId ? match.user_b : match.user_a
    const { data: otherProfile } = await supabase
      .from('profiles')
      .select('first_name, phone')
      .eq('id', otherUserId)
      .maybeSingle()
    if (!otherProfile?.phone) {
      await sendMatch(fromNumber, "We can't reach your Fika partner right now.")
      return NextResponse.json({ ok: true })
    }
    const firstName = otherProfile.first_name?.trim() || 'Your match'
    await sendMatch(otherProfile.phone, `${firstName}: ${content}`)
    return NextResponse.json({ ok: true })
  }

  // ----- Concierge flow -----
  if (!isConciergeNumber(toNumber)) {
    return NextResponse.json({ ok: true })
  }

  const userId = await getUserIdByPhone(supabase, fromPhone)
  console.log('[sendblue-webhook] user lookup', { fromLast4, userId: userId ? 'found' : 'not_found' })
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
      await sendConcierge(fromNumber, messageSmsSignupLinkAlreadySent())
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
      await sendConcierge(fromNumber, "Something went wrong. Try again or sign up at letsfika.co")
      return NextResponse.json({ ok: true })
    }
    const link = `${appBase}/signup?token=${token}`
    await sendConcierge(fromNumber, messageSmsSignupLinkSent(link))
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

  // First contact (reply-only flow): no state yet — send entry message and set awaiting_opt_in
  if (!stateRow) {
    console.log('[sendblue-webhook] first_contact sending entry to', fromLast4)
    const entryResult = await sendConcierge(fromNumber, messageEntry())
    console.log('[sendblue-webhook] sendConcierge result', { ok: entryResult.ok, error: entryResult.error })
    await supabase.from('sms_conversation_states').upsert(
      {
        user_id: userId,
        batch_week: batchWeek,
        match_id: null,
        state: SMS_STATES.AWAITING_OPT_IN,
        payload: {},
        last_sendblue_message_handle: messageHandle || undefined,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,batch_week,match_id' }
    )
    return NextResponse.json({ ok: true })
  }

  const state = stateRow.state
  const keyword = content.toUpperCase().replace(/\s+/g, ' ').trim()
  const payload = (stateRow?.payload as Record<string, unknown>) ?? {}

  // Idempotency: skip if we already processed this message
  if (messageHandle && stateRow?.last_sendblue_message_handle === messageHandle) {
    return NextResponse.json({ ok: true })
  }

  // ----- Awaiting opt-in: IN / SKIP (and FIKA / HI to re-send the prompt) -----
  if (state === SMS_STATES.AWAITING_OPT_IN) {
    if (keyword === 'IN' || keyword === 'YES') {
      await supabase.from('weekly_match_opt_ins').upsert(
        { user_id: userId, batch_week: batchWeek, opted_in_at: new Date().toISOString() },
        { onConflict: 'user_id,batch_week' }
      )
      await supabase.from('sms_conversation_states').upsert(
        {
          user_id: userId,
          batch_week: batchWeek,
          match_id: null,
          state: SMS_STATES.OPTED_IN,
          payload: {},
          last_sendblue_message_handle: messageHandle,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,batch_week,match_id' }
      )
      await sendConcierge(fromNumber, messageOptInConfirmation())
    } else if (keyword === 'SKIP') {
      await supabase.from('sms_conversation_states').upsert(
        {
          user_id: userId,
          batch_week: batchWeek,
          match_id: null,
          state: SMS_STATES.AWAITING_OPT_IN,
          payload: { skipped: true },
          last_sendblue_message_handle: messageHandle,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,batch_week,match_id' }
      )
      await sendConcierge(fromNumber, messageSkipped())
    } else if (keyword === 'FIKA' || keyword === 'HI') {
      // Re-send entry prompt when they text the trigger words (first time or again)
      await sendConcierge(fromNumber, messageEntry())
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

  if (matchState === SMS_STATES.MATCH_OFFERED && matchId) {
    if (keyword === 'YES') {
      const { data: match } = await supabase
        .from('match_candidates')
        .select('id, user_a, user_b, reasons, overlapping_slot_ids')
        .eq('id', matchId)
        .single()
      if (!match) {
        await sendConcierge(fromNumber, "That match is no longer available. We'll send you another soon.")
        return NextResponse.json({ ok: true })
      }
      const reasons = (match.reasons as Record<string, unknown>) ?? {}
      const sharedInterests = (reasons.shared_interests as string[]) ?? (reasons.sharedInterests as string[]) ?? []
      const hooks = (reasons.conversation_hooks as string[]) ?? (reasons.conversationHooks as string[]) ?? []
      const starterQuestion = hooks[0] ?? "What's on your mind lately?"
      await sendConcierge(fromNumber, messageConversationContext({
        sharedInterests: sharedInterests.slice(0, 3),
        starterQuestion,
      }))
      const days = getDaysFromSlotIds((match.overlapping_slot_ids as string[]) ?? [])
      await sendConcierge(fromNumber, messageSchedulingDay(days.length ? days : ['WED', 'THU', 'FRI', 'SAT', 'SUN']))
      await supabase.from('sms_conversation_states').upsert(
        {
          user_id: userId,
          batch_week: batchWeek,
          match_id: matchId,
          state: SMS_STATES.ACCEPTED_SCHEDULING_DAY,
          payload: { ...matchPayload },
          last_sendblue_message_handle: messageHandle,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,batch_week,match_id' }
      )
      await supabase.from('opt_ins').upsert(
        { match_id: matchId, user_id: userId, decision: 'yes' },
        { onConflict: 'match_id,user_id' }
      )
    } else if (keyword === 'PASS') {
      await supabase.from('opt_ins').upsert(
        { match_id: matchId, user_id: userId, decision: 'no' },
        { onConflict: 'match_id,user_id' }
      )
      await sendConcierge(fromNumber, messagePassConfirmation())
      await supabase.from('sms_conversation_states').delete().eq('id', matchStateRow!.id)
    }
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
      await sendConcierge(fromNumber, messageSchedulingWindow())
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
        await sendConcierge(fromNumber, messageVenueProposed(selectedDay, timeStr, venue.name, venue.neighborhood ?? venue.city))
      }
    }
    return NextResponse.json({ ok: true })
  }

  if (matchState === SMS_STATES.VENUE_PROPOSED && matchId) {
    if (keyword === 'CONFIRM') {
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
        await sendConcierge(fromNumber, messageYoureAllSet(dayLabel, timeStr, venueName, neighborhood))
        const otherUserId = match.user_a === userId ? match.user_b : match.user_a
        const { data: otherProfile } = await supabase.from('profiles').select('phone').eq('id', otherUserId).maybeSingle()
        if (otherProfile?.phone) {
          await sendConcierge(otherProfile.phone, messageYoureAllSet(dayLabel, timeStr, venueName, neighborhood))
        }
      }
    }
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ ok: true })
}
