import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { userBlockedFromNewIntro } from '@/lib/intro-eligibility'

export const dynamic = 'force-dynamic'

async function getSessionUserId(request: Request): Promise<string | null> {
  const supabaseAuth = await createServerSupabase()
  if (!supabaseAuth) return null
  const {
    data: { session },
  } = await supabaseAuth.auth.getSession()
  if (session?.user?.id) return session.user.id
  const authHeader = request.headers.get('Authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7)
    const {
      data: { user },
    } = await supabaseAuth.auth.getUser(token)
    return user?.id ?? null
  }
  return null
}

/** POST /api/fika-socials/opt-in — authenticated user opts in to a published session (service_role insert). */
export async function POST(request: Request) {
  const userId = await getSessionUserId(request)
  if (!userId) {
    return NextResponse.json({ error: 'Not signed in', code: 'NO_SESSION' }, { status: 401 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) {
    return NextResponse.json({ error: 'Server not configured' }, { status: 500 })
  }

  const body = await request.json().catch(() => ({} as Record<string, unknown>))
  const sessionId = typeof body.session_id === 'string' ? body.session_id.trim() : ''
  if (!sessionId) {
    return NextResponse.json({ error: 'session_id required', code: 'BAD_REQUEST' }, { status: 400 })
  }

  const supabase = createClient(url, key)

  if (await userBlockedFromNewIntro(supabase, userId)) {
    return NextResponse.json(
      {
        error:
          'You cannot opt in while you have an upcoming confirmed Fika or an active intro offer in its 24-hour window.',
        code: 'BLOCKED_FROM_NEW_INTRO',
      },
      { status: 409 }
    )
  }

  const { data: sessionRow, error: sessErr } = await supabase
    .from('fika_socials')
    .select('id, status, opt_in_closes_at')
    .eq('id', sessionId)
    .maybeSingle()

  if (sessErr) {
    return NextResponse.json({ error: sessErr.message }, { status: 500 })
  }
  if (!sessionRow) {
    return NextResponse.json({ error: 'Session not found', code: 'NOT_FOUND' }, { status: 404 })
  }

  if ((sessionRow as { status?: string }).status !== 'open_opt_in') {
    return NextResponse.json(
      { error: 'Session is not accepting opt-ins.', code: 'SESSION_NOT_OPEN' },
      { status: 400 }
    )
  }

  const closesAtRaw = (sessionRow as { opt_in_closes_at?: string | null }).opt_in_closes_at
  if (closesAtRaw) {
    const t = new Date(closesAtRaw).getTime()
    if (Number.isFinite(t) && Date.now() >= t) {
      return NextResponse.json(
        { error: 'Opt-in window has closed for this session.', code: 'OPT_IN_CLOSED' },
        { status: 400 }
      )
    }
  }

  const { data: inserted, error: insErr } = await supabase
    .from('fika_social_opt_ins')
    .upsert(
      {
        session_id: sessionId,
        user_id: userId,
        withdrawn_at: null,
      },
      { onConflict: 'session_id,user_id' }
    )
    .select('id')
    .maybeSingle()

  if (insErr) {
    if (insErr.code === '23505') {
      return NextResponse.json(
        {
          error: 'You already have a session opt-in for this week. Withdraw from that session first if you want to switch.',
          code: 'OPT_IN_WEEK_CONFLICT',
        },
        { status: 409 }
      )
    }
    return NextResponse.json({ error: insErr.message, code: 'OPT_IN_UPSERT' }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    opt_in_id: inserted?.id ?? null,
  })
}
