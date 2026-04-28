import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { isAdminByUserId } from '@/lib/admin-markets'

export const dynamic = 'force-dynamic'

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

function isDuplicateKeyError(msg: string): boolean {
  return msg.includes('duplicate key') || msg.includes('23505')
}

/** GET /api/admin/venues — recent venues; optional ?q= search on name/city */
export async function GET(request: Request) {
  try {
    const supabase = await getAdminSupabase(request)
    if (!supabase) return NextResponse.json({ error: 'Admin role required', code: 'NOT_ADMIN' }, { status: 403 })

    const { searchParams } = new URL(request.url)
    const q = searchParams.get('q')?.trim() ?? ''
    const limit = Math.min(200, Math.max(10, Number(searchParams.get('limit') ?? '80') || 80))

    let query = supabase
      .from('venues')
      .select('id, name, neighborhood, city, address, lat, lng, google_place_id, google_permanently_closed, created_at')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (q.length >= 2) {
      const esc = q.replace(/,/g, ' ').replace(/%/g, '\\%').replace(/_/g, '\\_')
      query = query.or(`name.ilike.%${esc}%,city.ilike.%${esc}%`)
    }

    const { data, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ venues: data ?? [] })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to list venues' },
      { status: 500 }
    )
  }
}

/** POST /api/admin/venues — create venue (service role; RLS has no public insert). */
export async function POST(request: Request) {
  try {
    const supabase = await getAdminSupabase(request)
    if (!supabase) return NextResponse.json({ error: 'Admin role required', code: 'NOT_ADMIN' }, { status: 403 })

    const body = await request.json().catch(() => ({} as Record<string, unknown>))
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const city = typeof body.city === 'string' ? body.city.trim() : ''
    const neighborhood =
      typeof body.neighborhood === 'string' && body.neighborhood.trim() ? body.neighborhood.trim() : null
    const address =
      typeof body.address === 'string' && body.address.trim() ? body.address.trim() : null
    const googlePlaceId =
      typeof body.google_place_id === 'string' && body.google_place_id.trim()
        ? body.google_place_id.trim()
        : null

    const latRaw = body.lat
    const lngRaw = body.lng
    let lat: number | null = null
    let lng: number | null = null
    if (latRaw != null && latRaw !== '' && lngRaw != null && lngRaw !== '') {
      lat = Number(latRaw)
      lng = Number(lngRaw)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return NextResponse.json({ error: 'lat and lng must be valid numbers when provided' }, { status: 400 })
      }
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        return NextResponse.json({ error: 'lat/lng out of range' }, { status: 400 })
      }
    } else if (latRaw != null && latRaw !== '' || lngRaw != null && lngRaw !== '') {
      return NextResponse.json({ error: 'Provide both lat and lng, or leave both empty' }, { status: 400 })
    }

    if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })
    if (!city) return NextResponse.json({ error: 'city is required' }, { status: 400 })

    const insertRow = {
      name,
      city,
      neighborhood,
      address,
      lat,
      lng,
      google_place_id: googlePlaceId,
      google_permanently_closed: false,
    }

    const { data: row, error: insErr } = await supabase.from('venues').insert(insertRow).select('*').single()

    if (insErr) {
      const code = (insErr as { code?: string }).code
      if (code === '23505' || isDuplicateKeyError(insErr.message)) {
        return NextResponse.json(
          { error: 'Duplicate google_place_id or unique constraint.', code: 'DUPLICATE' },
          { status: 409 }
        )
      }
      return NextResponse.json({ error: insErr.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, venue: row })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to create venue' },
      { status: 500 }
    )
  }
}
