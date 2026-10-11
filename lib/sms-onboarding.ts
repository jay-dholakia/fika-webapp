/**
 * SMS-first conversational onboarding state machine.
 * Called from the sendblue-webhook handler for unknown phone numbers.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { geocodeZip } from '@/lib/geocode'
import { sleepForSmsPacing, SMS_PACING_MS, typingDurationMs } from '@/lib/sms-pacing'
import { prepareOutboundAiPresence } from '@/lib/sendblue'

export type OnboardingSendFn = (content: string, context: string, opts?: { mediaUrl?: string }) => Promise<void>

// ─── Questions ───────────────────────────────────────────────────────────────

type QuestionType = 'free' | 'birthdate' | 'zip'

interface Question {
  step: number
  text: string
  type: QuestionType
  choices?: string[]
}

const QUESTIONS: Question[] = [
  { step: 1, text: "What's your first name?", type: 'free' },
  { step: 2, text: "When's your birthday? Like June 12, 1992.", type: 'birthdate' },
  { step: 3, text: "How do you identify — male, female, non-binary, or something else?", type: 'free' },
  { step: 4, text: "What's your zip code? We'll use it to find people near you.", type: 'zip' },
]

const TOTAL_STEPS = 4
const FINISH_STEP = TOTAL_STEPS + 1

function getQuestion(step: number): Question | null {
  return QUESTIONS.find(q => q.step === step) ?? null
}

function getQuestionText(step: number, _payload: OnboardingPayload): string {
  return getQuestion(step)?.text ?? ''
}

// ─── Payload type ─────────────────────────────────────────────────────────────

export interface OnboardingPayload {
  onboarding_step?: number
  onboarding_retry_count?: number
  last_message_handle?: string
  first_name?: string
  birthdate?: string
  gender?: string
  zip?: string
  city?: string
  lat?: number
  lng?: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const NAME_BLOCKLIST = new Set([
  'fuck', 'shit', 'ass', 'asshole', 'bitch', 'cunt', 'dick', 'cock',
  'pussy', 'bastard', 'slut', 'whore', 'nigga', 'nigger', 'faggot', 'fag',
  'retard', 'nazi',
])

function isValidName(name: string): boolean {
  if (name.replace(/\s/g, '').length < 2) return false
  if (/^\d+$/.test(name)) return false
  return !NAME_BLOCKLIST.has(name.toLowerCase())
}

const RE_ENTRY_TRIGGERS = new Set([
  'hi', 'hey', 'hello', 'yo', 'sup', 'continue', 'ready', 'start', 'back',
  'resume', 'still there', 'still here', 'ok', 'okay', 'yes', 'yep', 'sure',
])

function isReEntry(text: string): boolean {
  const t = text.toLowerCase().trim().replace(/[!?.]+$/, '')
  return RE_ENTRY_TRIGGERS.has(t)
}

async function generateContextualAck(
  systemPrompt: string,
  userContent: string,
  fallback: string,
  openaiKey: string
): Promise<string> {
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt + ' Do NOT ask any questions or request more information.' },
          { role: 'user', content: userContent },
        ],
        max_tokens: 40,
        temperature: 0.8,
      }),
    })
    if (!res.ok) return fallback
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
    const result = (data?.choices?.[0]?.message?.content ?? '').trim().replace(/—/g, '-')
    if (!result || result.includes('?')) return fallback
    return result
  } catch {
    return fallback
  }
}

function tryParseDateLocally(text: string): string | null {
  const t = text.trim()
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t
  // M/D/YYYY or M/D/YY or MM/DD/YYYY or MM/DD/YY
  const slash = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (slash) {
    const [, m, d, rawY] = slash
    const y = rawY.length === 2 ? `19${rawY}` : rawY
    const mm = m.padStart(2, '0')
    const dd = d.padStart(2, '0')
    const date = new Date(`${y}-${mm}-${dd}`)
    if (!isNaN(date.getTime())) return `${y}-${mm}-${dd}`
  }
  // M-D-YYYY or MM-DD-YYYY
  const dash = t.match(/^(\d{1,2})-(\d{1,2})-(\d{2,4})$/)
  if (dash) {
    const [, m, d, rawY] = dash
    const y = rawY.length === 2 ? `19${rawY}` : rawY
    const mm = m.padStart(2, '0')
    const dd = d.padStart(2, '0')
    const date = new Date(`${y}-${mm}-${dd}`)
    if (!isNaN(date.getTime())) return `${y}-${mm}-${dd}`
  }
  // Month-name formats: "May 13 1993", "May 13, 1993", "13 May 1993"
  const MONTH: Record<string, string> = {
    january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
    july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
    jan: '01', feb: '02', mar: '03', apr: '04', jun: '06', jul: '07', aug: '08',
    sep: '09', oct: '10', nov: '11', dec: '12',
  }
  const mdy = t.match(/^([a-zA-Z]+)\s+(\d{1,2}),?\s+(\d{2,4})$/)
  if (mdy) {
    const mm = MONTH[mdy[1].toLowerCase()]
    if (mm) {
      const y = mdy[3].length === 2 ? `19${mdy[3]}` : mdy[3]
      const dd = mdy[2].padStart(2, '0')
      const date = new Date(`${y}-${mm}-${dd}`)
      if (!isNaN(date.getTime())) return `${y}-${mm}-${dd}`
    }
  }
  const dmy = t.match(/^(\d{1,2})\s+([a-zA-Z]+)\s+(\d{2,4})$/)
  if (dmy) {
    const mm = MONTH[dmy[2].toLowerCase()]
    if (mm) {
      const y = dmy[3].length === 2 ? `19${dmy[3]}` : dmy[3]
      const dd = dmy[1].padStart(2, '0')
      const date = new Date(`${y}-${mm}-${dd}`)
      if (!isNaN(date.getTime())) return `${y}-${mm}-${dd}`
    }
  }
  return null
}

async function parseBirthdate(text: string, openaiKey: string): Promise<string | null> {
  const local = tryParseDateLocally(text)
  if (local) return local
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content:
              'Extract the birthdate from the user message. Return ONLY a date in YYYY-MM-DD format. Treat two-digit years as 1900s (e.g. "93" = 1993, "85" = 1985). If you cannot determine a valid birthdate, return exactly: null',
          },
          { role: 'user', content: text },
        ],
        max_tokens: 15,
        temperature: 0,
      }),
    })
    if (!res.ok) return null
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
    const result = (data?.choices?.[0]?.message?.content ?? '').trim()
    if (!result || result === 'null') return null
    if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) return null
    return result
  } catch {
    return null
  }
}

// ─── Intro messages ───────────────────────────────────────────────────────────

async function sendIntro(send: OnboardingSendFn, fromPhone: string): Promise<void> {
  const text = "Hey! I'm Jay from Fika ☕ I'll ask 4 quick questions, then we'll set up a short call so I can intro you to people nearby you'd genuinely enjoy — ready to go?"
  await sleepForSmsPacing(SMS_PACING_MS.beat)
  await prepareOutboundAiPresence(fromPhone)
  await sleepForSmsPacing(typingDurationMs(text))
  await send(text, 'onboarding_intro')
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function handleSmsOnboarding(params: {
  supabase: SupabaseClient
  fromPhone: string
  content: string
  messageHandle?: string
  send: OnboardingSendFn
  appBase: string
  openaiKey?: string
}): Promise<void> {
  const { supabase, fromPhone, content, messageHandle, send, appBase, openaiKey } = params

  // Look up existing unmerged session
  const { data: session } = await supabase
    .from('onboarding_sessions')
    .select('id, token, payload, updated_at')
    .eq('phone', fromPhone)
    .is('merged_into_user_id', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // ── New user: no session yet ───────────────────────────────────────────────
  if (!session) {
    const token = crypto.randomUUID()
    const { error } = await supabase.from('onboarding_sessions').insert({
      token,
      phone: fromPhone,
      payload: { onboarding_step: 0, onboarding_retry_count: 0 },
      updated_at: new Date().toISOString(),
    })
    if (error) {
      console.error('[sms-onboarding] session insert failed', error.message)
      return
    }
    await sendIntro(send, fromPhone)
    // Stay at step 0 — wait for user confirmation before firing Q1
    return
  }

  const payload = (session.payload as OnboardingPayload) ?? {}
  const step = payload.onboarding_step ?? 0
  const retryCount = payload.onboarding_retry_count ?? 0

  // Dedup: atomically claim this handle so concurrent duplicate deliveries can't both proceed.
  if (messageHandle) {
    const { data: claimed } = await supabase.rpc('try_claim_onboarding_handle', {
      p_phone: fromPhone,
      p_handle: messageHandle,
    })
    if (!claimed) {
      console.warn('[sms-onboarding] duplicate handle, dropping', messageHandle.slice(-8))
      return
    }
  } else {
    // No handle (delivery/status event): drop if session was touched in the last 4 seconds.
    const sessionAge = Date.now() - new Date(session.updated_at).getTime()
    if (sessionAge < 4000) {
      console.warn('[sms-onboarding] no handle + session updated <4s ago, dropping likely status event')
      return
    }
  }

  // ── Confirmation gate: step=0 means intro was sent, waiting for user to confirm ──
  if (step === 0) {
    // Any reply at step=0 is treated as confirmation — fire Q1
    await updateSession(supabase, fromPhone, { onboarding_step: 1, onboarding_retry_count: 0 })
    await sleepForSmsPacing(SMS_PACING_MS.quickAck)
    await prepareOutboundAiPresence(fromPhone)
    await sleepForSmsPacing(typingDurationMs(QUESTIONS[0].text))
    await send(QUESTIONS[0].text, 'onboarding_q1')
    return
  }

  // ── Already finished ──────────────────────────────────────────────────────
  if (step >= FINISH_STEP) {
    const finishLink = `${appBase}/finish?token=${session.token}`
    const firstName = payload.first_name ? `, ${payload.first_name}` : ''
    await send(`That's everything${firstName} ✨ Last step — add a photo and confirm your account: ${finishLink}`, 'onboarding_finish_resend')
    return
  }

  // ── Re-entry: user typed a greeting instead of an answer ─────────────────
  if (isReEntry(content)) {
    const firstName = payload.first_name ? ` ${payload.first_name}` : ''
    await send(`Hey${firstName}! Let's pick up where we left off.`, 'onboarding_reentry')
    await sleepForSmsPacing(SMS_PACING_MS.quickAck)
    await send(getQuestionText(step, payload), `onboarding_q${step}_resend`)
    return
  }

  // ── Process answer for current step ───────────────────────────────────────
  await processAnswer({ supabase, fromPhone, content, messageHandle, send, appBase, openaiKey, session, payload, step, retryCount })
}

async function processAnswer(params: {
  supabase: SupabaseClient
  fromPhone: string
  content: string
  messageHandle?: string
  send: OnboardingSendFn
  appBase: string
  openaiKey?: string
  session: { id: string; token: string }
  payload: OnboardingPayload
  step: number
  retryCount: number
}): Promise<void> {
  const { supabase, fromPhone, content, messageHandle, send, appBase, openaiKey, session, payload, step, retryCount } = params
  const q = getQuestion(step)
  if (!q) return

  const text = content.trim()

  // ── Confusion detection: if they're asking a question, re-send the current Q ─
  if (text.includes('?')) {
    await send("Just reply with your answer and we'll keep moving!", `onboarding_q${step}_confusion`)
    await sleepForSmsPacing(SMS_PACING_MS.quickAck)
    await send(getQuestionText(step, payload), `onboarding_q${step}_resend`)
    return
  }

  // ── Q1: First name ────────────────────────────────────────────────────────
  if (step === 1) {
    const firstName = text.split(/\s+/)[0]
    if (!isValidName(firstName)) {
      if (retryCount >= 1) {
        await send("No worries — we'll come back to that.", 'onboarding_q1_skip')
        await advanceTo(supabase, fromPhone, send, payload, {}, 2)
        return
      }
      await send("Hmm, that doesn't quite work — what's your first name?", 'onboarding_q1_name_invalid')
      await updateSession(supabase, fromPhone, { onboarding_retry_count: 1 })
      return
    }
    const nameAck = openaiKey
      ? await generateContextualAck(
          'You are a friendly SMS concierge for Fika, a social meetup app. The user just told you their first name. Write a warm, natural one-sentence greeting using their name. Sound like a real person texting, not a bot. No em dashes (—). Keep it under 10 words.',
          firstName,
          `Nice to meet you, ${firstName}!`,
          openaiKey
        )
      : `Nice to meet you, ${firstName}!`
    await send(nameAck, 'onboarding_q1_ack')
    await advanceTo(supabase, fromPhone, send, payload, { first_name: firstName }, 2)
    return
  }

  // ── Q2: Birthday ──────────────────────────────────────────────────────────
  if (step === 2) {
    if (!openaiKey) {
      // Skip if no OpenAI key — store raw text
      await advanceTo(supabase, fromPhone, send, payload, { birthdate: text }, 3)
      return
    }
    const parsed = await parseBirthdate(text, openaiKey)
    if (!parsed) {
      if (retryCount >= 1) {
        await send("No worries, we'll skip that one!", 'onboarding_q2_skip')
        await advanceTo(supabase, fromPhone, send, payload, {}, 3)
        return
      }
      await send("Hmm, I didn't catch that — what's your birthday? Something like June 12, 1992 or 6/12/92.", 'onboarding_q2_reask')
      await updateSession(supabase, fromPhone, { onboarding_retry_count: 1 })
      return
    }
    await advanceTo(supabase, fromPhone, send, payload, { birthdate: parsed }, 3)
    return
  }

  // ── Q3: Gender ────────────────────────────────────────────────────────────
  if (step === 3) {
    const isSkip = /^(skip|prefer not|no|n\/a|-)$/i.test(text)
    await advanceTo(supabase, fromPhone, send, payload, { gender: isSkip ? undefined : (text || undefined) }, 4)
    return
  }

  // ── Q4: Zip code ──────────────────────────────────────────────────────────
  if (step === 4) {
    const zip = text.replace(/\D/g, '').slice(0, 10)
    if (zip.length < 5) {
      if (retryCount >= 1) {
        await finishOnboarding(supabase, fromPhone, send, payload, { zip: text }, session, appBase)
        return
      }
      await send("Could you double-check that zip code?", 'onboarding_q4_reask')
      await updateSession(supabase, fromPhone, { onboarding_retry_count: 1 })
      return
    }
    const geo = await geocodeZip(zip)
    if (!geo) {
      if (retryCount >= 1) {
        await finishOnboarding(supabase, fromPhone, send, payload, { zip }, session, appBase)
        return
      }
      await send("Hmm, I couldn't find that zip code — could you double-check it?", 'onboarding_q4_reask')
      await updateSession(supabase, fromPhone, { onboarding_retry_count: 1 })
      return
    }
    await finishOnboarding(supabase, fromPhone, send, payload, { zip, city: geo.city, lat: geo.lat, lng: geo.lng }, session, appBase)
    return
  }
}

// ─── Finish helper ────────────────────────────────────────────────────────────

async function finishOnboarding(
  supabase: SupabaseClient,
  fromPhone: string,
  send: OnboardingSendFn,
  payload: OnboardingPayload,
  patch: Partial<OnboardingPayload>,
  session: { token: string },
  appBase: string
): Promise<void> {
  await updateSession(supabase, fromPhone, { ...patch, onboarding_step: FINISH_STEP, onboarding_retry_count: 0 })
  const firstName = payload.first_name ? `, ${payload.first_name}` : ''
  const finishMsg = `That's everything${firstName} ✨ Last step — add a photo and confirm your account: ${appBase}/finish?token=${session.token}`
  await sleepForSmsPacing(SMS_PACING_MS.beat)
  await prepareOutboundAiPresence(fromPhone)
  await sleepForSmsPacing(typingDurationMs(finishMsg))
  await send(finishMsg, 'onboarding_finish')
}

// ─── State helpers ────────────────────────────────────────────────────────────

async function updateSession(
  supabase: SupabaseClient,
  phone: string,
  patch: Partial<OnboardingPayload>
): Promise<void> {
  const { data: current } = await supabase
    .from('onboarding_sessions')
    .select('payload')
    .eq('phone', phone)
    .is('merged_into_user_id', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const existing = (current?.payload as OnboardingPayload) ?? {}
  const merged = { ...existing, ...patch }

  await supabase
    .from('onboarding_sessions')
    .update({ payload: merged, updated_at: new Date().toISOString() })
    .eq('phone', phone)
    .is('merged_into_user_id', null)
}

async function advanceTo(
  supabase: SupabaseClient,
  fromPhone: string,
  send: OnboardingSendFn,
  currentPayload: OnboardingPayload,
  patch: Partial<OnboardingPayload>,
  nextStep: number,
  pacingMs?: number
): Promise<void> {
  const updatedPayload = { ...currentPayload, ...patch, onboarding_step: nextStep, onboarding_retry_count: 0 }
  await updateSession(supabase, fromPhone, updatedPayload)

  if (nextStep > TOTAL_STEPS) return // finish link is sent by the caller

  const questionText = getQuestionText(nextStep, updatedPayload)
  await sleepForSmsPacing(pacingMs ?? SMS_PACING_MS.beat)
  await prepareOutboundAiPresence(fromPhone)
  await sleepForSmsPacing(typingDurationMs(questionText))
  await send(questionText, `onboarding_q${nextStep}`)
}
