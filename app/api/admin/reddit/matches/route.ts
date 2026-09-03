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

/** GET /api/admin/reddit/matches?status=pending_review — list matches (newest first) */
export async function GET(request: Request) {
  const { userId, supabase } = await getAdminSupabase(request)
  if (!userId || !supabase) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  }
  if (!await isAdminByUserId(supabase, userId)) {
    return NextResponse.json({ error: 'Admin role required' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const statusFilter = searchParams.get('status')

  let query = supabase
    .from('reddit_matches')
    .select(`
      id, subreddit_id, reddit_post_id, title, url, author, body_snippet,
      matched_keywords, posted_at, discovered_at, draft_text, edited_text,
      model, status, reviewed_at, posted_comment_id, post_error,
      created_at, updated_at,
      reddit_subreddits (name)
    `)
    .order('created_at', { ascending: false })
    .limit(100)

  if (statusFilter) {
    query = query.eq('status', statusFilter)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ matches: data ?? [] })
}
