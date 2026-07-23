// SMS edge function: sends event invite SMS to eligible users.
// Triggered manually by admin via POST { event_id } or with { event_id, user_ids }.

declare const Deno: { env: { get(key: string): string | undefined } }
// @ts-ignore Deno
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
// @ts-ignore Deno
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
// @ts-ignore Deno
import { getIanaTimezoneForMarketSlug } from '../_shared/market-timezones.ts'

const SENDBLUE_URL = 'https://api.sendblue.co/api/send-message'

function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const R = 3958.7613
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

function calcAge(birthdate: string | null): number | null {
  if (!birthdate) return null
  const born = new Date(birthdate)
  if (isNaN(born.getTime())) return null
  const today = new Date()
  const years = today.getFullYear() - born.getFullYear()
  const hadBirthday =
    today.getMonth() > born.getMonth() ||
    (today.getMonth() === born.getMonth() && today.getDate() >= born.getDate())
  return hadBirthday ? years : years - 1
}

function formatEventDateTime(isoStr: string, tz = 'America/Los_Angeles'): { dayDate: string; time: string } {
  const d = new Date(isoStr)
  const dayDate = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  }).format(d)
  let time = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(d).toLowerCase()
  time = time.replace(':00', '')
  return { dayDate, time }
}

function buildOptInMessage(params: { dayDate: string; time: string; venueName: string; neighborhood: string }): string {
  const { dayDate, time, venueName, neighborhood } = params
  return `We're hosting a Fika on ${dayDate} at ${time} at ${venueName} in ${neighborhood}.\n\nSpots are limited — reply Yes or No within 24 hours.`
}

serve(async (req: Request) => {
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

    let requestedEventId: string | null = null
    let requestedUserIds: string[] | null = null
    try {
      const body = await req.json()
      if (body?.event_id) requestedEventId = String(body.event_id)
      if (Array.isArray(body?.user_ids) && body.user_ids.length > 0) {
        requestedUserIds = body.user_ids.map(String)
      }
    } catch { /* no body */ }

    if (!requestedEventId) {
      return new Response(JSON.stringify({ error: 'event_id is required' }), { status: 400 })
    }

    const { data: event } = await supabase
      .from('weekly_fika_events')
      .select('id, market_slug, event_starts_at, venue_id, radius_miles, gender_filter, min_age, max_age, max_invites, opt_in_deadline_hours')
      .eq('id', requestedEventId)
      .single()

    if (!event) {
      return new Response(JSON.stringify({ error: 'Event not found' }), { status: 404 })
    }

    const eventId = event.id as string
    const marketSlug = event.market_slug as string
    const eventStartsAt = event.event_starts_at as string | null
    const radiusMiles = event.radius_miles as number | null
    const genderFilter = event.gender_filter as string[] | null
    const minAge = event.min_age as number | null
    const maxAge = event.max_age as number | null
    const maxInvites = event.max_invites as number | null

    if (!eventStartsAt) {
      return new Response(JSON.stringify({ error: 'Event has no start time set' }), { status: 400 })
    }

    const sentAt = new Date().toISOString()

    // Venue info
    let venueName = 'a great spot'
    let neighborhood = ''
    let venueLat: number | null = null
    let venueLng: number | null = null
    if (event.venue_id) {
      const { data: venue } = await supabase
        .from('venues')
        .select('name, neighborhood, city, lat, lng')
        .eq('id', event.venue_id)
        .single()
      if (venue) {
        venueName = (venue.name as string) || venueName
        neighborhood = (venue.neighborhood as string) || (venue.city as string) || ''
        venueLat = (venue.lat as number | null) ?? null
        venueLng = (venue.lng as number | null) ?? null
      }
    }

    const eventTz = getIanaTimezoneForMarketSlug(marketSlug)
    const { dayDate, time } = formatEventDateTime(eventStartsAt, eventTz)
    const message = buildOptInMessage({ dayDate, time, venueName, neighborhood })

    // Dedup: already invited to this specific event
    const { data: alreadySentStates } = await supabase
      .from('sms_conversation_states')
      .select('user_id')
      .in('state', ['event_invite_sent', 'weekly_opt_in_sent'])
      .filter('payload->>event_id', 'eq', eventId)
      .is('match_id', null)
    const alreadySentIds = new Set((alreadySentStates ?? []).map((r: { user_id: string }) => r.user_id))

    // Dedup: already RSVPd to this specific event
    const { data: alreadyRsvpd } = await supabase
      .from('weekly_rsvps')
      .select('user_id')
      .eq('event_id', eventId)
    const alreadyRsvpdIds = new Set((alreadyRsvpd ?? []).map((r: { user_id: string }) => r.user_id))

    // Count current invites for capacity check
    const alreadySentCount = alreadySentIds.size

    // Build eligible profiles query
    let profilesQuery = supabase
      .from('profiles')
      .select('id, phone, lat, lng, gender, birthdate')
      .eq('market', marketSlug)
      .eq('is_active', true)
      .is('sms_opted_out_at', null)
      .not('phone', 'is', null)

    if (requestedUserIds) {
      profilesQuery = profilesQuery.in('id', requestedUserIds)
    }

    const { data: profiles } = await profilesQuery

    let totalSent = 0
    let totalSkipped = 0

    for (const profile of profiles ?? []) {
      // Capacity check
      if (maxInvites !== null && (alreadySentCount + totalSent) >= maxInvites) {
        totalSkipped++
        continue
      }

      const userId = profile.id as string
      const phone = ((profile.phone as string) ?? '').trim()
      if (!phone) continue

      // Skip if already invited or RSVPd for this event
      if (!requestedUserIds && (alreadySentIds.has(userId) || alreadyRsvpdIds.has(userId))) {
        totalSkipped++
        continue
      }
      // In user_ids mode, still skip if already RSVPd for this event
      if (requestedUserIds && alreadyRsvpdIds.has(userId)) {
        totalSkipped++
        continue
      }

      // Radius filter
      if (radiusMiles != null && venueLat != null && venueLng != null) {
        const pLat = profile.lat as number | null
        const pLng = profile.lng as number | null
        if (pLat == null || pLng == null) { totalSkipped++; continue }
        const dist = haversineMiles(pLat, pLng, venueLat, venueLng)
        if (dist > radiusMiles) { totalSkipped++; continue }
      }

      // Gender filter
      if (genderFilter && genderFilter.length > 0) {
        const g = (profile.gender as string | null) ?? ''
        if (!g || !genderFilter.includes(g)) { totalSkipped++; continue }
      }

      // Age filter
      if (minAge != null || maxAge != null) {
        const age = calcAge(profile.birthdate as string | null)
        if (age == null) { totalSkipped++; continue }
        if (minAge != null && age < minAge) { totalSkipped++; continue }
        if (maxAge != null && age > maxAge) { totalSkipped++; continue }
      }

      const res = await fetch(SENDBLUE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'sb-api-key-id': apiKeyId,
          'sb-api-secret-key': apiSecret,
        },
        body: JSON.stringify({ number: phone, content: message }),
      })

      if (res.ok) {
        await supabase.rpc('upsert_global_sms_conversation_state', {
          p_user_id: userId,
          p_state: 'event_invite_sent',
          p_payload: { market_slug: marketSlug, event_id: eventId, sent_at: sentAt },
          p_last_sendblue_message_handle: null,
        })
        totalSent++
      }
    }

    return new Response(JSON.stringify({ ok: true, sent: totalSent, skipped: totalSkipped }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 })
  }
})
