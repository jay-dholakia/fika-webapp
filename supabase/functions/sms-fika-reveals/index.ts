// Fires every 5 min (pg_cron). Finds events starting in 25–35 min with reveals_sent_at IS NULL,
// then sends a short person-reveal SMS to each matched pair and confirms the match.

declare const Deno: { env: { get(key: string): string | undefined } }
// @ts-ignore Deno
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
// @ts-ignore Deno
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
// @ts-ignore Deno
import { getIanaTimezoneForMarketSlug } from '../_shared/market-timezones.ts'

const SENDBLUE_URL = 'https://api.sendblue.co/api/send-message'

function formatEventTime(isoStr: string, tz = 'America/Los_Angeles'): string {
  const d = new Date(isoStr)
  let time = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(d).toLowerCase()
  time = time.replace(':00', '')
  const dayDate = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  }).format(d)
  return `${dayDate} at ${time}`
}

function buildRevealMessage(params: {
  otherFirstName: string
  otherWorkLabel: string | null
  venueName: string
  neighborhood: string
  eventTimeFormatted: string
}): string {
  const { otherFirstName, otherWorkLabel, venueName, neighborhood, eventTimeFormatted } = params
  const name = otherFirstName.trim() || 'Someone'
  const workBit = otherWorkLabel?.trim() ? `${name} is a ${otherWorkLabel.trim()}.` : ''
  const locationLine = neighborhood ? `${venueName} (${neighborhood})` : venueName

  const lines: string[] = [
    `Meet ${name} 👋`,
    '',
    ...(workBit ? [workBit, ''] : []),
    `${eventTimeFormatted}`,
    locationLine,
    '',
    `Spend the first 10–15 minutes just getting to know each other — then dive into those questions. See you there ☕`,
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
    const windowStart = new Date(nowMs + 25 * 60 * 1000).toISOString()
    const windowEnd = new Date(nowMs + 35 * 60 * 1000).toISOString()

    const { data: events } = await supabase
      .from('weekly_fika_events')
      .select('id, market_slug, event_starts_at, venue_id')
      .gte('event_starts_at', windowStart)
      .lte('event_starts_at', windowEnd)
      .is('reveals_sent_at', null)

    if (!events?.length) {
      return new Response(JSON.stringify({ ok: true, reveals_sent: 0, reason: 'no_events_in_window' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    let totalRevealsSent = 0

    for (const event of events) {
      const eventId = event.id as string
      const eventStartsAt = event.event_starts_at as string
      const venueId = event.venue_id as string | null
      const eventTz = getIanaTimezoneForMarketSlug(event.market_slug as string | null)
      const eventTimeFormatted = formatEventTime(eventStartsAt, eventTz)

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

      // Get all users who RSVPd yes for this event
      const { data: rsvps } = await supabase
        .from('weekly_rsvps')
        .select('user_id')
        .eq('event_id', eventId)
        .eq('decision', 'yes')

      const yesUserIds = new Set((rsvps ?? []).map((r: { user_id: string }) => r.user_id))
      if (yesUserIds.size < 2) {
        await supabase
          .from('weekly_fika_events')
          .update({ reveals_sent_at: new Date().toISOString() })
          .eq('id', eventId)
        continue
      }

      // Get approved match_candidates where BOTH users are in the yes set
      const { data: matches } = await supabase
        .from('match_candidates')
        .select('id, user_a, user_b')
        .eq('status', 'active')
        .eq('admin_approval_status', 'approved')

      const matchesToReveal = (matches ?? []).filter(
        (m: { user_a: string; user_b: string }) =>
          yesUserIds.has(m.user_a) && yesUserIds.has(m.user_b)
      )

      for (const match of matchesToReveal) {
        const matchId = match.id as string
        const userA = match.user_a as string
        const userB = match.user_b as string

        // Get both profiles
        const { data: profileRows } = await supabase
          .from('profiles')
          .select('id, first_name, phone')
          .in('id', [userA, userB])

        const profA = (profileRows ?? []).find((p: { id: string }) => p.id === userA)
        const profB = (profileRows ?? []).find((p: { id: string }) => p.id === userB)

        const phoneA = (profA?.phone as string | null)?.trim()
        const phoneB = (profB?.phone as string | null)?.trim()
        if (!phoneA || !phoneB) continue

        const nameA = (profA?.first_name as string | null)?.trim() || 'Someone'
        const nameB = (profB?.first_name as string | null)?.trim() || 'Someone'

        // Get work labels from intake
        const { data: intakeRows } = await supabase
          .from('intake_responses_v5')
          .select('user_id, responses')
          .in('user_id', [userA, userB])

        const intakeA = (intakeRows ?? []).find((r: { user_id: string }) => r.user_id === userA)
        const intakeB = (intakeRows ?? []).find((r: { user_id: string }) => r.user_id === userB)
        const workA = (() => {
          const r = (intakeA?.responses as Record<string, unknown> | null) ?? {}
          return typeof r.q_work === 'string' ? r.q_work.trim() : null
        })()
        const workB = (() => {
          const r = (intakeB?.responses as Record<string, unknown> | null) ?? {}
          return typeof r.q_work === 'string' ? r.q_work.trim() : null
        })()

        const msgForA = buildRevealMessage({
          otherFirstName: nameB,
          otherWorkLabel: workB,
          venueName,
          neighborhood,
          eventTimeFormatted,
        })
        const msgForB = buildRevealMessage({
          otherFirstName: nameA,
          otherWorkLabel: workA,
          venueName,
          neighborhood,
          eventTimeFormatted,
        })

        const sentA = await sendMessage({ apiKeyId, apiSecret, phone: phoneA, content: msgForA })
        const sentB = await sendMessage({ apiKeyId, apiSecret, phone: phoneB, content: msgForB })

        if (sentA || sentB) {
          // Set state to CONFIRMED for both users
          for (const userId of [userA, userB]) {
            await supabase.rpc('upsert_global_sms_conversation_state', {
              p_user_id: userId,
              p_state: 'confirmed',
              p_payload: { match_id: matchId, event_id: eventId },
              p_last_sendblue_message_handle: null,
            })
          }

          totalRevealsSent++
        }
      }

      // Send fallback to any yes-RSVP users who weren't in a matched pair
      const matchedUserIds = new Set<string>()
      for (const m of matchesToReveal) {
        matchedUserIds.add(m.user_a as string)
        matchedUserIds.add(m.user_b as string)
      }
      const unmatchedIds = [...yesUserIds].filter(id => !matchedUserIds.has(id))
      if (unmatchedIds.length > 0) {
        const { data: unmatchedProfiles } = await supabase
          .from('profiles')
          .select('id, phone')
          .in('id', unmatchedIds)
        for (const prof of (unmatchedProfiles ?? []) as Array<{ id: string; phone: string | null }>) {
          const phone = prof.phone?.trim()
          if (!phone) continue
          await sendMessage({
            apiKeyId,
            apiSecret,
            phone,
            content: "We weren't able to pair you for this one — sorry about that. We'll get you next time.",
          })
          await supabase.rpc('upsert_global_sms_conversation_state', {
            p_user_id: prof.id,
            p_state: 'global_ready',
            p_payload: {},
            p_last_sendblue_message_handle: null,
          })
        }
      }

      // Mark reveals as sent for this event
      await supabase
        .from('weekly_fika_events')
        .update({ reveals_sent_at: new Date().toISOString() })
        .eq('id', eventId)
    }

    return new Response(JSON.stringify({ ok: true, reveals_sent: totalRevealsSent }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 })
  }
})
