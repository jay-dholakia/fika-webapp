import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerSupabase } from '@/lib/supabase-server'
import { isAdminByUserId } from '@/lib/admin-markets'
import { getGoogleMapsApiKey, searchPlacesForAdminVenue } from '@/lib/google-places-venues'

export const dynamic = 'force-dynamic'

async function requireAdmin(request: Request) {
  const supabaseAuth = await createServerSupabase()
  if (!supabaseAuth) return { error: NextResponse.json({ error: 'Not configured' }, { status: 500 }) }

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
  if (!userId) return { error: NextResponse.json({ error: 'Not signed in', code: 'NO_SESSION' }, { status: 401 }) }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) return { error: NextResponse.json({ error: 'Server not configured' }, { status: 500 }) }
  const supabase = createClient(url, key)
  if (!(await isAdminByUserId(supabase, userId))) {
    return { error: NextResponse.json({ error: 'Admin role required', code: 'NOT_ADMIN' }, { status: 403 }) }
  }
  return { supabase }
}

/** POST { "q": "Blue Bottle Abbots Kinney" } — Places API (New) Text Search */
export async function POST(request: Request) {
  const auth = await requireAdmin(request)
  if ('error' in auth && auth.error) return auth.error

  if (!getGoogleMapsApiKey()) {
    return NextResponse.json(
      {
        error: 'GOOGLE_MAPS_API_KEY or NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is required for Places search.',
        code: 'NO_GOOGLE_KEY',
      },
      { status: 503 }
    )
  }

  const body = await request.json().catch(() => ({} as Record<string, unknown>))
  const q = typeof body.q === 'string' ? body.q.trim() : ''
  if (q.length < 2) {
    return NextResponse.json({ error: 'q must be at least 2 characters', code: 'BAD_REQUEST' }, { status: 400 })
  }

  const places = await searchPlacesForAdminVenue(q)

  return NextResponse.json({
    places: places.map((p) => ({
      place_id: p.placeId,
      name: p.name,
      formatted_address: p.formattedAddress,
      lat: p.lat,
      lng: p.lng,
      business_status: p.businessStatus ?? null,
    })),
  })
}
