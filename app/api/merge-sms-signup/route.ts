/**
 * POST /api/merge-sms-signup — after "Sign in with Google to finalize", merge onboarding_sessions into the authenticated user.
 * Body: { token }. Requires auth. Sets profile.phone and profile + intake from session payload.
 * Sends entry SMS when merge includes phone so user gets "Reply YES or SKIP" after first-time signup.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendMessage } from '@/lib/sendblue'
import { geocodeZip } from '@/lib/geocode'
import { insertMessageLedger } from '@/lib/message-ledger'
import { getOrCreateSmsState, messageEntryFirstTimeMessages, messageEntryFirstTimeMessagesInactiveMarket, SMS_STATES } from '@/lib/sms-agent'
import { getTimezoneFromLatLng, getNextMondayPhrase } from '@/lib/sms-day-aware'
import { isPastOptInDeadline } from '@/lib/onboarding'
import { getMarketFromCityOrLatLngWithDb } from '@/lib/markets'
import { getActiveMarketSlugs } from '@/lib/admin-markets'
import { getMarketBySlug } from '@/lib/markets'
import { computeAndStoreIntakeEmbedding } from '@/lib/intake-embed-server'
import { SMS_PACING_MS, sleepForSmsPacing } from '@/lib/sms-pacing'

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
  })
  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

export async function POST(request: Request) {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Missing or invalid Authorization' }, { status: 401 })
  }
  const token = authHeader.slice(7)
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !anonKey || !serviceKey) {
    return NextResponse.json({ error: 'Not configured' }, { status: 500 })
  }
  const supabaseUser = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data: { user }, error: userError } = await supabaseUser.auth.getUser(token)
  if (userError || !user?.id) {
    return NextResponse.json({ error: 'Invalid token or user not found' }, { status: 401 })
  }
  const body = await request.json().catch(() => ({}))
  const sessionToken = typeof body.token === 'string' ? body.token : null
  if (!sessionToken) return NextResponse.json({ error: 'Missing token' }, { status: 400 })

  const supabase = createClient(url, serviceKey)
  const { data: session, error: sessionError } = await supabase
    .from('onboarding_sessions')
    .select('id, phone, payload')
    .eq('token', sessionToken)
    .is('merged_into_user_id', null)
    .maybeSingle()
  if (sessionError) return NextResponse.json({ error: sessionError.message }, { status: 500 })
  if (!session) return NextResponse.json({ error: 'Invalid or already used link' }, { status: 404 })

  const payload = (session.payload as Record<string, unknown>) ?? {}
  const first_name = (payload.first_name as string)?.trim() || ' '
  const birthdate = payload.birthdate as string | null
  let pronouns = typeof payload.pronouns === 'string' ? payload.pronouns.trim() || null : null
  const legacyGender = typeof payload.gender === 'string' ? payload.gender.trim() : ''
  if (!pronouns && legacyGender) {
    const g = legacyGender.toLowerCase()
    if (g === 'female' || g === 'woman' || g === 'women') pronouns = 'She/her'
    else if (g === 'male' || g === 'man' || g === 'men') pronouns = 'He/him'
    else pronouns = 'They/them'
  }
  const gender_preference = payload.gender_preference as string | null
  const age_preference = payload.age_preference as string | null
  const languages = Array.isArray(payload.languages) ? payload.languages : null
  let city = (payload.city as string) ?? null
  let lat = typeof payload.lat === 'number' ? payload.lat : null
  let lng = typeof payload.lng === 'number' ? payload.lng : null
  // If geocode failed during onboarding (e.g. rate-limited), retry now at merge time
  if ((lat == null || lng == null) && typeof payload.zip === 'string' && payload.zip) {
    const geo = await geocodeZip(payload.zip as string).catch(() => null)
    if (geo) { city = city ?? geo.city; lat = geo.lat; lng = geo.lng }
  }
  const market = (await getMarketFromCityOrLatLngWithDb(supabase, city, lat, lng))?.slug ?? null
  const responses = Array.isArray(payload.responses) ? payload.responses : []
  const avatarPath = typeof payload.avatar_path === 'string' ? payload.avatar_path : null

  // SMS onboarding fields → intake_responses_v5 entries
  const SMS_INTAKE_FIELDS: Array<{ key: string; question_id: string; question_text: string }> = [
    { key: 'q_market_tenure', question_id: 'q_market_tenure', question_text: 'How long have you lived there?' },
    { key: 'q_work', question_id: 'q_work', question_text: 'What do you do for work?' },
    { key: 'q_interests_freetext', question_id: 'q_interests_freetext', question_text: 'What do you like to do?' },
    { key: 'q_social_style', question_id: 'q_social_style', question_text: "In social situations you're usually..." },
    { key: 'q_fika_vibe', question_id: 'q_fika_vibe', question_text: 'When you picture a great Fika, what matters most?' },
    { key: 'q_social_goal', question_id: 'q_social_goal', question_text: 'What are you hoping to get out of Fika?' },
    { key: 'q_anything_else', question_id: 'q_anything_else', question_text: 'Anything else?' },
  ]
  const smsResponses: Array<{ question_id: string; question_text: string; answer: unknown; type: string; answered_at: string }> = []
  for (const field of SMS_INTAKE_FIELDS) {
    const val = payload[field.key as keyof typeof payload]
    if (val !== undefined && val !== null) {
      smsResponses.push({
        question_id: field.question_id,
        question_text: field.question_text,
        answer: val,
        type: 'text',
        answered_at: new Date().toISOString(),
      })
    }
  }

  let avatarUrl: string | null = null
  if (avatarPath) {
    const ext = avatarPath.includes('.') ? avatarPath.split('.').pop() ?? 'jpg' : 'jpg'
    const destPath = `${user.id}/avatar.${ext}`
    const { error: copyErr } = await supabase.storage.from('avatars').copy(avatarPath, destPath)
    if (!copyErr) {
      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(destPath)
      avatarUrl = urlData.publicUrl
    }
  }

  await supabase.from('profiles').upsert(
    {
      id: user.id,
      first_name,
      birthdate: birthdate || null,
      gender: null,
      pronouns,
      gender_preference: gender_preference || null,
      age_preference: age_preference || null,
      languages,
      city: city || null,
      lat,
      lng,
      market: market ?? null,
      phone: session.phone || null,
      avatar_url: avatarUrl ?? null,
      intent_confirmed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' }
  )

  const allResponses = [...responses, ...smsResponses]
  if (allResponses.length > 0) {
    const { data: existing } = await supabase
      .from('intake_responses_v5')
      .select('responses')
      .eq('user_id', user.id)
      .maybeSingle()
    const merged = Array.isArray(existing?.responses) ? [...(existing.responses as object[])] : []
    for (const r of allResponses as Array<{ question_id: string; answer: unknown; question_text?: string; type?: string; answered_at?: string }>) {
      const idx = merged.findIndex((m: { question_id?: string }) => m?.question_id === r.question_id)
      const item = {
        question_id: r.question_id,
        question_text: r.question_text ?? '',
        answer: r.answer,
        type: r.type ?? 'text',
        answered_at: r.answered_at ?? new Date().toISOString(),
      }
      if (idx >= 0) merged[idx] = item
      else merged.push(item)
    }
    const completedAt = new Date().toISOString()
    await supabase.from('intake_responses_v5').upsert(
      {
        user_id: user.id,
        responses: merged,
        completed_at: completedAt,
        updated_at: completedAt,
      },
      { onConflict: 'user_id' }
    )
    const openaiKey = process.env.EXPO_PUBLIC_OPENAI_API_KEY || process.env.OPENAI_API_KEY
    try {
      const embedResult = await withTimeout(
        computeAndStoreIntakeEmbedding(supabase, user.id, openaiKey || undefined),
        8000,
        'computeAndStoreIntakeEmbedding'
      )
      if (!embedResult.ok) {
        console.error('merge-sms-signup: intake finalize failed', embedResult.error)
      }
    } catch (e) {
      console.error('merge-sms-signup: intake finalize timeout/error', e)
    }
  }

  await supabase
    .from('onboarding_sessions')
    .update({
      merged_into_user_id: user.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', session.id)

  // After first-time merge: two concierge SMS (You're in + invite link, then profile edit URL). Creates global SMS state for the batch week.
  if (session.phone && process.env.SENDBLUE_API_KEY_ID) {
    try {
      await getOrCreateSmsState(supabase, user.id, SMS_STATES.GLOBAL_READY, {})
      const appBase = (process.env.APP_CANONICAL_URL ?? '').trim().replace(/\/$/, '') || 'https://letsfika.vercel.app'
      const activeSlugs = await getActiveMarketSlugs(supabase)
      const isActiveMarket = market != null && activeSlugs.includes(market)
      const messages = isActiveMarket
        ? (() => {
            const isAfterDeadline = isPastOptInDeadline()
            const timezone = getTimezoneFromLatLng(lat, lng)
            const nextMondayPhrase = getNextMondayPhrase(timezone)
            return messageEntryFirstTimeMessages(isAfterDeadline, nextMondayPhrase, appBase)
          })()
        : messageEntryFirstTimeMessagesInactiveMarket(appBase, getMarketBySlug(market)?.label ?? market)
      let lastHandle: string | undefined
      for (let i = 0; i < messages.length; i++) {
        const sent = await withTimeout(
          sendMessage(session.phone, messages[i].content, { fromNumber: 'concierge' }),
          6000,
          'sendMessage(first_time_entry_merge)'
        ).catch((e) => {
          console.error('merge-sms-signup: sendMessage timeout/error', e)
          return null
        })
        if (sent?.message_handle) lastHandle = sent.message_handle
        await insertMessageLedger(supabase, {
          user_id: user.id,
          direction: 'outbound',
          peer_phone: session.phone,
          content_snippet: messages[i].content,
          context: 'first_time_entry_merge',
          message_handle: sent?.message_handle ?? null,
        })
        if (i < messages.length - 1) {
          await sleepForSmsPacing(messages[i].delayAfterMs ?? SMS_PACING_MS.quickAck)
        }
      }
      if (lastHandle) {
        await supabase.from('sms_conversation_states').update({
          last_sendblue_message_handle: lastHandle,
          updated_at: new Date().toISOString(),
        }).eq('user_id', user.id).is('match_id', null)
      }
    } catch {
      // Non-fatal
    }
  }

  return NextResponse.json({ ok: true })
}
