import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerSupabase } from '@/lib/supabase-server'
import { isAdminByUserId } from '@/lib/admin-markets'
import { fetchGooglePlaceAsVenueCandidate, upsertVenueFromGooglePlace } from '@/lib/google-places-venues'

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

/** POST { "place_id": "ChIJ..." } — Get Place from Google, upsert into venues */
export async function POST(request: Request) {
  const auth = await requireAdmin(request)
  if ('error' in auth && auth.error) return auth.error

  const body = await request.json().catch(() => ({} as Record<string, unknown>))
  const placeId =
    typeof body.place_id === 'string'
      ? body.place_id.trim()
      : typeof body.placeId === 'string'
        ? body.placeId.trim()
        : ''
  if (!placeId) {
    return NextResponse.json(
      { error: 'place_id or placeId is required', code: 'BAD_REQUEST' },
      { status: 400 }
    )
  }

  const candidate = await fetchGooglePlaceAsVenueCandidate(placeId)
  if (!candidate) {
    return NextResponse.json(
      {
        error: 'Could not load this place from Google Places. Check the place id and API key.',
        code: 'PLACE_FETCH_FAILED',
      },
      { status: 502 }
    )
  }

  const venue = await upsertVenueFromGooglePlace(auth.supabase, candidate)
  if (!venue) {
    return NextResponse.json(
      { error: 'Could not save venue', code: 'UPSERT_FAILED' },
      { status: 500 }
    )
  }

  return NextResponse.json({ venue })
}
