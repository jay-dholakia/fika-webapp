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

/**
 * POST /api/admin/reddit/matches/[id]/approve
 * Sets status=approved, then calls the reddit-post-comment Edge Function server-side
 * so the browser never touches the Edge Function directly.
 */
export async function POST(
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

  // Mark approved
  const { data: match, error: updateErr } = await supabase
    .from('reddit_matches')
    .update({
      status: 'approved',
      reviewed_by: userId,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.id)
    .eq('status', 'pending_review') // idempotency guard
    .select()
    .maybeSingle()

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })
  if (!match) {
    return NextResponse.json({ error: 'Match not found or already processed' }, { status: 409 })
  }

  // Call the Edge Function server-side with service-role key
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: 'Server not configured' }, { status: 500 })
  }

  const fnRes = await fetch(
    `${supabaseUrl}/functions/v1/reddit-post-comment`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ matchId: params.id }),
    }
  )

  const fnData = await fnRes.json() as { ok?: boolean; commentId?: string; error?: string; detail?: string }
  if (!fnRes.ok || !fnData.ok) {
    return NextResponse.json(
      { error: fnData.error ?? 'Post failed', detail: fnData.detail },
      { status: 502 }
    )
  }

  return NextResponse.json({ ok: true, commentId: fnData.commentId })
}
