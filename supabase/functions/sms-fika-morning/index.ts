// Fires every 30 min (pg_cron). Finds events starting in 7–9 hours with morning_sms_sent_at IS NULL,
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

function buildMorningMessage(params: {
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
    `While you're getting ready, here are two things to kick off the conversation:`,
    `• ${q1}`,
    `• ${q2}`,
    '',
    `You'll hear who you're meeting 30 minutes before.`,
  ]
  return lines.join('\n')
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
    const windowStart = new Date(nowMs + 7 * 60 * 60 * 1000).toISOString()
    const windowEnd = new Date(nowMs + 9 * 60 * 60 * 1000).toISOString()

    const { data: events } = await supabase
      .from('weekly_fika_events')
      .select('id, market_slug, event_starts_at, venue_id')
      .gte('event_starts_at', windowStart)
      .lte('event_starts_at', windowEnd)
      .is('morning_sms_sent_at', null)

    if (!events?.length) {
      return new Response(JSON.stringify({ ok: true, morning_sms_sent: 0, reason: 'no_events_in_window' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    let totalSent = 0

    for (const event of events) {
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
      const message = buildMorningMessage({ venueName, neighborhood, eventTimeFormatted, q1, q2 })

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
        if (sent) totalSent++
      }

      await supabase
        .from('weekly_fika_events')
        .update({ morning_sms_sent_at: new Date().toISOString() })
        .eq('id', eventId)
    }

    return new Response(JSON.stringify({ ok: true, morning_sms_sent: totalSent }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 })
  }
})
