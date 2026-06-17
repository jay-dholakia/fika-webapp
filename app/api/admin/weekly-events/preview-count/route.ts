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

/** GET /api/admin/weekly-events/preview-count */
export async function GET(request: Request) {
  try {
    const supabase = await getAdminSupabase(request)
    if (!supabase) return NextResponse.json({ error: 'Admin role required', code: 'NOT_ADMIN' }, { status: 403 })

    const { searchParams } = new URL(request.url)
    const marketSlug = searchParams.get('market_slug')?.trim() ?? ''
    const venueId = searchParams.get('venue_id')?.trim() ?? ''
    const radiusMilesRaw = searchParams.get('radius_miles')
    const genderFilterRaw = searchParams.get('gender_filter')
    const minAgeRaw = searchParams.get('min_age')
    const maxAgeRaw = searchParams.get('max_age')

    if (!marketSlug) return NextResponse.json({ error: 'market_slug is required' }, { status: 400 })

    const radiusMiles = radiusMilesRaw ? parseFloat(radiusMilesRaw) : null
    const genderFilter = genderFilterRaw ? genderFilterRaw.split(',').map(s => s.trim()).filter(Boolean) : null
    const minAge = minAgeRaw ? parseInt(minAgeRaw) : null
    const maxAge = maxAgeRaw ? parseInt(maxAgeRaw) : null

    // Venue lat/lng for radius check
    let venueLat: number | null = null
    let venueLng: number | null = null
    if (venueId) {
      const { data: venue } = await supabase
        .from('venues')
        .select('lat, lng')
        .eq('id', venueId)
        .single()
      venueLat = (venue?.lat as number | null) ?? null
      venueLng = (venue?.lng as number | null) ?? null
    }

    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('id, lat, lng, gender, birthdate')
      .eq('market', marketSlug)
      .eq('is_active', true)
      .is('sms_opted_out_at', null)
      .not('phone', 'is', null)

    if (profilesError) {
      console.error('[preview-count] profiles query error:', profilesError)
      return NextResponse.json({ error: profilesError.message }, { status: 500 })
    }

    const rawCount = (profiles ?? []).length
    let count = 0

    for (const p of profiles ?? []) {
      const pLat = p.lat as number | null
      const pLng = p.lng as number | null

      if (radiusMiles != null && venueLat != null && venueLng != null) {
        if (pLat == null || pLng == null) continue
        if (haversineMiles(pLat, pLng, venueLat, venueLng) > radiusMiles) continue
      }

      const gender = (p.gender as string | null) ?? null
      if (genderFilter && genderFilter.length > 0 && (!gender || !genderFilter.includes(gender))) continue

      const age = calcAge(p.birthdate as string | null)
      if (minAge != null && (age == null || age < minAge)) continue
      if (maxAge != null && (age == null || age > maxAge)) continue

      count++
    }

    // _debug is stripped in production (NODE_ENV=production) or can be ignored by the client
    const debug = process.env.NODE_ENV !== 'production'
      ? { rawCount, marketSlug, hasRadiusFilter: radiusMiles != null, hasGenderFilter: !!genderFilter?.length, hasAgeFilter: minAge != null || maxAge != null }
      : undefined

    return NextResponse.json({ count, ...(debug ? { _debug: debug } : {}) })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
