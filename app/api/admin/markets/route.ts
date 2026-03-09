import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { isAdminByUserId } from '@/lib/admin-markets'
import { getMarketBySlug } from '@/lib/markets'

export const dynamic = 'force-dynamic'

/** GET /api/admin/markets — list markets with signup count and active status. Admin only (profiles.role = 'admin'). */
export async function GET() {
  const supabaseAuth = await createServerSupabase()
  if (!supabaseAuth) {
    return NextResponse.json({ error: 'Not configured' }, { status: 500 })
  }
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) {
    return NextResponse.json({ error: 'Server not configured' }, { status: 500 })
  }
  const supabase = createClient(url, key)

  const isAdmin = await isAdminByUserId(supabase, user.id)
  if (!isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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
