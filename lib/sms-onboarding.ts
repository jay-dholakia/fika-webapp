/**
 * SMS-first conversational onboarding state machine.
 * Called from the sendblue-webhook handler for unknown phone numbers.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { geocodeZip } from '@/lib/geocode'
import { sleepForSmsPacing, SMS_PACING_MS } from '@/lib/sms-pacing'

export type OnboardingSendFn = (content: string, context: string, opts?: { mediaUrl?: string }) => Promise<void>

// ─── Questions ───────────────────────────────────────────────────────────────

type QuestionType = 'free' | 'birthdate' | 'zip' | 'choice' | 'multi_choice' | 'anything_else'

interface Question {
  step: number
  text: string
  type: QuestionType
  choices?: string[]
}

const QUESTIONS: Question[] = [
  { step: 1, text: "What's your first name?", type: 'free' },
  { step: 2, text: "When's your birthday? (month, day, and year — e.g. June 12, 1992)", type: 'birthdate' },
  { step: 3, text: "What gender do you identify as? (e.g. female, male, non-binary — or skip)", type: 'free' },
  {
    step: 4,
    text: "Do you speak any languages besides English? (e.g. Spanish, Mandarin — or just say 'No')",
    type: 'free',
  },
  {
    step: 5,
    text: "What's your zip code? (This helps us match you with people nearby.)",
    type: 'zip',
  },
  {
    step: 6,
    text: "How long have you lived there? (e.g. just moved, 3 years, born and raised)",
    type: 'free',
  },
  {
    step: 7,
    text: "What's your relationship status? (e.g. single, married, it's complicated)",
    type: 'free',
  },
  {
    step: 8,
    text: "Do you have kids? (ages, genders, whatever you'd like — or just say 'No')",
    type: 'free',
  },
  { step: 9, text: "What do you do for work? (be as specific as you want)", type: 'free' },
  { step: 10, text: "What are you into outside of work? (hobbies, how you spend your time)", type: 'free' },
  { step: 11, text: "What's been taking up mental space lately? Could be a project, a decision, something you're building or excited about.", type: 'free' },
  { step: 12, text: "What's a topic you could talk about for hours?", type: 'free' },
  { step: 13, text: "What's something you've been wanting to try or do more of?", type: 'free' },
  {
    step: 14,
    text: "What are you hoping to get out of Fika? Reply with all that apply:\n1. A coworking buddy\n2. A creative collaborator\n3. Someone in a similar industry\n4. Someone in a similar life stage\n5. Someone to hang out with\n6. Just a good coffee conversation\n\n(e.g. reply 1, 3)",
    type: 'multi_choice',
    choices: [
      'A coworking buddy',
      'A creative collaborator',
      'Someone in a similar industry',
      'Someone in a similar life stage',
      'Someone to hang out with',
      'Just a good coffee conversation',
    ],
  },
  {
    step: 15,
    text: "Last one — what times work best for your Fika meetups?\n1. Weekday mornings at 10am\n2. Weekday evenings at 6pm\n3. Both work for me",
    type: 'choice',
    choices: ['Weekday mornings at 10am', 'Weekday evenings at 6pm', 'Both work for me'],
  },
]

const TOTAL_STEPS = 15
const FINISH_STEP = TOTAL_STEPS + 1

function getQuestion(step: number): Question | null {
  return QUESTIONS.find(q => q.step === step) ?? null
}

function getQuestionText(step: number, payload: OnboardingPayload): string {
  if (step === 6) {
    const place = payload.city ?? 'there'
    return `How long have you lived in ${place}? (e.g. just moved, 3 years, born and raised)`
  }
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
  languages?: string[] | null
  zip?: string
  city?: string
  lat?: number
  lng?: number
  q_market_tenure?: string
  q_relationship_status?: string
  q_kids?: string
  q_work?: string
  q_interests_freetext?: string
  q_on_mind?: string
  q_talk_forever?: string
  q_want_to_try?: string
  q_social_goal?: string
  q_fika_time_pref?: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const RE_ENTRY_TRIGGERS = new Set([
  'hi', 'hey', 'hello', 'yo', 'sup', 'continue', 'ready', 'start', 'back',
  'resume', 'still there', 'still here', 'ok', 'okay', 'yes', 'yep', 'sure',
])

function isReEntry(text: string): boolean {
  const t = text.toLowerCase().trim().replace(/[!?.]+$/, '')
  return RE_ENTRY_TRIGGERS.has(t)
}

const SKIP_KEYWORDS = new Set(['no', 'nope', 'skip', 'nothing', 'n/a', 'pass', 'none', 'nah', 'not really'])

function isSkip(text: string): boolean {
  return SKIP_KEYWORDS.has(text.toLowerCase().trim())
}

const ENGLISH_ONLY_PHRASES = new Set([
  'no', 'nope', 'nah', 'none', 'just english', 'english only', 'only english',
  'no other', 'no others', 'n/a', 'na', 'not really', 'just english',
])

function isEnglishOnly(text: string): boolean {
  return ENGLISH_ONLY_PHRASES.has(text.toLowerCase().trim())
}

function parseLanguages(text: string): string[] {
  return text
    .split(/[,\/&]|\band\b/i)
    .map(s => s.trim())
    .filter(s => s.length > 0 && s.toLowerCase() !== 'english')
}

function parseMultiChoice(text: string, choices: string[]): string[] {
  const max = choices.length
  const seen = new Set<number>()
  const result: string[] = []
  const re = /\b([1-9])\b/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const n = parseInt(m[1])
    if (n >= 1 && n <= max && !seen.has(n)) { seen.add(n); result.push(choices[n - 1]) }
  }
  return result
}

function parseChoice(text: string, choices: string[]): number | null {
  const t = text.trim().toLowerCase()

  const num = parseInt(t, 10)
  if (!isNaN(num) && num >= 1 && num <= choices.length) return num - 1

  const match = t.match(/(?:option|choice|number|#)\s*(\d+)/)
  if (match) {
    const n = parseInt(match[1], 10)
    if (!isNaN(n) && n >= 1 && n <= choices.length) return n - 1
  }

  const ordinals = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth']
  const ordIdx = ordinals.indexOf(t)
  if (ordIdx >= 0 && ordIdx < choices.length) return ordIdx

  const exact = choices.findIndex(c => c.toLowerCase() === t)
  if (exact >= 0) return exact

  // Partial match: does the text start with the choice label?
  const partial = choices.findIndex(c => c.toLowerCase().startsWith(t) || t.startsWith(c.toLowerCase()))
  if (partial >= 0) return partial

  return null
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
    return result || fallback
  } catch {
    return fallback
  }
}

async function parseBirthdate(text: string, openaiKey: string): Promise<string | null> {
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
              'Extract the birthdate from the user message. Return ONLY a date in YYYY-MM-DD format. If you cannot determine a valid birthdate, return exactly: null',
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

async function sendIntro(send: OnboardingSendFn): Promise<void> {
  await send("Hey! Welcome to Fika ☕", 'onboarding_intro_1')
  await sleepForSmsPacing(SMS_PACING_MS.quickAck)
  await send(
    "Fika connects you with someone new for coffee — we make the intro, find a time that works for both of you, and pick a cafe nearby.",
    'onboarding_intro_2'
  )
  await sleepForSmsPacing(SMS_PACING_MS.quickAck)
  await send(
    "I'll ask you 15 questions — most take 5 seconds. Ready to start?",
    'onboarding_intro_3'
  )
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
    await sendIntro(send)
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
    await send(QUESTIONS[0].text, 'onboarding_q1')
    return
  }

  // ── Already finished ──────────────────────────────────────────────────────
  if (step >= FINISH_STEP) {
    const finishLink = `${appBase}/finish?token=${session.token}`
    await send(`Last step — add a photo, a face to put to the intro: ${finishLink}`, 'onboarding_finish_resend')
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

  // ── Q1: First name ────────────────────────────────────────────────────────
  if (step === 1) {
    if (!text) {
      await sendReAsk(send, q, step, retryCount, payload, supabase, fromPhone)
      return
    }
    const firstName = text.split(/\s+/)[0]
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
        // Give up and advance without birthdate
        await advanceTo(supabase, fromPhone, send, payload, {}, 3)
        return
      }
      await send("Hmm, I didn't catch that — what's your birthday? (e.g. June 12, 1992 or 6/12/92)", 'onboarding_q2_reask')
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

  // ── Q4: Languages ─────────────────────────────────────────────────────────
  if (step === 4) {
    const langs = isEnglishOnly(text) ? null : parseLanguages(text)
    await advanceTo(supabase, fromPhone, send, payload, { languages: langs }, 5)
    return
  }

  // ── Q5: Zip code ──────────────────────────────────────────────────────────
  if (step === 5) {
    const zip = text.replace(/\D/g, '').slice(0, 10)
    if (zip.length < 5) {
      if (retryCount >= 1) {
        await advanceTo(supabase, fromPhone, send, payload, { zip: text }, 6)
        return
      }
      await send("Could you double-check that zip code?", 'onboarding_q5_reask')
      await updateSession(supabase, fromPhone, { onboarding_retry_count: 1 })
      return
    }
    const geo = await geocodeZip(zip)
    if (!geo) {
      if (retryCount >= 1) {
        await advanceTo(supabase, fromPhone, send, payload, { zip }, 6)
        return
      }
      await send("Hmm, I couldn't find that zip code — could you double-check it?", 'onboarding_q5_reask')
      await updateSession(supabase, fromPhone, { onboarding_retry_count: 1 })
      return
    }
    await advanceTo(supabase, fromPhone, send, payload, {
      zip,
      city: geo.city,
      lat: geo.lat,
      lng: geo.lng,
    }, 6)
    return
  }

  // ── Q6: Time in area (city injected dynamically via getQuestionText) ────────
  if (step === 6) {
    await advanceTo(supabase, fromPhone, send, payload, { q_market_tenure: text }, 7)
    return
  }

  // ── Q7: Relationship status ───────────────────────────────────────────────
  if (step === 7) {
    await advanceTo(supabase, fromPhone, send, payload, { q_relationship_status: text }, 8)
    return
  }

  // ── Q8: Kids ──────────────────────────────────────────────────────────────
  if (step === 8) {
    const kids = isSkip(text) ? null : text
    await advanceTo(supabase, fromPhone, send, payload, { q_kids: kids ?? undefined }, 9)
    return
  }

  // ── Q9: Work ──────────────────────────────────────────────────────────────
  if (step === 9) {
    const ack = openaiKey
      ? await generateContextualAck(
          'You are a friendly SMS concierge for Fika, a social meetup app. The user just told you what they do for work. Write a one-sentence acknowledgment, casual and breezy, like a real person texting. Keep the tone light — never sympathetic, never offer support or help, never say things like "I\'m here for you", "that can be tough", or "let me know if you need anything". Just a quick natural reaction. No em dashes (—). Under 10 words.',
          text,
          "Nice!",
          openaiKey
        )
      : "Nice!"
    await send(ack, 'onboarding_q9_ack')
    await advanceTo(supabase, fromPhone, send, payload, { q_work: text }, 10)
    return
  }

  // ── Q10: What are you into outside work ──────────────────────────────────
  if (step === 10) {
    const ack = openaiKey
      ? await generateContextualAck(
          'You are a friendly SMS concierge for Fika, a social meetup app. The user just shared what they are into outside of work. Write a one-sentence acknowledgment, casual and breezy, like a real person texting. React to something specific they mentioned. Never sympathetic, never offer support or help. Just a quick natural reaction. No em dashes (—). Under 10 words.',
          text,
          'Love that!',
          openaiKey
        )
      : 'Love that!'
    await send(ack, 'onboarding_q10_ack')
    await advanceTo(supabase, fromPhone, send, payload, { q_interests_freetext: text }, 11)
    return
  }

  // ── Q11: What's on your mind ──────────────────────────────────────────────
  if (step === 11) {
    const ack = openaiKey
      ? await generateContextualAck(
          'You are a friendly SMS concierge for Fika, a social meetup app. The user just shared what has been on their mind lately. Write a one-sentence acknowledgment, casual and light, like a real person texting. React naturally — never offer advice, support, or say things like "I\'m here for you" or "that sounds hard". Just a quick genuine reaction. No em dashes (—). Under 10 words.',
          text,
          'That\'s real.',
          openaiKey
        )
      : 'Really appreciate you sharing that.'
    await send(ack, 'onboarding_q11_ack')
    await advanceTo(supabase, fromPhone, send, payload, { q_on_mind: text }, 12)
    return
  }

  // ── Q12: Topic you could talk about for hours ─────────────────────────────
  if (step === 12) {
    await advanceTo(supabase, fromPhone, send, payload, { q_talk_forever: text }, 13)
    return
  }

  // ── Q13: Something you've been wanting to try ─────────────────────────────
  if (step === 13) {
    await advanceTo(supabase, fromPhone, send, payload, { q_want_to_try: text }, 14)
    return
  }

  // ── Q14: Social goal (multi-select) ───────────────────────────────────────
  if (step === 14) {
    const selected = parseMultiChoice(text, q.choices!)
    if (selected.length === 0) {
      await sendChoiceReAsk(send, q, step, retryCount, payload, supabase, fromPhone)
      return
    }
    await advanceTo(supabase, fromPhone, send, payload, { q_social_goal: selected.join(', ') }, 15)
    return
  }

  // ── Q15: Fika time preference ─────────────────────────────────────────────
  if (step === 15) {
    const q15 = getQuestion(15)!
    const idx = parseChoice(text, q15.choices!)
    if (idx === null) {
      await sendChoiceReAsk(send, q15, step, retryCount, payload, supabase, fromPhone)
      return
    }
    const timePref = q15.choices![idx]
    await updateSession(supabase, fromPhone, { q_fika_time_pref: timePref, onboarding_step: FINISH_STEP, onboarding_retry_count: 0 })
    const firstName = payload.first_name ? `, ${payload.first_name}` : ''
    await sleepForSmsPacing(SMS_PACING_MS.quickAck)
    await send(`Last step${firstName} — add a photo, a face to put to the intro: ${appBase}/finish?token=${session.token}`, 'onboarding_finish')
    return
  }
}

// ─── Re-ask helpers ───────────────────────────────────────────────────────────

async function sendReAsk(
  send: OnboardingSendFn,
  _q: Question,
  step: number,
  retryCount: number,
  payload: OnboardingPayload,
  supabase: SupabaseClient,
  fromPhone: string
) {
  if (retryCount >= 1) {
    // Give up and move on
    await advanceTo(supabase, fromPhone, send, payload, {}, step + 1)
    return
  }
  await send("I didn't catch that — could you try again?", `onboarding_q${step}_reask`)
  await updateSession(supabase, fromPhone, { onboarding_retry_count: 1 })
}

async function sendChoiceReAsk(
  send: OnboardingSendFn,
  q: Question,
  step: number,
  retryCount: number,
  payload: OnboardingPayload,
  supabase: SupabaseClient,
  fromPhone: string
) {
  if (retryCount >= 1) {
    // Skip and advance
    await advanceTo(supabase, fromPhone, send, payload, {}, step + 1)
    return
  }
  await send("Just reply with a number from the list 👆", `onboarding_q${step}_reask`)
  await updateSession(supabase, fromPhone, { onboarding_retry_count: 1 })
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
  nextStep: number
): Promise<void> {
  const updatedPayload = { ...currentPayload, ...patch, onboarding_step: nextStep, onboarding_retry_count: 0 }
  await updateSession(supabase, fromPhone, updatedPayload)

  if (nextStep > TOTAL_STEPS) return // finish link is sent by the caller

  const questionText = getQuestionText(nextStep, updatedPayload)
  await sleepForSmsPacing(SMS_PACING_MS.quickAck)
  await send(questionText, `onboarding_q${nextStep}`)
}
