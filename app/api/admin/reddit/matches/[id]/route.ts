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

/** PATCH /api/admin/reddit/matches/[id] — save an edit or reject */
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const { userId, supabase } = await getAdminSupabase(request)
  if (!userId || !supabase) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  }
  if (!await isAdminByUserId(supabase, userId)) {
    return NextResponse.json({ error: 'Admin role required' }, { status: 403 })
  }

  const body = await request.json() as { edited_text?: string; status?: 'rejected' | 'pending_review' }
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (body.edited_text !== undefined) update.edited_text = body.edited_text
  if (body.status === 'rejected' || body.status === 'pending_review') {
    update.status = body.status
    update.reviewed_by = userId
    update.reviewed_at = new Date().toISOString()
  }

  const { data, error } = await supabase
    .from('reddit_matches')
    .update(update)
    .eq('id', params.id)
    .select()
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ match: data })
}
