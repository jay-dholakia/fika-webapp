import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { isAdminByUserId } from '@/lib/admin-markets'
import { getMarketBySlug } from '@/lib/markets'

export const dynamic = 'force-dynamic'

/** GET /api/admin/markets — list markets with signup count and active status. Admin only (profiles.role = 'admin'). */
export async function GET(request: Request) {
  const supabaseAuth = await createServerSupabase()
  if (!supabaseAuth) {
    return NextResponse.json({ error: 'Not configured' }, { status: 500 })
  }
  let userId: string | null = null
  const { data: { session } } = await supabaseAuth.auth.getSession()
  if (session?.user?.id) {
    userId = session.user.id
  }
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

  const { data: markets, error: marketsError } = await supabase
    .from('markets')
    .select('slug, label, active, created_at, updated_at')
    .order('slug')
  if (marketsError) {
    return NextResponse.json({ error: marketsError.message }, { status: 500 })
  }

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

  const list = (markets ?? []).map((m) => {
    const fromCode = getMarketBySlug(m.slug)
    return {
      slug: m.slug,
      label: fromCode?.label ?? m.label ?? m.slug,
      active: !!m.active,
      signupCount: countsBySlug[m.slug] ?? 0,
      createdAt: m.created_at,
      updatedAt: m.updated_at,
    }
  })

  return NextResponse.json({ markets: list })
}
