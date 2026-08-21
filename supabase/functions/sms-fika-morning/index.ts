// Fires every 30 min (pg_cron). Finds events starting in 5–5.5 hours with morning_sms_sent_at IS NULL,
// then sends two conversation questions to all yes-RSVP attendees.

declare const Deno: { env: { get(key: string): string | undefined } }
// @ts-ignore Deno
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
// @ts-ignore Deno
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
// @ts-ignore Deno
import { getIanaTimezoneForMarketSlug } from '../_shared/market-timezones.ts'

const SENDBLUE_URL = 'https://api.sendblue.co/api/send-message'

const FIKA_PROMPT_QUESTIONS: string[] = [
  "What's something you've changed your mind about in the last year?",
  "What does your ideal Saturday look like — and how close is your life to that?",
  "Is there a version of your life you almost lived?",
  "What are you most proud of that has nothing to do with work?",
  "What's a belief you hold that most people around you disagree with?",
  "What's something most people don't know about you that you wish they did?",
  "What's the best piece of advice you've ever received — and do you actually follow it?",
  "When did you last do something for the first time?",
  "What's a chapter of your life you rarely talk about but that shaped who you are?",
  "What does success look like for you in five years — and is that what you actually want?",
  "Is there something you keep putting off that you know would be good for you?",
  "What's a risk you've taken that you're glad you took?",
  "What's something you think about often that most people wouldn't expect?",
  "If your closest friend described you to a stranger, what would they say — and would you agree?",
  "What's the hardest thing you've navigated in the last couple of years?",
]

function pickFikaPromptQuestions(eventId: string): [string, string] {
  const hash = eventId.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)
  const n = FIKA_PROMPT_QUESTIONS.length
  const i = hash % n
  const j = (hash * 31 + 7) % n === i ? (hash * 31 + 7 + 1) % n : (hash * 31 + 7) % n
  return [FIKA_PROMPT_QUESTIONS[i]!, FIKA_PROMPT_QUESTIONS[j]!]
}

type IntakeResponse = { question_id: string; answer: unknown }

function getIntakeText(responses: IntakeResponse[], id: string): string {
  const item = responses.find(r => r.question_id === id)
  if (!item?.answer) return ''
  return Array.isArray(item.answer) ? item.answer.join(', ') : String(item.answer)
}

function buildProfileSummary(firstName: string | null, responses: IntakeResponse[]): string {
  const parts: string[] = [firstName?.trim() || 'Someone']
  const work = getIntakeText(responses, 'q_work')
  const interests = getIntakeText(responses, 'q_interests_freetext')
  const goal = getIntakeText(responses, 'q_social_goal')
  if (work) parts.push(`Works as: ${work}`)
  if (interests) parts.push(`Interests: ${interests}`)
  if (goal) parts.push(`Looking for: ${goal}`)
  return parts.join('. ')
}

async function generatePersonalizedQuestions(
  summaryA: string,
  summaryB: string,
  openaiKey: string
): Promise<[string, string] | null> {
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.8,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'Generate 2 short, thoughtful conversation starter questions for two people meeting for a platonic coffee. Look for what they have in common or what makes them genuinely curious about each other — shared interests, life experiences, values, or what they\'re both looking for. Do not ask about their jobs. Open-ended, warm, specific to this pair — not generic icebreakers. Return JSON only: {"q1": string, "q2": string}.',
          },
          {
            role: 'user',
            content: `Person A: ${summaryA}\n\nPerson B: ${summaryB}`,
          },
        ],
      }),
    })
    if (!res.ok) return null
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
    const raw = data.choices?.[0]?.message?.content
    if (!raw) return null
    const parsed = JSON.parse(raw) as { q1?: unknown; q2?: unknown }
    if (typeof parsed.q1 !== 'string' || typeof parsed.q2 !== 'string') return null
    return [parsed.q1.trim(), parsed.q2.trim()]
  } catch {
    return null
  }
}

function formatEventTimeOnly(isoStr: string, tz = 'America/Los_Angeles'): string {
  const d = new Date(isoStr)
  let time = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(d).toLowerCase()
  return time.replace(':00', '')
}

function buildPreEventMessage(params: {
  venueName: string
  neighborhood: string
  eventTimeFormatted: string
  q1: string
  q2: string
}): string {
  const { venueName, neighborhood, eventTimeFormatted, q1, q2 } = params
  const locationLine = neighborhood ? `${venueName} (${neighborhood})` : venueName

  const lines: string[] = [
    `Your Fika is today at ${eventTimeFormatted} at ${locationLine} ☕`,
    '',
    `A couple of things to think about before you go:`,
    `• ${q1}`,
    `• ${q2}`,
    '',
    `You'll hear who you're meeting 30 minutes before.`,
  ]
  return lines.join('\n')
}

function buildPreEventMessage1v1(params: {
  otherFirstName: string
  venueName: string
  neighborhood: string
  eventTimeFormatted: string
  qForThis: string
  qForOther: string
}): string {
  const { otherFirstName, venueName, neighborhood, eventTimeFormatted, qForThis, qForOther } = params
  const locationLine = neighborhood ? `${venueName} (${neighborhood})` : venueName
  return [
    `Your Fika with ${otherFirstName} is today at ${eventTimeFormatted} at ${locationLine} ☕`,
    '',
    `If you need an icebreaker:`,
    `• For you: ${qForThis}`,
    `• For ${otherFirstName}: ${qForOther}`,
  ].join('\n')
}

async function sendMessage(params: {
  apiKeyId: string
  apiSecret: string
  phone: string
  content: string
}): Promise<boolean> {
  const res = await fetch(SENDBLUE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'sb-api-key-id': params.apiKeyId,
      'sb-api-secret-key': params.apiSecret,
    },
    body: JSON.stringify({ number: params.phone, content: params.content }),
  })
  return res.ok
}

serve(async (_req: Request) => {
  try {
    if (Deno.env.get('SMS_OUTBOUND_DISABLED') === 'true') {
      return new Response(JSON.stringify({ ok: true, outbound_disabled: true }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }
    const apiKeyId = Deno.env.get('SENDBLUE_API_KEY_ID')
    const apiSecret = Deno.env.get('SENDBLUE_API_SECRET_KEY')
    if (!apiKeyId || !apiSecret) {
      return new Response(JSON.stringify({ error: 'Sendblue not configured' }), { status: 503 })
    }
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const nowMs = Date.now()
    const windowStart = new Date(nowMs + 5 * 60 * 60 * 1000).toISOString()
    const windowEnd = new Date(nowMs + 5.5 * 60 * 60 * 1000).toISOString()

    const { data: events } = await supabase
      .from('weekly_fika_events')
      .select('id, market_slug, event_starts_at, venue_id')
      .gte('event_starts_at', windowStart)
      .lte('event_starts_at', windowEnd)
      .is('morning_sms_sent_at', null)

    let totalSent = 0

    for (const event of (events ?? [])) {
      const eventId = event.id as string
      const eventStartsAt = event.event_starts_at as string
      const venueId = event.venue_id as string | null
      const eventTz = getIanaTimezoneForMarketSlug(event.market_slug as string | null)
      const eventTimeFormatted = formatEventTimeOnly(eventStartsAt, eventTz)

      // Get venue info
      let venueName = 'your Fika venue'
      let neighborhood = ''
      if (venueId) {
        const { data: venue } = await supabase
          .from('venues')
          .select('name, neighborhood, city')
          .eq('id', venueId)
          .single()
        if (venue) {
          venueName = (venue.name as string) || venueName
          neighborhood = (venue.neighborhood as string) || (venue.city as string) || ''
        }
      }

      const [q1, q2] = pickFikaPromptQuestions(eventId)
      const message = buildPreEventMessage({ venueName, neighborhood, eventTimeFormatted, q1, q2 })

      // Get all yes-RSVP users and their phone numbers
      const { data: rsvps } = await supabase
        .from('weekly_rsvps')
        .select('user_id')
        .eq('event_id', eventId)
        .eq('decision', 'yes')

      const userIds = (rsvps ?? []).map((r: { user_id: string }) => r.user_id)
      if (userIds.length === 0) {
        await supabase
          .from('weekly_fika_events')
          .update({ morning_sms_sent_at: new Date().toISOString() })
          .eq('id', eventId)
        continue
      }

      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, phone')
        .in('id', userIds)

      for (const profile of (profiles ?? []) as Array<{ id: string; phone: string | null }>) {
        const phone = profile.phone?.trim()
        if (!phone) continue
        const sent = await sendMessage({ apiKeyId, apiSecret, phone, content: message })
        if (sent) {
          totalSent++
          await supabase.rpc('upsert_global_sms_conversation_state', {
            p_user_id: profile.id,
            p_state: 'social_morning_reminder',
            p_payload: { event_id: eventId },
            p_last_sendblue_message_handle: null,
          })
        }
      }

      await supabase
        .from('weekly_fika_events')
        .update({ morning_sms_sent_at: new Date().toISOString() })
        .eq('id', eventId)
    }

    const openaiKey = Deno.env.get('EXPO_PUBLIC_OPENAI_API_KEY') || Deno.env.get('OPENAI_API_KEY') || ''

    // --- 1v1 pre-event SMS block ---
    const nowMs1v1 = Date.now()
    const windowStart1v1 = new Date(nowMs1v1 + 5 * 60 * 60 * 1000).toISOString()
    const windowEnd1v1 = new Date(nowMs1v1 + 5.5 * 60 * 60 * 1000).toISOString()

    const { data: onev1Matches } = await supabase
      .from('match_candidates')
      .select('id, user_a, user_b, reasons')
      .eq('status', 'active')
      .filter('reasons->>source', 'eq', '1v1')

    let onev1Sent = 0
    for (const match of (onev1Matches ?? []) as Array<{
      id: string; user_a: string; user_b: string; reasons: Record<string, unknown>
    }>) {
      const matchId = match.id
      const reasons = match.reasons ?? {}
      const eventStartsAt = typeof reasons.event_starts_at === 'string' ? reasons.event_starts_at : null
      if (!eventStartsAt) continue
      if (eventStartsAt < windowStart1v1 || eventStartsAt > windowEnd1v1) continue

      const venueId = typeof reasons.venue_id === 'string' ? reasons.venue_id : null
      let venueName = 'your Fika venue'
      let neighborhood = ''
      if (venueId) {
        const { data: venue } = await supabase
          .from('venues').select('name, neighborhood').eq('id', venueId).single()
        if (venue) {
          venueName = (venue.name as string) || venueName
          neighborhood = (venue.neighborhood as string) || ''
        }
      }

      const eventTimeFormatted = formatEventTimeOnly(eventStartsAt)

      // Use pre-generated questions from sim if available, otherwise generate fresh (or fall back to hash)
      type StoredQuestions = { qForA: string; qForB: string }
      const rawQ = reasons.questions
      const storedQuestions: StoredQuestions | null =
        rawQ && typeof rawQ === 'object' && !Array.isArray(rawQ) &&
        typeof (rawQ as StoredQuestions).qForA === 'string' && typeof (rawQ as StoredQuestions).qForB === 'string'
          ? rawQ as StoredQuestions
          : null

      // Always need profiles for phone numbers and names; only load intake if we need to generate questions
      const [{ data: nameProfiles }, { data: intakeRows }] = await Promise.all([
        supabase.from('profiles').select('id, first_name, phone').in('id', [match.user_a, match.user_b]),
        storedQuestions
          ? Promise.resolve({ data: [] })
          : supabase.from('intake_responses_v5').select('user_id, responses').in('user_id', [match.user_a, match.user_b]),
      ])

      const profileList = (nameProfiles ?? []) as Array<{ id: string; first_name: string | null; phone: string | null }>

      let qForA: string
      let qForB: string
      if (storedQuestions) {
        qForA = storedQuestions.qForA
        qForB = storedQuestions.qForB
      } else {
        const intakeMap = new Map<string, IntakeResponse[]>()
        for (const row of (intakeRows ?? []) as Array<{ user_id: string; responses: IntakeResponse[] }>) {
          intakeMap.set(row.user_id, row.responses ?? [])
        }
        const summaryA = buildProfileSummary(profileList.find(p => p.id === match.user_a)?.first_name ?? null, intakeMap.get(match.user_a) ?? [])
        const summaryB = buildProfileSummary(profileList.find(p => p.id === match.user_b)?.first_name ?? null, intakeMap.get(match.user_b) ?? [])
        const aiQuestions = openaiKey ? await generatePersonalizedQuestions(summaryA, summaryB, openaiKey) : null
        if (aiQuestions) {
          [qForA, qForB] = aiQuestions
        } else {
          const [fb1, fb2] = pickFikaPromptQuestions(matchId)
          qForA = fb1
          qForB = fb2
        }
      }

      // Find users who accepted: match_accepted (old flow) or confirmed (new scheduling flow)
      const { data: stateRows } = await supabase
        .from('sms_conversation_states')
        .select('user_id')
        .eq('match_id', matchId)
        .in('state', ['1v1_accepted', '1v1_confirmed'])

      const acceptedUserIds = (stateRows ?? []).map((r: { user_id: string }) => r.user_id)
      if (acceptedUserIds.length === 0) continue

      const nameMap: Record<string, string> = {}
      for (const p of profileList) {
        nameMap[p.id] = p.first_name?.trim() || 'Someone'
      }

      for (const uid of acceptedUserIds) {
        const prof = (nameProfiles ?? []).find((p: { id: string }) => p.id === uid) as
          { id: string; first_name: string | null; phone: string | null } | undefined
        const phone = prof?.phone?.trim()
        if (!phone) continue

        const otherUserId = uid === match.user_a ? match.user_b : match.user_a
        const otherName = nameMap[otherUserId] || 'Someone'
        const isUserA = uid === match.user_a

        const message = buildPreEventMessage1v1({
          otherFirstName: otherName,
          venueName,
          neighborhood,
          eventTimeFormatted,
          qForThis: isUserA ? qForA : qForB,
          qForOther: isUserA ? qForB : qForA,
        })

        const sent = await sendMessage({ apiKeyId, apiSecret, phone, content: message })
        if (sent) {
          await supabase
            .from('sms_conversation_states')
            .update({ state: '1v1_morning_reminder', updated_at: new Date().toISOString() })
            .eq('user_id', uid)
            .eq('match_id', matchId)
          onev1Sent++
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, morning_sms_sent: totalSent, onev1_sent: onev1Sent }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 })
  }
})
