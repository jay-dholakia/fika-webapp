import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { isAdminByUserId } from '@/lib/admin-markets'
import { getMarketBySlug } from '@/lib/markets'
import { venueCityLikelyInMarket } from '@/lib/fika-social-draft-options'

export const dynamic = 'force-dynamic'

const IANA_TIMEZONES: { value: string; label: string }[] = [
  { value: 'America/Los_Angeles', label: 'Pacific — Los Angeles' },
  { value: 'America/Denver', label: 'Mountain — Denver' },
  { value: 'America/Chicago', label: 'Central — Chicago' },
  { value: 'America/New_York', label: 'Eastern — New York' },
  { value: 'America/Phoenix', label: 'Arizona — Phoenix (no DST)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii' },
]

const RADIUS_PRESETS = [2, 3, 4, 5, 6, 8, 10, 12, 15]

async function getAdminSupabase(request: Request): Promise<SupabaseClient | null> {
  const supabaseAuth = await createServerSupabase()
  if (!supabaseAuth) return null

  let userId: string | null = null
  const {
    data: { session },
  } = await supabaseAuth.auth.getSession()
  if (session?.user?.id) userId = session.user.id
  if (!userId) {
    const authHeader = request.headers.get('Authorization')
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7)
      const {
        data: { user },
      } = await supabaseAuth.auth.getUser(token)
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

/**
 * GET /api/admin/fika-socials/draft-options
 * Optional ?market_slug= — filters venues by static city patterns when the slug exists in lib/markets.
 */
export async function GET(request: Request) {
  try {
    const supabase = await getAdminSupabase(request)
    if (!supabase) return NextResponse.json({ error: 'Admin role required', code: 'NOT_ADMIN' }, { status: 403 })

    const { searchParams } = new URL(request.url)
    const marketSlug = searchParams.get('market_slug')?.trim() ?? ''

    const { data: marketRows, error: mErr } = await supabase
      .from('markets')
      .select('slug, label, active, fika_socials_default_radius_miles')
      .order('label')

    if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 })

    const markets = (marketRows ?? []).map((row) => {
      const r = Number((row as { fika_socials_default_radius_miles?: number }).fika_socials_default_radius_miles)
      return {
        slug: row.slug as string,
        label: (row.label as string) ?? (row.slug as string),
        active: Boolean((row as { active?: boolean }).active),
        default_radius_miles: Number.isFinite(r) ? r : 4,
      }
    })

    let venues: Array<{
      id: string
      name: string
      neighborhood: string | null
      city: string
    }> = []

    let venues_note: string | null = null

    if (marketSlug) {
      const { data: venueRows, error: vErr } = await supabase
        .from('venues')
        .select('id, name, neighborhood, city, lat, lng, google_permanently_closed')
        .eq('google_permanently_closed', false)
        .not('lat', 'is', null)
        .not('lng', 'is', null)
        .order('city')
        .order('name')
        .limit(600)

      if (vErr) return NextResponse.json({ error: vErr.message }, { status: 500 })

      const mapped = (venueRows ?? []).map((v) => ({
        id: v.id as string,
        name: v.name as string,
        neighborhood: (v.neighborhood as string | null) ?? null,
        city: (v.city as string) ?? '',
      }))

      const patterns = getMarketBySlug(marketSlug)
      if (!patterns) {
        venues = mapped
        venues_note =
          'This market slug has no city-pattern map in app code; listing all venues with coordinates. Add patterns in lib/markets if you want a shorter list.'
      } else {
        venues = mapped.filter((v) => venueCityLikelyInMarket(v.city, marketSlug))
        if (venues.length === 0) {
          venues_note =
            'No venues matched this market’s city patterns. Check venue city strings in the database or extend patterns in lib/markets.'
        }
      }
    }

    const selectedDefaults = markets.find((m) => m.slug === marketSlug)

    return NextResponse.json({
      markets,
      venues,
      venues_note,
      iana_timezones: IANA_TIMEZONES,
      radius_presets: RADIUS_PRESETS,
      selected_market_default_radius:
        selectedDefaults != null ? selectedDefaults.default_radius_miles : null,
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to load draft options' },
      { status: 500 }
    )
  }
}
