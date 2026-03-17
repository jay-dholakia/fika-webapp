import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { isAdminByUserId } from '@/lib/admin-markets'
import { getMarketPolygonsWithDb } from '@/lib/markets'

export const dynamic = 'force-dynamic'

/** GET /api/admin/map-data — profiles with lat/lng + market polygons for admin map. Admin only. */
export async function GET() {
  const supabaseAuth = await createServerSupabase()
  if (!supabaseAuth) {
    return NextResponse.json({ error: 'Not configured' }, { status: 500 })
  }
  let userId: string | null = null
  const { data: { session } } = await supabaseAuth.auth.getSession()
  if (session?.user?.id) userId = session.user.id
  if (!userId) {
    return NextResponse.json({ error: 'Not signed in', code: 'NO_SESSION' }, { status: 401 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) {
    return NextResponse.json({ error: 'Server not configured' }, { status: 500 })
  }
  const supabase = createClient(url, key)

  const isAdmin = await isAdminByUserId(supabase, userId)
  if (!isAdmin) {
    return NextResponse.json({ error: 'Admin role required', code: 'NOT_ADMIN' }, { status: 403 })
  }

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, first_name, city, market, lat, lng')
    .not('lat', 'is', null)
    .not('lng', 'is', null)

  const points = (profiles ?? []).map((p) => ({
    id: p.id,
    lat: p.lat as number,
    lng: p.lng as number,
    market: (p as { market?: string | null }).market ?? null,
    city: (p as { city?: string | null }).city ?? null,
    first_name: (p as { first_name?: string | null }).first_name ?? null,
  }))

  const polygons = await getMarketPolygonsWithDb(supabase)

  return NextResponse.json({ points, polygons })
}
