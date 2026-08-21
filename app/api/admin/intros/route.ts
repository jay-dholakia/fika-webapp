import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { isAdminByUserId } from '@/lib/admin-markets'

export const dynamic = 'force-dynamic'

async function getAdminUserId(request: Request): Promise<string | null> {
  const supabaseAuth = await createServerSupabase()
  if (!supabaseAuth) return null
  const { data: { session } } = await supabaseAuth.auth.getSession()
  if (session?.user?.id) return session.user.id
  const authHeader = request.headers.get('Authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7)
    const { data: { user } } = await supabaseAuth.auth.getUser(token)
    return user?.id ?? null
  }
  return null
}

export async function GET(request: Request) {
  const userId = await getAdminUserId(request)
  if (!userId) return NextResponse.json({ error: 'Not signed in', code: 'NO_SESSION' }, { status: 401 })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) return NextResponse.json({ error: 'Server not configured' }, { status: 500 })
  const supabase = createClient(url, key)

  const isAdmin = await isAdminByUserId(supabase, userId)
  if (!isAdmin) return NextResponse.json({ error: 'Admin role required', code: 'NOT_ADMIN' }, { status: 403 })

  const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()

  const [{ data: activeMatches }, { data: completedMatches }] = await Promise.all([
    supabase
      .from('match_candidates')
      .select('id, user_a, user_b, reasons, status, created_at')
      .filter('reasons->>source', 'eq', '1v1')
      .in('status', ['active', 'scheduling_stalled'])
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('match_candidates')
      .select('id, user_a, user_b, reasons, status, created_at')
      .filter('reasons->>source', 'eq', '1v1')
      .eq('status', 'completed')
      .gte('created_at', sixtyDaysAgo)
      .order('created_at', { ascending: false })
      .limit(100),
  ])

  const allMatches = [
    ...((activeMatches ?? []) as Array<Record<string, unknown>>),
    ...((completedMatches ?? []) as Array<Record<string, unknown>>),
  ]
  const allMatchIds = allMatches.map((m) => m.id as string)
  const allUserIds = Array.from(
    new Set(allMatches.flatMap((m) => [m.user_a as string, m.user_b as string]).filter(Boolean))
  )

  const [{ data: smsStates }, { data: profiles }, { data: feedbackRows }] = await Promise.all([
    allMatchIds.length > 0
      ? supabase.from('sms_conversation_states').select('user_id, match_id, state').in('match_id', allMatchIds)
      : Promise.resolve({ data: [] as unknown[] }),
    allUserIds.length > 0
      ? supabase.from('profiles').select('id, first_name, market').in('id', allUserIds)
      : Promise.resolve({ data: [] as unknown[] }),
    allMatchIds.length > 0
      ? supabase
          .from('fika_feedback')
          .select('match_id, user_id, content, sentiment')
          .in('match_id', allMatchIds)
      : Promise.resolve({ data: [] as unknown[] }),
  ])

  const venueIds = Array.from(
    new Set(
      allMatches
        .map((m) => ((m.reasons as Record<string, unknown>)?.venue_id as string | undefined))
        .filter((x): x is string => !!x)
    )
  )
  const { data: venues } = venueIds.length > 0
    ? await supabase.from('venues').select('id, name, neighborhood').in('id', venueIds)
    : { data: [] as unknown[] }

  type Profile = { id: string; first_name: string | null; market: string | null }
  type Venue = { id: string; name: string; neighborhood: string | null }
  type SmsState = { match_id: string; user_id: string; state: string }
  type Feedback = { match_id: string; user_id: string; content: string; sentiment: string | null }

  const profileById = new Map<string, Profile>((profiles ?? []).map((p) => [(p as Profile).id, p as Profile]))
  const venueById = new Map<string, Venue>((venues ?? []).map((v) => [(v as Venue).id, v as Venue]))

  const smsStateMap = new Map<string, Map<string, string>>()
  for (const s of (smsStates ?? []) as SmsState[]) {
    if (!smsStateMap.has(s.match_id)) smsStateMap.set(s.match_id, new Map())
    smsStateMap.get(s.match_id)!.set(s.user_id, s.state)
  }

  const feedbackMap = new Map<string, Map<string, { content: string; sentiment: string | null }>>()
  for (const f of (feedbackRows ?? []) as Feedback[]) {
    if (!feedbackMap.has(f.match_id)) feedbackMap.set(f.match_id, new Map())
    feedbackMap.get(f.match_id)!.set(f.user_id, { content: f.content, sentiment: f.sentiment })
  }

  function buildRow(m: Record<string, unknown>) {
    const reasons = (m.reasons as Record<string, unknown>) ?? {}
    const venueId = reasons.venue_id as string | null
    const venue = venueId ? (venueById.get(venueId) ?? null) : null
    const profA = profileById.get(m.user_a as string)
    const profB = profileById.get(m.user_b as string)
    const states = smsStateMap.get(m.id as string) ?? new Map()
    const feedback = feedbackMap.get(m.id as string) ?? new Map()
    return {
      id: m.id as string,
      status: m.status as string,
      createdAt: m.created_at as string,
      userA: {
        id: m.user_a as string,
        name: profA?.first_name?.trim() || 'Unknown',
        market: profA?.market ?? null,
        smsState: states.get(m.user_a as string) ?? null,
        feedback: feedback.get(m.user_a as string) ?? null,
      },
      userB: {
        id: m.user_b as string,
        name: profB?.first_name?.trim() || 'Unknown',
        market: profB?.market ?? null,
        smsState: states.get(m.user_b as string) ?? null,
        feedback: feedback.get(m.user_b as string) ?? null,
      },
      venue: venue ? { name: venue.name, neighborhood: venue.neighborhood } : null,
      eventStartsAt: (reasons.event_starts_at as string) ?? null,
    }
  }

  return NextResponse.json({
    active: (activeMatches ?? []).map((m) => buildRow(m as Record<string, unknown>)),
    completed: (completedMatches ?? []).map((m) => buildRow(m as Record<string, unknown>)),
  })
}
