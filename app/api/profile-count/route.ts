import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const TARGET_COUNT = 250

// Ensure this route is never cached (always fresh count)
export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !serviceRoleKey) {
    console.log('[fika] profile-count:api', { error: 'missing-env', hasUrl: !!url, hasKey: !!serviceRoleKey })
    return NextResponse.json({ count: 0, target: TARGET_COUNT })
  }
  try {
    // Log which project we're hitting (host only, no secrets)
    const host = url.replace(/^https?:\/\//, '').split('/')[0] ?? ''
    const supabase = createClient(url, serviceRoleKey)
    // Select single column + count for accurate total (same as COUNT(*) in SQL)
    const { count, error } = await supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
    if (error) {
      console.log('[fika] profile-count:api', { error: error.message, host })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    const value = count ?? 0
    console.log('[fika] profile-count:api', { count: value, host })
    const res = NextResponse.json({ count: value, target: TARGET_COUNT })
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
