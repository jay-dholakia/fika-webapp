import { getIntakeSingle } from '@/lib/intake-response-utils'

/**
 * Build a compact narrative profile text from a user's profile fields and SMS intake responses.
 * Used as input to LLM pair scoring and intro copy generation.
 */
export function buildUserProfileText(
  profile: {
    first_name?: string | null
    birthdate?: string | null
    pronouns?: string | null
    city?: string | null
  },
  responses: unknown,
  feedbackContext?: { lastSentiment?: string | null }
): string {
  const name = profile.first_name?.trim() || 'Unknown'

  let ageStr = ''
  if (profile.birthdate) {
    const d = new Date(profile.birthdate)
    const age = Math.floor((Date.now() - d.getTime()) / (365.25 * 24 * 60 * 60 * 1000))
    if (!isNaN(age) && age >= 18 && age < 120) ageStr = `, ${age}`
  }

  const pronounStr = profile.pronouns?.trim() ? `, ${profile.pronouns.trim()}` : ''

  const city = profile.city?.split(',')[0]?.trim() || ''
  const neighborhood = getIntakeSingle(responses, 'q_neighborhood')
  const tenure = getIntakeSingle(responses, 'q_market_tenure')
  let locationStr = neighborhood && city ? `${neighborhood}, ${city}` : city
  if (tenure) locationStr += locationStr ? ` (${tenure} in the city)` : tenure

  const relStatus = getIntakeSingle(responses, 'q_relationship_status')
  const kids = getIntakeSingle(responses, 'q_kids')
  const work = getIntakeSingle(responses, 'q_work')
  const interests = getIntakeSingle(responses, 'q_interests_freetext')
  const onMind = getIntakeSingle(responses, 'q_on_mind')
  const talkForever = getIntakeSingle(responses, 'q_talk_forever')
  const wantToTry = getIntakeSingle(responses, 'q_want_to_try')
  const goal = getIntakeSingle(responses, 'q_social_goal')

  const headline = `${name}${ageStr}${pronounStr}`
  const lines: string[] = [locationStr ? `${headline} — ${locationStr}.` : `${headline}.`]
  if (relStatus) lines.push(`Life context: ${relStatus}.`)
  if (kids) lines.push(`Kids: ${kids}.`)
  if (work) lines.push(`Works as: ${work}.`)
  if (interests) lines.push(`Life outside work: ${interests}.`)
  if (onMind) lines.push(`On their mind lately: ${onMind}.`)
  if (talkForever) lines.push(`Could talk for hours about: ${talkForever}.`)
  if (wantToTry) lines.push(`Wants to try more of: ${wantToTry}.`)
  if (goal) lines.push(`Looking to get out of Fika: ${goal}.`)
  if (feedbackContext?.lastSentiment === 'negative') lines.push('Note: rated their last Fika poorly — look for a stronger match on interests.')
  if (feedbackContext?.lastSentiment === 'positive') lines.push('Note: enjoyed their last Fika — open and engaged.')

  return lines.join('\n').trim()
}

/**
 * Ask GPT-4o-mini to score a pair 0–100 and explain why they'd enjoy meeting.
 * Throws on API failure so caller can fall back to structured scorer.
 */
export async function scorePairWithLLM(
  textA: string,
  textB: string,
  openaiKey: string
): Promise<{ score: number; reason: string }> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You are a matchmaker for Fika, a strictly platonic social coffee-meetup app. Two people meet for in-person coffee — that is all. Score their compatibility 0–100 for a genuine conversation over coffee. Focus on shared or complementary interests, professional overlap, neighborhood proximity, and what they want out of the meetup. Life context (relationship status, kids) is background — it tells you about their life stage, not their availability. Never penalize or reward based on relationship status. Return JSON only: {"score": number, "reason": string}. The reason must be 1 sentence, specific and concrete (e.g. "both founders in Silver Lake who love the outdoors"), no filler, no hedging. 75+ = strong match, 50–74 = decent, under 50 = weak.',
        },
        {
          role: 'user',
          content: `Profile A:\n${textA}\n\nProfile B:\n${textB}`,
        },
      ],
    }),
  })
  if (!res.ok) throw new Error(`OpenAI error ${res.status}`)
  const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
  const raw = data.choices?.[0]?.message?.content
  if (!raw) throw new Error('Empty response from OpenAI')
  const parsed = JSON.parse(raw) as { score?: unknown; reason?: unknown }
  const score = Math.max(0, Math.min(100, Math.round(Number(parsed.score))))
  const reason = typeof parsed.reason === 'string' ? parsed.reason.trim() : ''
  return { score, reason }
}

/**
 * Generate 2 personalized conversation starter questions for a matched pair.
 * Returns null on any failure so callers can fall back to the hash-based picker.
 */
export type FikaQuestions = { qForA: string; qForB: string }

export async function generateFikaQuestions(
  textA: string,
  textB: string,
  openaiKey: string,
  opts?: { avoidForA?: string[]; avoidForB?: string[] }
): Promise<FikaQuestions | null> {
  try {
    const avoidA = opts?.avoidForA?.filter(Boolean) ?? []
    const avoidB = opts?.avoidForB?.filter(Boolean) ?? []
    const avoidLines: string[] = []
    if (avoidA.length) avoidLines.push(`Person A has already been asked: ${avoidA.join(' | ')}. Don't repeat these.`)
    if (avoidB.length) avoidLines.push(`Person B has already been asked: ${avoidB.join(' | ')}. Don't repeat these.`)

    const systemPrompt = [
      'Generate one conversation starter question for Person A and one for Person B, for a platonic coffee meetup.',
      'Each question should be tailored to draw something specific out of that person — their interests, life experiences, values, or what they\'re looking for — ideally sparked by what the other person shares.',
      'Do not ask about their jobs. Open-ended, warm, specific — not generic icebreakers.',
      ...avoidLines,
      'Return JSON only: {"qForA": string, "qForB": string}.',
    ].join(' ')

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.8,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Person A:\n${textA}\n\nPerson B:\n${textB}` },
        ],
      }),
    })
    if (!res.ok) return null
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
    const raw = data.choices?.[0]?.message?.content
    if (!raw) return null
    const parsed = JSON.parse(raw) as { qForA?: unknown; qForB?: unknown }
    if (typeof parsed.qForA !== 'string' || typeof parsed.qForB !== 'string') return null
    return { qForA: parsed.qForA.trim(), qForB: parsed.qForB.trim() }
  } catch {
    return null
  }
}

/**
 * Generate personalized intro SMS copy for both users in a matched pair.
 * Returns a message for each side introducing the other person.
 * Throws on failure so caller can fall back to the template builder.
 */
export async function generateMatchIntroCopy(
  nameA: string,
  profileTextA: string,
  nameB: string,
  profileTextB: string,
  openaiKey: string
): Promise<{ messageForA: string; messageForB: string }> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.7,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You write friendly, natural intro SMS messages for Fika coffee match introductions. Given two user profiles, write the message ${nameA} receives (introducing them to ${nameB}) and the message ${nameB} receives (introducing them to ${nameA}). Each message: 2–3 sentences, conversational tone, reference something specific and genuine about the other person. End with a simple call to action like "Interested?" or "Up for it?". No em dashes. Return JSON: {"messageForA": string, "messageForB": string}.`,
        },
        {
          role: 'user',
          content: `${nameA}'s profile:\n${profileTextA}\n\n${nameB}'s profile:\n${profileTextB}`,
        },
      ],
    }),
  })
  if (!res.ok) throw new Error(`OpenAI error ${res.status}`)
  const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
  const raw = data.choices?.[0]?.message?.content
  if (!raw) throw new Error('Empty response from OpenAI')
  const parsed = JSON.parse(raw) as { messageForA?: unknown; messageForB?: unknown }
  return {
    messageForA: typeof parsed.messageForA === 'string' ? parsed.messageForA.trim() : '',
    messageForB: typeof parsed.messageForB === 'string' ? parsed.messageForB.trim() : '',
  }
}
