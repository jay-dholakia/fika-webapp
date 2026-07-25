import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { isAdminByUserId } from '@/lib/admin-markets'
import { haversineMiles } from '@/lib/fika-social-geo'

export const dynamic = 'force-dynamic'

async function getAdminSupabase(request: Request): Promise<SupabaseClient | null> {
  const supabaseAuth = await createServerSupabase()
  if (!supabaseAuth) return null
  let userId: string | null = null
  const { data: { session } } = await supabaseAuth.auth.getSession()
  if (session?.user?.id) userId = session.user.id
  if (!userId) {
    const authHeader = request.headers.get('Authorization')
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7)
      const { data: { user } } = await supabaseAuth.auth.getUser(token)
      if (user?.id) userId = user.id
    }
  }
  if (!userId) return null
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) throw new Error('Server not configured')
  const supabase = createClient(url, key)
  const admin = await isAdminByUserId(supabase, userId)
  if (!admin) return null
  return supabase
}

function calcAge(birthdate: string | null): number | null {
  if (!birthdate) return null
  const born = new Date(birthdate)
  if (isNaN(born.getTime())) return null
  const today = new Date()
  let age = today.getFullYear() - born.getFullYear()
  const m = today.getMonth() - born.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < born.getDate())) age--
  return age
}

/** GET /api/admin/weekly-events/[id]/eligible-users
 *  Returns the full list of users who would receive this event's opt-in SMS,
 *  applying the same radius/gender/age filters as the edge function. */
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await getAdminSupabase(request)
    if (!supabase) return NextResponse.json({ error: 'Admin role required', code: 'NOT_ADMIN' }, { status: 403 })

    const eventId = params.id
    const { data: event } = await supabase
      .from('weekly_fika_events')
      .select('id, market_slug, event_starts_at, venue_id, radius_miles, gender_filter, min_age, max_age, max_invites')
      .eq('id', eventId)
      .single()

    if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })

    const marketSlug = event.market_slug as string
    const radiusMiles = event.radius_miles as number | null
    const genderFilter = event.gender_filter as string[] | null
    const minAge = event.min_age as number | null
    const maxAge = event.max_age as number | null

    // Venue lat/lng for radius check
    let venueLat: number | null = null
    let venueLng: number | null = null
    if (event.venue_id) {
      const { data: venue } = await supabase
        .from('venues')
        .select('lat, lng')
        .eq('id', event.venue_id)
        .single()
      venueLat = (venue?.lat as number | null) ?? null
      venueLng = (venue?.lng as number | null) ?? null
    }

    // Already RSVPd for this event
    const { data: alreadyRsvpd } = await supabase
      .from('weekly_rsvps')
      .select('user_id')
      .eq('event_id', eventId)
    const alreadyRsvpdIds = new Set((alreadyRsvpd ?? []).map((r: { user_id: string }) => r.user_id))

    // Already invited to this specific event
    const { data: alreadySent } = await supabase
      .from('sms_conversation_states')
      .select('user_id')
      .in('state', ['event_invite_sent', 'weekly_opt_in_sent'])
      .filter('payload->>event_id', 'eq', eventId)
      .is('match_id', null)
    const alreadySentIds = new Set<string>((alreadySent ?? []).map((r: { user_id: string }) => r.user_id))

    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, first_name, phone, lat, lng, gender, birthdate, avatar_url, last_fika_at')
      .eq('market', marketSlug)
      .eq('is_active', true)
      .is('sms_opted_out_at', null)
      .not('phone', 'is', null)
      .order('first_name')

    // Users in any active flow (would be skipped by sms-event-invite)
    const cutoff72h = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString()
    const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const allProfileIds = (profiles ?? []).map((p: { id: string }) => p.id)

    const [{ data: globalBusyRows }, { data: perMatchBusyRows }] = await Promise.all([
      allProfileIds.length > 0
        ? supabase.from('sms_conversation_states').select('user_id')
            .in('user_id', allProfileIds).is('match_id', null).not('state', 'eq', 'global_ready')
        : Promise.resolve({ data: [] }),
      allProfileIds.length > 0
        ? supabase.from('sms_conversation_states').select('user_id')
            .in('user_id', allProfileIds).not('match_id', 'is', null)
            .in('state', ['match_offered', 'match_accepted', 'pre_event_sent'])
            .gte('updated_at', cutoff72h)
        : Promise.resolve({ data: [] }),
    ])
    const activeFlowIds = new Set<string>([
      ...(globalBusyRows ?? []).map((r: { user_id: string }) => r.user_id),
      ...(perMatchBusyRows ?? []).map((r: { user_id: string }) => r.user_id),
    ])

    const eligible: Array<{
      id: string
      first_name: string | null
      phone: string | null
      gender: string | null
      age: number | null
      avatar_url: string | null
      distance_miles: number | null
      already_invited: boolean
      already_rsvpd: boolean
      in_active_flow: boolean
      in_cooldown: boolean
    }> = []

    for (const p of profiles ?? []) {
      const userId = p.id as string
      const pLat = p.lat as number | null
      const pLng = p.lng as number | null

      let distMiles: number | null = null
      let passRadius = true
      if (radiusMiles != null && venueLat != null && venueLng != null) {
        if (pLat == null || pLng == null) {
          passRadius = false
        } else {
          distMiles = haversineMiles(pLat, pLng, venueLat, venueLng)
          passRadius = distMiles <= radiusMiles
        }
      } else if (pLat != null && pLng != null && venueLat != null && venueLng != null) {
        distMiles = haversineMiles(pLat, pLng, venueLat, venueLng)
      }

      const gender = (p.gender as string | null) ?? null
      let passGender = true
      if (genderFilter && genderFilter.length > 0) {
        passGender = !!gender && genderFilter.includes(gender)
      }

      const age = calcAge(p.birthdate as string | null)
      let passAge = true
      if (minAge != null && (age == null || age < minAge)) passAge = false
      if (maxAge != null && (age == null || age > maxAge)) passAge = false

      if (!passRadius || !passGender || !passAge) continue

      const lastFikaAt = (p.last_fika_at as string | null) ?? null
      eligible.push({
        id: userId,
        first_name: (p.first_name as string | null) ?? null,
        phone: (p.phone as string | null) ?? null,
        gender,
        age,
        avatar_url: (p.avatar_url as string | null) ?? null,
        distance_miles: distMiles !== null ? Math.round(distMiles * 10) / 10 : null,
        already_invited: alreadySentIds.has(userId),
        already_rsvpd: alreadyRsvpdIds.has(userId),
        in_active_flow: activeFlowIds.has(userId),
        in_cooldown: !!(lastFikaAt && lastFikaAt > cutoff24h),
      })
    }

    return NextResponse.json({ users: eligible, total: eligible.length })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
