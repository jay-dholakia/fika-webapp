import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { TARGET_COUNT_PER_MARKET, getMarketBySlug } from '@/lib/markets'

// Ensure this route is never cached (always fresh count)
export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  const { searchParams } = new URL(request.url)
  const marketSlug = searchParams.get('market')?.trim() || null

  if (!url || !serviceRoleKey) {
    console.log('[fika] profile-count:api', { error: 'missing-env', hasUrl: !!url, hasKey: !!serviceRoleKey })
    return NextResponse.json({ count: 0, target: TARGET_COUNT_PER_MARKET, market: marketSlug })
  }
  try {
    const host = url.replace(/^https?:\/\//, '').split('/')[0] ?? ''
    const supabase = createClient(url, serviceRoleKey)

    let count: number
    if (marketSlug) {
      const { count: marketCount, error } = await supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('market', marketSlug)
      if (error) {
        console.log('[fika] profile-count:api', { error: error.message, host, market: marketSlug })
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      count = marketCount ?? 0
    } else {
      const { count: totalCount, error } = await supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
      if (error) {
        console.log('[fika] profile-count:api', { error: error.message, host })
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      count = totalCount ?? 0
    }

    const marketInfo = marketSlug ? getMarketBySlug(marketSlug) : null
    const label = marketInfo?.label ?? null

    let active: boolean | null = null
    if (marketSlug) {
      const { data: row } = await supabase.from('markets').select('active').eq('slug', marketSlug).maybeSingle()
      active = row?.active ?? false
    }

    console.log('[fika] profile-count:api', { count, market: marketSlug, host })
    const res = NextResponse.json({
      count,
      target: TARGET_COUNT_PER_MARKET,
      market: marketSlug,
      label,
      ...(marketSlug != null ? { active: active ?? false } : {}),
    })
    res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
    return res
  } catch (err) {
    console.log('[fika] profile-count:api', { error: err instanceof Error ? err.message : 'Profile count failed' })
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Profile count failed' },
      { status: 500 }
    )
  }
}
