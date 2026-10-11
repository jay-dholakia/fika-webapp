/**
 * Core merge: fold an onboarding_sessions row into a fully-formed profile.
 * Called by /api/merge-sms-signup (Google OAuth path) and /api/verify-finish-otp (phone OTP path).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { sendMessage } from '@/lib/sendblue'
import { geocodeZip } from '@/lib/geocode'
import { insertMessageLedger } from '@/lib/message-ledger'
import { getOrCreateSmsState, SMS_STATES } from '@/lib/sms-agent'
import { getMarketFromCityOrLatLngWithDb } from '@/lib/markets'
import { computeAndStoreIntakeEmbedding } from '@/lib/intake-embed-server'
import { SMS_PACING_MS, sleepForSmsPacing } from '@/lib/sms-pacing'

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let id: ReturnType<typeof setTimeout> | null = null
  const t = new Promise<never>((_, rej) => { id = setTimeout(() => rej(new Error(`${label} timed out`)), ms) })
  return Promise.race([p, t]).finally(() => { if (id) clearTimeout(id) })
}

const SMS_INTAKE_FIELDS: Array<{ key: string; question_id: string; question_text: string }> = []

export async function mergeOnboardingSession(
  supabase: SupabaseClient,
  userId: string,
  sessionToken: string,
  openaiKey?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: session, error: sessionError } = await supabase
    .from('onboarding_sessions')
    .select('id, phone, payload')
    .eq('token', sessionToken)
    .is('merged_into_user_id', null)
    .maybeSingle()
  if (sessionError) return { ok: false, error: sessionError.message }
  if (!session) return { ok: false, error: 'Invalid or already used link' }

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
  const rawLanguages = Array.isArray(payload.languages) ? (payload.languages as string[]) : []
  const languages = Array.from(new Set(['English', ...rawLanguages]))
  let city = (payload.city as string) ?? null
  let lat = typeof payload.lat === 'number' ? payload.lat : null
  let lng = typeof payload.lng === 'number' ? payload.lng : null
  if ((lat == null || lng == null) && typeof payload.zip === 'string' && payload.zip) {
    const geo = await geocodeZip(payload.zip as string).catch(() => null)
    if (geo) { city = city ?? geo.city; lat = geo.lat; lng = geo.lng }
  }
  const market = (await getMarketFromCityOrLatLngWithDb(supabase, city, lat, lng))?.slug ?? null
  const responses = Array.isArray(payload.responses) ? payload.responses : []
  const avatarPath = typeof payload.avatar_path === 'string' ? payload.avatar_path : null
  const confirmIntentAt = typeof payload.confirm_intent_at === 'string' ? payload.confirm_intent_at : null

  const smsResponses: Array<{ question_id: string; question_text: string; answer: unknown; type: string; answered_at: string }> = []
  for (const field of SMS_INTAKE_FIELDS) {
    const val = payload[field.key]
    if (val !== undefined && val !== null) {
      smsResponses.push({ question_id: field.question_id, question_text: field.question_text, answer: val, type: 'text', answered_at: new Date().toISOString() })
    }
  }

  let avatarUrl: string | null = null
  if (avatarPath) {
    const ext = avatarPath.includes('.') ? avatarPath.split('.').pop() ?? 'jpg' : 'jpg'
    const destPath = `${userId}/avatar.${ext}`
    const { error: copyErr } = await supabase.storage.from('avatars').copy(avatarPath, destPath)
    if (!copyErr) {
      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(destPath)
      avatarUrl = urlData.publicUrl
    }
  }

  const derivedGender = pronouns === 'He/him' ? 'Male' : pronouns === 'She/her' ? 'Female' : legacyGender || null

  await supabase.from('profiles').upsert(
    { id: userId, first_name, birthdate: birthdate || null, gender: derivedGender, pronouns, gender_preference: gender_preference || null, age_preference: age_preference || null, languages, city: city || null, lat, lng, market: market ?? null, phone: session.phone || null, avatar_url: avatarUrl ?? null, intent_confirmed_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    { onConflict: 'id' }
  )

  if (confirmIntentAt) {
    smsResponses.push({ question_id: 'confirm_intent', question_text: 'Safety & community commitments', answer: "I'm in", type: 'text', answered_at: confirmIntentAt })
  }

  const allResponses = [...responses, ...smsResponses]
  if (allResponses.length > 0) {
    const { data: existing } = await supabase.from('intake_responses_v5').select('responses').eq('user_id', userId).maybeSingle()
    const merged = Array.isArray(existing?.responses) ? [...(existing.responses as object[])] : []
    for (const r of allResponses as Array<{ question_id: string; answer: unknown; question_text?: string; type?: string; answered_at?: string }>) {
      const idx = merged.findIndex((m: { question_id?: string }) => m?.question_id === r.question_id)
      const item = { question_id: r.question_id, question_text: r.question_text ?? '', answer: r.answer, type: r.type ?? 'text', answered_at: r.answered_at ?? new Date().toISOString() }
      if (idx >= 0) merged[idx] = item
      else merged.push(item)
    }
    const completedAt = new Date().toISOString()
    await supabase.from('intake_responses_v5').upsert({ user_id: userId, responses: merged, completed_at: completedAt, updated_at: completedAt }, { onConflict: 'user_id' })
    try {
      const result = await withTimeout(computeAndStoreIntakeEmbedding(supabase, userId, openaiKey), 8000, 'embed')
      if (!result.ok) console.error('mergeOnboardingSession: embed failed', result.error)
    } catch (e) { console.error('mergeOnboardingSession: embed error', e) }
  }

  await supabase.from('onboarding_sessions').update({ merged_into_user_id: userId, updated_at: new Date().toISOString() }).eq('id', session.id)

  if (session.phone && process.env.SENDBLUE_API_KEY_ID) {
    try {
      await getOrCreateSmsState(supabase, userId, SMS_STATES.PENDING_CALL, {})
      const bookingLink = process.env.BOOKING_LINK_JAY ?? 'https://calendar.app.google/ust81a3V9er5F7h37'
      const nameGreeting = first_name ? ` ${first_name}` : ''
      const msg1 = `You're signed up${nameGreeting}! One last step — schedule a call with me so we can get your intros going 👇`
      const s1 = await withTimeout(sendMessage(session.phone, msg1, { fromNumber: 'concierge' }), 6000, 'sendMsg1').catch(() => null)
      await insertMessageLedger(supabase, { user_id: userId, direction: 'outbound', peer_phone: session.phone, content_snippet: msg1, context: 'pending_call_cta', message_handle: s1?.message_handle ?? null })
      await sleepForSmsPacing(SMS_PACING_MS.beat)
      const s2 = await withTimeout(sendMessage(session.phone, bookingLink, { fromNumber: 'concierge' }), 6000, 'sendMsg2').catch(() => null)
      await insertMessageLedger(supabase, { user_id: userId, direction: 'outbound', peer_phone: session.phone, content_snippet: bookingLink, context: 'pending_call_booking_link', message_handle: s2?.message_handle ?? null })
      if (s2?.message_handle) {
        await supabase.from('sms_conversation_states').update({ last_sendblue_message_handle: s2.message_handle, updated_at: new Date().toISOString() }).eq('user_id', userId).is('match_id', null)
      }
    } catch { /* non-fatal */ }
  }

  return { ok: true }
}
