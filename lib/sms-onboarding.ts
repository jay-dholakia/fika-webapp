/**
 * SMS-first conversational onboarding state machine.
 * Called from the sendblue-webhook handler for unknown phone numbers.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { geocodeZip } from '@/lib/geocode'
import { sleepForSmsPacing, SMS_PACING_MS } from '@/lib/sms-pacing'

export type OnboardingSendFn = (content: string, context: string) => Promise<void>

// ─── Questions ───────────────────────────────────────────────────────────────

type QuestionType = 'free' | 'birthdate' | 'zip' | 'choice' | 'anything_else'

interface Question {
  step: number
  text: string
  type: QuestionType
  choices?: string[]
}

const QUESTIONS: Question[] = [
  { step: 1, text: "What's your first name?", type: 'free' },
  { step: 2, text: "When's your birthday?", type: 'birthdate' },
  {
    step: 3,
    text: "What gender do you identify as?\n1. Woman\n2. Man\n3. Non-binary\n4. Prefer not to say",
    type: 'choice',
    choices: ['Woman', 'Man', 'Non-binary', 'Prefer not to say'],
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
    text: 'How long have you lived there?\n1. Just moved\n2. Less than a year\n3. 1–3 years\n4. 3–10 years\n5. Over 10 years\n6. Grew up here',
    type: 'choice',
    choices: ['Just moved', 'Less than a year', '1–3 years', '3–10 years', 'Over 10 years', 'Grew up here'],
  },
  { step: 7, text: "What do you do for work?", type: 'free' },
  { step: 8, text: "What do you like to do? Tell me whatever comes to mind.", type: 'free' },
  {
    step: 9,
    text: "In social situations you're usually...\n1. The one starting conversations\n2. Warm once comfortable, slow to open up\n3. More one-on-one than group\n4. Depends on the day",
    type: 'choice',
    choices: ['The one starting conversations', 'Warm once comfortable, slow to open up', 'More one-on-one than group', 'Depends on the day'],
  },
  {
    step: 10,
    text: "When you picture a great Fika, what matters most?\n1. Someone who challenges how I think\n2. Good laughs, easy conversation\n3. Real talk, no performance\n4. A totally different perspective\n5. Wherever it goes, I'm in",
    type: 'choice',
    choices: ['Someone who challenges how I think', 'Good laughs, easy conversation', 'Real talk, no performance', 'A totally different perspective', "Wherever it goes, I'm in"],
  },
  {
    step: 11,
    text: "What are you hoping to get out of Fika?\n1. Expand my circle\n2. Find activity buddies\n3. Have more interesting conversations\n4. Make actual friends\n5. Just see who's out there",
    type: 'choice',
    choices: ['Expand my circle', 'Find activity buddies', 'Have more interesting conversations', 'Make actual friends', "Just see who's out there"],
  },
  {
    step: 12,
    text: "Last one — anything else about you that might help us find the right person to intro you to? (say 'skip' if not)",
    type: 'anything_else',
  },
]

const TOTAL_STEPS = 12
const FINISH_STEP = TOTAL_STEPS + 1

function getQuestion(step: number): Question | null {
  return QUESTIONS.find(q => q.step === step) ?? null
}

function buildQ6Text(city: string): string {
  const cityShort = city.split(',')[0].trim()
  return (
    `How long have you lived in ${cityShort}?\n` +
    '1. Just moved\n2. Less than a year\n3. 1–3 years\n4. 3–10 years\n5. Over 10 years\n6. Grew up here'
  )
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
  first_name?: string
  birthdate?: string
  gender?: string
  languages?: string[] | null
  zip?: string
  city?: string
  lat?: number
  lng?: number
  q_market_tenure?: string
  q_work?: string
  q_interests_freetext?: string
  q_social_style?: string
  q_fika_vibe?: string
  q_social_goal?: string
  q_anything_else?: string
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
    "We match you with someone worth meeting for a real in-person coffee. We pick the spot, set the time — all you have to do is show up.",
    'onboarding_intro_2'
  )
  await sleepForSmsPacing(SMS_PACING_MS.quickAck)
  await send(
    "I'll ask you 12 quick questions to set up your profile. Takes about 2 minutes.",
    'onboarding_intro_3'
  )
  await sleepForSmsPacing(SMS_PACING_MS.quickAck)
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function handleSmsOnboarding(params: {
  supabase: SupabaseClient
  fromPhone: string
  content: string
  send: OnboardingSendFn
  appBase: string
  openaiKey?: string
}): Promise<void> {
  const { supabase, fromPhone, content, send, appBase, openaiKey } = params

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
    await send(QUESTIONS[0].text, 'onboarding_q1')
    await updateSession(supabase, fromPhone, { onboarding_step: 1, onboarding_retry_count: 0 })
    return
  }

  const payload = (session.payload as OnboardingPayload) ?? {}
  const step = payload.onboarding_step ?? 0
  const retryCount = payload.onboarding_retry_count ?? 0

  // ── Duplicate delivery guard (session updated within last 60s, step=0) ─────
  if (step === 0) {
    const ageMs = Date.now() - new Date(session.updated_at).getTime()
    if (ageMs < 60_000) return // duplicate webhook, drop
    // Intro sent but Q1 not yet asked — resend Q1
    await send(QUESTIONS[0].text, 'onboarding_q1_resend')
    await updateSession(supabase, fromPhone, { onboarding_step: 1, onboarding_retry_count: 0 })
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
  await processAnswer({ supabase, fromPhone, content, send, appBase, openaiKey, session, payload, step, retryCount })
}

async function processAnswer(params: {
  supabase: SupabaseClient
  fromPhone: string
  content: string
  send: OnboardingSendFn
  appBase: string
  openaiKey?: string
  session: { id: string; token: string }
  payload: OnboardingPayload
  step: number
  retryCount: number
}): Promise<void> {
  const { supabase, fromPhone, content, send, appBase, openaiKey, session, payload, step, retryCount } = params
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
    await send(`Nice to meet you, ${firstName}! 🙂`, 'onboarding_q1_ack')
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
    const idx = parseChoice(text, q.choices!)
    if (idx === null) {
      await sendChoiceReAsk(send, q, step, retryCount, payload, supabase, fromPhone)
      return
    }
    await advanceTo(supabase, fromPhone, send, payload, { q_market_tenure: q.choices![idx] }, 7)
    return
  }

  // ── Q7: Work ──────────────────────────────────────────────────────────────
  if (step === 7) {
    await send('Got it.', 'onboarding_q7_ack')
    await advanceTo(supabase, fromPhone, send, payload, { q_work: text }, 8)
    return
  }

  // ── Q8: Interests ─────────────────────────────────────────────────────────
  if (step === 8) {
    await send('Love that.', 'onboarding_q8_ack')
    await advanceTo(supabase, fromPhone, send, payload, { q_interests_freetext: text }, 9)
    return
  }

  // ── Q9: Social style ──────────────────────────────────────────────────────
  if (step === 9) {
    const idx = parseChoice(text, q.choices!)
    if (idx === null) {
      await sendChoiceReAsk(send, q, step, retryCount, payload, supabase, fromPhone)
      return
    }
    await advanceTo(supabase, fromPhone, send, payload, { q_social_style: q.choices![idx] }, 10)
    return
  }

  // ── Q10: Fika vibe ────────────────────────────────────────────────────────
  if (step === 10) {
    const idx = parseChoice(text, q.choices!)
    if (idx === null) {
      await sendChoiceReAsk(send, q, step, retryCount, payload, supabase, fromPhone)
      return
    }
    await advanceTo(supabase, fromPhone, send, payload, { q_fika_vibe: q.choices![idx] }, 11)
    return
  }

  // ── Q11: Social goal ──────────────────────────────────────────────────────
  if (step === 11) {
    const idx = parseChoice(text, q.choices!)
    if (idx === null) {
      await sendChoiceReAsk(send, q, step, retryCount, payload, supabase, fromPhone)
      return
    }
    await advanceTo(supabase, fromPhone, send, payload, { q_social_goal: q.choices![idx] }, 12)
    return
  }

  // ── Q12: Anything else ────────────────────────────────────────────────────
  if (step === 12) {
    const anything = isSkip(text) ? null : text
    await updateSession(supabase, fromPhone, { q_anything_else: anything ?? undefined, onboarding_step: FINISH_STEP, onboarding_retry_count: 0 })
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
