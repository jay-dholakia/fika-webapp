import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { isAdminByUserId } from '@/lib/admin-markets'
import { previewFikaSocialMatcher, type FikaSocialSessionRow } from '@/lib/fika-social-matcher'

export const dynamic = 'force-dynamic'

async function getAdminContext(request: Request): Promise<{ userId: string; supabase: SupabaseClient } | null> {
  const supabaseAuth = await createServerSupabase()
  if (!supabaseAuth) return null

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
  if (!userId) return null

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) throw new Error('Server not configured')
  const supabase = createClient(url, key)

  const admin = await isAdminByUserId(supabase, userId)
  if (!admin) return null
  return { userId, supabase }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim())
}

/**
 * GET /api/admin/fika-socials/[sessionId]/match-preview
 * Dry-run preview of greedy adjacency pairing, with score + eligibility.
 */
export async function GET(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const context = await getAdminContext(request)
    if (!context) return NextResponse.json({ error: 'Admin role required', code: 'NOT_ADMIN' }, { status: 403 })

    const { sessionId } = await params
    if (!sessionId || !isUuid(sessionId)) {
      return NextResponse.json({ error: 'Invalid session id' }, { status: 400 })
    }

    const { data: session, error: sErr } = await context.supabase
      .from('fika_socials')
      .select('id, market_slug, venue_id, week_anchor_monday, radius_miles, iana_tz, fika_starts_at, status')
      .eq('id', sessionId)
      .maybeSingle()
    if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 })
    if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const row: FikaSocialSessionRow = {
      id: sessionId,
      market_slug: session.market_slug as string,
      venue_id: session.venue_id as string,
      week_anchor_monday: session.week_anchor_monday as string,
      radius_miles: Number(session.radius_miles),
      iana_tz: (session.iana_tz as string) || 'America/Los_Angeles',
      fika_starts_at: session.fika_starts_at as string,
      status: session.status as string,
    }

    const result = await previewFikaSocialMatcher(context.supabase, row)
    if (!result.ok) {
      return NextResponse.json({ error: result.error, code: result.code }, { status: 400 })
    }

    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to preview matches' },
      { status: 500 }
    )
  }
}

