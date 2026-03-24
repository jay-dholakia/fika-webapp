import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { isAdminByUserId } from '@/lib/admin-markets'

export const dynamic = 'force-dynamic'

/** GeoJSON Polygon: { type: 'Polygon', coordinates: [ [ [lng, lat], ... ] ] }. */
function isGeoJsonPolygon(v: unknown): v is { type: 'Polygon'; coordinates: [number, number][][] } {
  if (v == null || typeof v !== 'object') return false
  const o = v as { type?: string; coordinates?: unknown }
  if (o.type !== 'Polygon' || !Array.isArray(o.coordinates) || o.coordinates.length === 0) return false
  const ring = o.coordinates[0]
  return Array.isArray(ring) && ring.every((p) => Array.isArray(p) && p.length >= 2 && typeof p[0] === 'number' && typeof p[1] === 'number')
}

/** PATCH /api/admin/markets/[slug] — set market active and/or boundary. Admin only. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const supabaseAuth = await createServerSupabase()
  if (!supabaseAuth) {
    return NextResponse.json({ error: 'Not configured' }, { status: 500 })
  }
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

  const { slug } = await params
  if (!slug?.trim()) {
    return NextResponse.json({ error: 'slug required' }, { status: 400 })
  }

  let body: { active?: boolean; boundary?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const active = body?.active
  const boundary = body?.boundary
  const hasActive = typeof active === 'boolean'
  const hasBoundary = boundary !== undefined
  if (!hasActive && !hasBoundary) {
    return NextResponse.json({ error: 'Send active (boolean) and/or boundary (GeoJSON Polygon)' }, { status: 400 })
  }
  if (hasBoundary && !isGeoJsonPolygon(boundary)) {
    return NextResponse.json({ error: 'boundary must be a GeoJSON Polygon: { type: "Polygon", coordinates: [ [ [lng, lat], ... ] ] }' }, { status: 400 })
  }

  const slugTrim = slug.trim()

  const updatePayload: { active?: boolean; boundary?: unknown; updated_at: string } = {
    updated_at: new Date().toISOString(),
  }
  if (hasActive) updatePayload.active = active
  if (hasBoundary) updatePayload.boundary = boundary

  const { error } = await supabase
    .from('markets')
    .update(updatePayload)
    .eq('slug', slugTrim)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    slug: slugTrim,
    ...(hasActive && { active }),
    ...(hasBoundary && { boundary: true }),
  })
}
