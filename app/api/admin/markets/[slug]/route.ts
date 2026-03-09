import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { isAdminByUserId } from '@/lib/admin-markets'

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

  const { error } = await supabase
    .from('markets')
    .update({ active, updated_at: new Date().toISOString() })
    .eq('slug', slug.trim())
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, slug: slug.trim(), active })
}
