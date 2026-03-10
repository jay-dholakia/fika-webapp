import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { isAdminByUserId } from '@/lib/admin-markets'
import { getMarketBySlug } from '@/lib/markets'
import { sendMessage } from '@/lib/sendblue'
import { messageMarketGoLive } from '@/lib/sms-agent'
import { getTimezoneFromLatLng, getNextMondayPhrase } from '@/lib/sms-day-aware'

export const dynamic = 'force-dynamic'

/** PATCH /api/admin/markets/[slug] — set market active on/off. Admin only (profiles.role = 'admin'). */
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

  let body: { active?: boolean }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const active = body?.active
  if (typeof active !== 'boolean') {
    return NextResponse.json({ error: 'active (boolean) required' }, { status: 400 })
  }

  const slugTrim = slug.trim()

  // Detect transition to active so we can send "Fika is live" to users in this market (once per user per market).
  let wasInactive = false
  if (active) {
    const { data: existing } = await supabase
      .from('markets')
      .select('active')
      .eq('slug', slugTrim)
      .maybeSingle()
    wasInactive = existing?.active !== true
  }

  const { error } = await supabase
    .from('markets')
    .update({ active, updated_at: new Date().toISOString() })
    .eq('slug', slugTrim)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // When turning market active, send "Fika is live" to all users in this market (no recording).
  if (active && wasInactive && process.env.SENDBLUE_API_KEY_ID) {
    const cityLabel = getMarketBySlug(slugTrim)?.label ?? slugTrim
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, phone, lat, lng')
      .eq('market', slugTrim)
      .not('phone', 'is', null)
    for (const p of profiles ?? []) {
      try {
        const timezone = getTimezoneFromLatLng((p as { lat?: number | null }).lat ?? null, (p as { lng?: number | null }).lng ?? null)
        const nextMondayPhrase = getNextMondayPhrase(timezone)
        const text = messageMarketGoLive(cityLabel, nextMondayPhrase)
        await sendMessage((p as { phone: string }).phone, text, { fromNumber: 'concierge' })
      } catch {
        // Continue with other users; don't fail the PATCH
      }
    }
  }

  return NextResponse.json({ ok: true, slug: slugTrim, active })
}
