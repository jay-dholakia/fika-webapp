import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { isAdminByUserId } from '@/lib/admin-markets'
import { getMarketBySlug } from '@/lib/markets'

export const dynamic = 'force-dynamic'

/** GET /api/admin/signups — list signups (profiles with market) + dashboard by location. Admin only. */
export async function GET(request: Request) {
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

  const { searchParams } = new URL(request.url)
  const marketSlug = searchParams.get('market')?.trim() || null

  const signupsQuery = supabase
    .from('profiles')
    .select('id, first_name, city, market, created_at')
    .not('market', 'is', null)
    .order('created_at', { ascending: false })

  if (marketSlug) {
    signupsQuery.eq('market', marketSlug)
  }

  const { data: profiles, error: signupsError } = await signupsQuery

  if (signupsError) {
    return NextResponse.json({ error: signupsError.message }, { status: 500 })
  }

  const { data: markets } = await supabase
    .from('markets')
    .select('slug, label')
    .order('slug')

  const slugs = (markets ?? []).map((m) => m.slug).filter(Boolean)
  const countsBySlug: Record<string, number> = {}
  if (slugs.length > 0) {
    const { data: counts } = await supabase
      .from('profiles')
      .select('market')
      .in('market', slugs)
    const list = (counts ?? []) as { market: string | null }[]
    for (const row of list) {
      if (row.market) countsBySlug[row.market] = (countsBySlug[row.market] ?? 0) + 1
    }
  }

  const dashboard = (markets ?? []).map((m) => {
    const fromCode = getMarketBySlug(m.slug)
    return {
      slug: m.slug,
      label: fromCode?.label ?? m.label ?? m.slug,
      count: countsBySlug[m.slug] ?? 0,
    }
  })

  const signups = (profiles ?? []).map((p) => ({
    id: p.id,
    firstName: (p as { first_name?: string | null }).first_name ?? null,
    city: (p as { city?: string | null }).city ?? null,
    market: (p as { market?: string | null }).market ?? null,
    createdAt: (p as { created_at?: string }).created_at ?? null,
  }))

  return NextResponse.json({ signups, dashboard })
}
