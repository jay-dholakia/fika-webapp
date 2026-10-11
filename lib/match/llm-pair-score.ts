import { getIntakeMulti, getIntakeSingle } from '@/lib/intake-response-utils'

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

  const aboutMe = getIntakeSingle(responses, 'q_about_me')
  const work = getIntakeSingle(responses, 'q_work')

  // Interests: web onboarding chips (q_interests) + SMS free text (q_interests_freetext, q_on_mind)
  const interestsChips = getIntakeMulti(responses, 'q_interests')
  const interestsFreetext = getIntakeSingle(responses, 'q_interests_freetext')
  const onMind = getIntakeSingle(responses, 'q_on_mind')

  // Talking topics: web chips (q_like_talking_about) + SMS free text (q_talk_forever)
  const talkChips = getIntakeMulti(responses, 'q_like_talking_about')
  const talkForever = getIntakeSingle(responses, 'q_talk_forever')

  const wouldDoMoreOf = getIntakeSingle(responses, 'q_would_do_more_of')
  const bucketList = getIntakeSingle(responses, 'q_bucket_list')
  const relationshipStatus = getIntakeSingle(responses, 'q_relationship_status')

  // Goal: SMS uses q_social_goal (multi); web uses q_hoping_for (single)
  const goalParts = getIntakeMulti(responses, 'q_social_goal')
  const goal = goalParts.length ? goalParts.join(', ') : getIntakeSingle(responses, 'q_hoping_for')
  const kids = getIntakeSingle(responses, 'q_kids')

  const headline = `${name}${ageStr}${pronounStr}`
  const lines: string[] = [locationStr ? `${headline} — ${locationStr}.` : `${headline}.`]
  if (aboutMe) lines.push(`About them: ${aboutMe}`)
  if (work) lines.push(`Works as: ${work}.`)

  // Interests — combine chips and free-text so LLM has the full picture
  const interestParts: string[] = []
  if (interestsChips.length) interestParts.push(interestsChips.join(', '))
  if (interestsFreetext) interestParts.push(interestsFreetext)
  if (onMind) interestParts.push(onMind)
  if (interestParts.length) lines.push(`Interests: ${interestParts.join(' | ')}.`)

  // Talking topics — combine chips and free-text
  const talkParts: string[] = []
  if (talkChips.length) talkParts.push(talkChips.join(', '))
  if (talkForever) talkParts.push(talkForever)
  if (talkParts.length) lines.push(`Enjoys talking about: ${talkParts.join(' | ')}.`)

  if (wouldDoMoreOf) lines.push(`Would do more of: ${wouldDoMoreOf}.`)
  if (bucketList) lines.push(`Bucket list: ${bucketList}.`)
  if (relationshipStatus) lines.push(`Relationship status: ${relationshipStatus}.`)
  if (kids) lines.push(`Kids: ${kids}.`)

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
      temperature: 0.4,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You write factual intro messages for Fika coffee meetups. The recipient already knows the other person's profession from a prior message — do not repeat it, and do not mention their job or field at all. Write the message ${nameA} receives (about ${nameB}) and the message ${nameB} receives (about ${nameA}). Each message is 3–4 sentences. Sentence 1: list 2–3 interests or topics this person is into, using ONLY words from their profile. Format: "[Name] is into [interest], [interest], and [interest]." Do not rephrase, combine, or embellish — if the profile says "photography and hiking", write "photography and hiking", not "capturing landscapes on hikes". Sentences 2–4: add 2–3 specific details from their profile — what they could talk about for hours, what's on their bucket list, what they're excited about right now, or what they'd do more of. Use their actual words and natural contractions (she's, he'd, they've). Prefer "she's been wanting to" over "she is excited about", "she could talk about X for hours" over "she enjoys talking about X". If a detail is not explicitly in the profile, do not write it. FILTER: never mention serious health conditions (cancer, chemo, therapy, hospitalization) or financial hardship. Do NOT mention what they're looking for or what they hope to get out of the meetup. Do not predict what conversations with them will be like. Do not use: "passionate about", "unique perspective", "huge fan", "stunning", "really engaging", "love for", "background in". Each sentence covers one idea only — no "while", "blending", or "as well as". No pleasantries, no em dashes, no call to action. Return JSON: {"messageForA": string, "messageForB": string}.`,
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

/**
 * Use AI to identify 3–5 specific topics two people would genuinely enjoy talking about,
 * derived from their full profile context rather than mechanical keyword overlap.
 * Returns an empty array on failure so callers can fall back gracefully.
 */
export async function generateSharedTopics(
  textA: string,
  textB: string,
  openaiKey: string
): Promise<string[]> {
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.4,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'Given two people meeting for coffee, identify 2–3 topics they\'d genuinely enjoy talking about. Each must be a short noun phrase, 1–4 words max (e.g. "photography", "life in LA", "career pivots"). No sentences, no generic labels. Return JSON only: {"topics": string[]}.',
          },
          {
            role: 'user',
            content: `Person A:\n${textA}\n\nPerson B:\n${textB}`,
          },
        ],
      }),
    })
    if (!res.ok) return []
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
    const raw = data.choices?.[0]?.message?.content
    if (!raw) return []
    const parsed = JSON.parse(raw) as { topics?: unknown }
    if (!Array.isArray(parsed.topics)) return []
    return (parsed.topics as unknown[])
      .filter((t): t is string => typeof t === 'string')
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 3)
  } catch {
    return []
  }
}
