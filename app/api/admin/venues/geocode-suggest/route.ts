import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerSupabase } from '@/lib/supabase-server'
import { isAdminByUserId } from '@/lib/admin-markets'
import { geocodeUsAddressLine } from '@/lib/geocode'

export const dynamic = 'force-dynamic'

/** POST /api/admin/venues/geocode-suggest — fill lat/lng from a single address line (Google Geocoding). Admin only. */
export async function POST(request: Request) {
  try {
    const supabaseAuth = await createServerSupabase()
    if (!supabaseAuth) return NextResponse.json({ error: 'Not configured' }, { status: 500 })

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
    if (!userId) return NextResponse.json({ error: 'Not signed in', code: 'NO_SESSION' }, { status: 401 })

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
    if (!url || !key) return NextResponse.json({ error: 'Server not configured' }, { status: 500 })
    const supabase = createClient(url, key)
    if (!(await isAdminByUserId(supabase, userId))) {
      return NextResponse.json({ error: 'Admin role required', code: 'NOT_ADMIN' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({} as Record<string, unknown>))
    let line = typeof body.query === 'string' ? body.query.trim() : ''
    if (!line) {
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      const neighborhood = typeof body.neighborhood === 'string' ? body.neighborhood.trim() : ''
      const addr = typeof body.address === 'string' ? body.address.trim() : ''
      const city = typeof body.city === 'string' ? body.city.trim() : ''
      line = [name, neighborhood, addr, city].filter(Boolean).join(', ')
    }
    if (!line) {
      return NextResponse.json({ error: 'Provide query or name/city fields to build an address.' }, { status: 400 })
    }

    const result = await geocodeUsAddressLine(line)
    if (!result) {
      return NextResponse.json(
        {
          error:
            'Could not geocode. Set GOOGLE_MAPS_API_KEY (or NEXT_PUBLIC_GOOGLE_MAPS_API_KEY) and try a fuller address.',
          code: 'GEOCODE_FAILED',
        },
        { status: 422 }
      )
    }

    return NextResponse.json({
      lat: result.lat,
      lng: result.lng,
      formatted_address: result.formatted_address ?? null,
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Geocode failed' },
      { status: 500 }
    )
  }
}
