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
  {
    step: 3,
    text: "What gender do you identify as?\n1. Female\n2. Male\n3. Non-binary\n4. Prefer not to say",
    type: 'choice',
    choices: ['Female', 'Male', 'Non-binary', 'Prefer not to say'],
  },
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
  // Step 6 text is dynamically built with the city from step 5
  {
    step: 6,
    text: "How long have you lived there? (e.g. just moved, 3 years, born and raised)",
    type: 'free',
  },
  {
    step: 7,
    text: "What neighborhood are you in? (e.g. Silver Lake, West Village, Lincoln Park)",
    type: 'free',
  },
  {
    step: 8,
    text: "What's your relationship status? (e.g. single, married, it's complicated)",
    type: 'free',
  },
  {
    step: 9,
    text: "Do you have kids? (ages, genders, whatever you'd like — or just say 'No')",
    type: 'free',
  },
  { step: 10, text: "What do you do for work? (be as specific as you want)", type: 'free' },
  { step: 11, text: "What are you into outside of work? (hobbies, how you spend your time, what you're currently obsessed with)", type: 'free' },
  { step: 12, text: "What's been on your mind lately — anything you've been thinking about, working through, or excited about?", type: 'free' },
  {
    step: 13,
    text: "What are you hoping to get out of Fika? Reply with all that apply:\n1. Someone to think out loud with\n2. A creative collaborator\n3. A coworking buddy\n4. Someone going through a similar life chapter\n5. Fresh perspectives on things I'm wrestling with\n6. Genuine connection outside of work and apps\n7. Someone who sees the world differently\n8. No agenda — just good conversation\n\n(e.g. reply 1, 3)",
    type: 'multi_choice',
    choices: [
      'Someone to think out loud with',
      'A creative collaborator',
      'A coworking buddy',
      'Someone going through a similar life chapter',
      "Fresh perspectives on things I'm wrestling with",
      'Genuine connection outside of work and apps',
      'Someone who sees the world differently',
      'No agenda — just good conversation',
    ],
  },
  {
    step: 14,
    text: "Last one — what times work best for your Fika meetups?\n1. Weekday mornings at 10am\n2. Weekday evenings at 6pm\n3. Both work for me",
    type: 'choice',
    choices: ['Weekday mornings at 10am', 'Weekday evenings at 6pm', 'Both work for me'],
  },
]

const TOTAL_STEPS = 14
const FINISH_STEP = TOTAL_STEPS + 1

function getQuestion(step: number): Question | null {
  return QUESTIONS.find(q => q.step === step) ?? null
}

function buildQ6Text(city: string): string {
  const cityShort = city.split(',')[0].trim()
  return `How long have you lived in ${cityShort}? (e.g. just moved, 3 years, born and raised)`
}

function getQuestionText(step: number, payload: OnboardingPayload): string {
  const q = getQuestion(step)
  if (!q) return ''
  if (step === 6) {
    const city = payload.city ?? 'there'
    return buildQ6Text(city)
  }
  return q.text
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
  q_neighborhood?: string
  q_relationship_status?: string
  q_kids?: string
  q_work?: string
  q_interests_freetext?: string
  q_social_goal?: string
  q_on_mind?: string
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
          { role: 'system', content: systemPrompt },
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
    "Fika's pretty simple — we find someone in your city worth grabbing coffee with and make the intro. Real people, real conversation.",
    'onboarding_intro_2'
  )
  await sleepForSmsPacing(SMS_PACING_MS.quickAck)
  await send(
    "I'm going to ask you 14 quick questions so we can find the right match. Ready to start?",
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

  // Dedup: SendBlue occasionally double-delivers. Drop if we've already processed this handle.
  if (messageHandle && payload.last_message_handle && payload.last_message_handle === messageHandle) {
    console.warn('[sms-onboarding] duplicate message_handle, dropping', messageHandle.slice(-8))
    return
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
    await send(`Last step — tap here to add a photo and sign in with Google to verify your account: ${finishLink}`, 'onboarding_finish_resend')
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

  // Claim this message handle before any sends to prevent a concurrent duplicate from running
  if (messageHandle) {
    await updateSession(supabase, fromPhone, { last_message_handle: messageHandle })
  }

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
    const idx = parseChoice(text, q.choices!)
    if (idx === null) {
      await sendChoiceReAsk(send, q, step, retryCount, payload, supabase, fromPhone)
      return
    }
    await advanceTo(supabase, fromPhone, send, payload, { gender: q.choices![idx] }, 4)
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

  // ── Q6: Time in city ──────────────────────────────────────────────────────
  if (step === 6) {
    await advanceTo(supabase, fromPhone, send, payload, { q_market_tenure: text }, 7)
    return
  }

  // ── Q7: Neighborhood ─────────────────────────────────────────────────────
  if (step === 7) {
    await advanceTo(supabase, fromPhone, send, payload, { q_neighborhood: text }, 8)
    return
  }

  // ── Q8: Relationship status ───────────────────────────────────────────────
  if (step === 8) {
    await advanceTo(supabase, fromPhone, send, payload, { q_relationship_status: text }, 9)
    return
  }

  // ── Q9: Kids ──────────────────────────────────────────────────────────────
  if (step === 9) {
    const kids = isSkip(text) ? null : text
    await advanceTo(supabase, fromPhone, send, payload, { q_kids: kids ?? undefined }, 10)
    return
  }

  // ── Q10: Work ─────────────────────────────────────────────────────────────
  if (step === 10) {
    const ack = openaiKey
      ? await generateContextualAck(
          'You are a friendly SMS concierge for Fika, a social meetup app. The user just told you what they do for work. Write a one-sentence acknowledgment, casual and breezy, like a real person texting. Keep the tone light — never sympathetic, never offer support or help, never say things like "I\'m here for you", "that can be tough", or "let me know if you need anything". Just a quick natural reaction. No em dashes (—). Under 10 words.',
          text,
          "Nice!",
          openaiKey
        )
      : "Nice!"
    await send(ack, 'onboarding_q10_ack')
    await advanceTo(supabase, fromPhone, send, payload, { q_work: text }, 11)
    return
  }

  // ── Q11: What are you into outside work ──────────────────────────────────
  if (step === 11) {
    const ack = openaiKey
      ? await generateContextualAck(
          'You are a friendly SMS concierge for Fika, a social meetup app. The user just shared what they are into outside of work. Write a one-sentence acknowledgment, casual and breezy, like a real person texting. React to something specific they mentioned. Never sympathetic, never offer support or help. Just a quick natural reaction. No em dashes (—). Under 10 words.',
          text,
          'Love that!',
          openaiKey
        )
      : 'Love that!'
    await send(ack, 'onboarding_q11_ack')
    await advanceTo(supabase, fromPhone, send, payload, { q_interests_freetext: text }, 12)
    return
  }

  // ── Q12: What's on your mind ──────────────────────────────────────────────
  if (step === 12) {
    const ack = openaiKey
      ? await generateContextualAck(
          'You are a friendly SMS concierge for Fika, a social meetup app. The user just shared what has been on their mind lately. Write a one-sentence acknowledgment, casual and light, like a real person texting. React naturally — never offer advice, support, or say things like "I\'m here for you" or "that sounds hard". Just a quick genuine reaction. No em dashes (—). Under 10 words.',
          text,
          'That\'s real.',
          openaiKey
        )
      : 'Really appreciate you sharing that.'
    await send(ack, 'onboarding_q12_ack')
    await advanceTo(supabase, fromPhone, send, payload, { q_on_mind: text }, 13)
    return
  }

  // ── Q13: Social goal (multi-select) ───────────────────────────────────────
  if (step === 13) {
    const selected = parseMultiChoice(text, q.choices!)
    if (selected.length === 0) {
      await sendChoiceReAsk(send, q, step, retryCount, payload, supabase, fromPhone)
      return
    }
    await advanceTo(supabase, fromPhone, send, payload, { q_social_goal: selected.join(', ') }, 14)
    return
  }

  // ── Q14: Fika time preference ─────────────────────────────────────────────
  if (step === 14) {
    const q14 = getQuestion(14)!
    const idx = parseChoice(text, q14.choices!)
    if (idx === null) {
      await sendChoiceReAsk(send, q14, step, retryCount, payload, supabase, fromPhone)
      return
    }
    const timePref = q14.choices![idx]
    await updateSession(supabase, fromPhone, { q_fika_time_pref: timePref, onboarding_step: FINISH_STEP, onboarding_retry_count: 0 })
    const firstName = payload.first_name ? `, ${payload.first_name}` : ''
    await sleepForSmsPacing(SMS_PACING_MS.quickAck)
    await send(`That's it${firstName}! 🎉 One last step — tap here to add a photo and sign in with Google to verify your account: ${appBase}/finish?token=${session.token}`, 'onboarding_finish')
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
