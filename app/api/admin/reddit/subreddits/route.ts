import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { isAdminByUserId } from '@/lib/admin-markets'

export const dynamic = 'force-dynamic'

async function getAdminSupabase(request: Request) {
  const supabaseAuth = await createServerSupabase()
  if (!supabaseAuth) return { userId: null, supabase: null }

  let userId: string | null = null
  const { data: { session } } = await supabaseAuth.auth.getSession()
  if (session?.user?.id) userId = session.user.id
  if (!userId) {
    const authHeader = request.headers.get('Authorization')
    if (authHeader?.startsWith('Bearer ')) {
      const { data: { user } } = await supabaseAuth.auth.getUser(authHeader.slice(7))
      if (user?.id) userId = user.id
    }
  }
  if (!userId) return { userId: null, supabase: null }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) return { userId: null, supabase: null }

  return { userId, supabase: createClient(url, key) }
}

/** GET /api/admin/reddit/subreddits — list all subreddits sorted by relevance_score desc */
export async function GET(request: Request) {
  const { userId, supabase } = await getAdminSupabase(request)
  if (!userId || !supabase) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  }
  if (!await isAdminByUserId(supabase, userId)) {
    return NextResponse.json({ error: 'Admin role required' }, { status: 403 })
  }

  const { data, error } = await supabase
    .from('reddit_subreddits')
    .select('*')
    .order('relevance_score', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ subreddits: data ?? [] })
}
