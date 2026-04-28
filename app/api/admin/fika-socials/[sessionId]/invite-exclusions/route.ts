import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { isAdminByUserId } from '@/lib/admin-markets'

export const dynamic = 'force-dynamic'

async function getAdminContext(request: Request): Promise<{ supabase: SupabaseClient } | null> {
  const supabaseAuth = await createServerSupabase()
  if (!supabaseAuth) return null

  let userId: string | null = null
  const {
    data: { session },
  } = await supabaseAuth.auth.getSession()
  if (session?.user?.id) userId = session.user.id
  if (!userId) {
    const authHeader = request.headers.get('Authorization')
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7)
      const {
        data: { user },
      } = await supabaseAuth.auth.getUser(token)
      if (user?.id) userId = user.id
    }
  }
  if (!userId) return null

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) throw new Error('Server not configured')
  const supabase = createClient(url, key)

  const admin = await isAdminByUserId(supabase, userId)
  if (!admin) return null
  return { supabase }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim())
}

export async function GET(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const context = await getAdminContext(request)
    if (!context) return NextResponse.json({ error: 'Admin role required', code: 'NOT_ADMIN' }, { status: 403 })

    const { sessionId } = await params
    if (!sessionId || !isUuid(sessionId)) {
      return NextResponse.json({ error: 'Invalid session id' }, { status: 400 })
    }

    const { data: rows, error } = await context.supabase
      .from('fika_social_invite_exclusions')
      .select('user_id')
      .eq('session_id', sessionId)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    const excluded_user_ids = (rows ?? []).map((r: { user_id: string }) => r.user_id)
    return NextResponse.json({ excluded_user_ids })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to load exclusions' },
      { status: 500 }
    )
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const context = await getAdminContext(request)
    if (!context) return NextResponse.json({ error: 'Admin role required', code: 'NOT_ADMIN' }, { status: 403 })

    const { sessionId } = await params
    if (!sessionId || !isUuid(sessionId)) {
      return NextResponse.json({ error: 'Invalid session id' }, { status: 400 })
    }

    const body = await request.json().catch(() => ({} as Record<string, unknown>))
    const raw = Array.isArray(body.excluded_user_ids) ? (body.excluded_user_ids as unknown[]) : []
    const excluded = Array.from(
      new Set(raw.filter((x): x is string => typeof x === 'string' && isUuid(x)).map((s) => s.trim()))
    )

    const { error: delErr } = await context.supabase
      .from('fika_social_invite_exclusions')
      .delete()
      .eq('session_id', sessionId)

    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })

    if (excluded.length > 0) {
      const { error: insErr } = await context.supabase
        .from('fika_social_invite_exclusions')
        .insert(excluded.map((user_id) => ({ session_id: sessionId, user_id })))
      if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, excluded_user_ids: excluded })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to save exclusions' },
      { status: 500 }
    )
  }
}

