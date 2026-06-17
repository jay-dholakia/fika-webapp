import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { isAdminByUserId } from '@/lib/admin-markets'
import { adminSimCandidateFromProfileRow, computeAdminPairPayload } from '@/lib/match/admin-match-pair'

export const dynamic = 'force-dynamic'


async function getAdminSupabase(request: Request): Promise<SupabaseClient | null> {
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
  return supabase
}

/** POST /api/admin/weekly-events/[id]/run-matching
 *  Scores all yes-RSVP pairs by compatibility and creates match_candidates.
 *  Distance is ignored — both users have already committed to the event venue. */
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await getAdminSupabase(request)
    if (!supabase) return NextResponse.json({ error: 'Admin role required', code: 'NOT_ADMIN' }, { status: 403 })

    const eventId = params.id
    const { data: event } = await supabase
      .from('weekly_fika_events')
      .select('id, market_slug')
      .eq('id', eventId)
      .single()

    if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })

    // Yes RSVPs
    const { data: rsvps } = await supabase
      .from('weekly_rsvps')
      .select('user_id')
      .eq('event_id', eventId)
      .eq('decision', 'yes')

    const userIds: string[] = (rsvps ?? []).map((r: { user_id: string }) => r.user_id)
    if (userIds.length < 2) {
      return NextResponse.json({ ok: true, matched: 0, unmatched: userIds.length, reason: 'not_enough_rsvps' })
    }

    // Profiles + intake
    const [{ data: profileRows }, { data: intakeRows }] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, first_name, market, city, lat, lng, birthdate, gender, pronouns, gender_preference, age_preference, languages, is_active')
        .in('id', userIds),
      supabase
        .from('intake_responses_v5')
        .select('user_id, responses')
        .in('user_id', userIds),
    ])

    const intakeByUserId = new Map(
      (intakeRows ?? []).map((r: { user_id: string; responses: unknown }) => [r.user_id, r])
    )

    // Existing active pairs among these users (skip re-pairing)
    const { data: existingMatches } = await supabase
      .from('match_candidates')
      .select('user_a, user_b')
      .in('user_a', userIds)
      .in('user_b', userIds)
      .eq('status', 'active')

    const alreadyPaired = new Set<string>()
    for (const m of existingMatches ?? []) {
      alreadyPaired.add(m.user_a)
      alreadyPaired.add(m.user_b)
    }

    // Exclusions (avoid rematching previous pairs)
    const { data: exclusionRows } = await supabase
      .from('match_exclusions')
      .select('user_a, user_b')
      .or(userIds.map((id: string) => `user_a.eq.${id}`).join(','))

    const excludedPairs = new Set<string>()
    for (const ex of exclusionRows ?? []) {
      excludedPairs.add(`${ex.user_a}:${ex.user_b}`)
      excludedPairs.add(`${ex.user_b}:${ex.user_a}`)
    }

    // Build candidates
    const candidates = (profileRows ?? []).map((profile: Parameters<typeof adminSimCandidateFromProfileRow>[0]) => {
      const intake = intakeByUserId.get(profile.id) ?? { user_id: profile.id, responses: [] }
      return adminSimCandidateFromProfileRow(profile, intake as Parameters<typeof adminSimCandidateFromProfileRow>[1])
    })

    const candidateById = new Map(candidates.map(c => [c.profile.id, c]))
    const pool = userIds.filter(id => !alreadyPaired.has(id) && candidateById.has(id))

    // Score all valid pairs; distance is overridden to 1.0 (venue already committed)
    type ScoredPair = { a: string; b: string; score: number; reasons: Record<string, unknown> }
    const scoredPairs: ScoredPair[] = []
    let skippedIneligible = 0

    for (let i = 0; i < pool.length; i++) {
      for (let j = i + 1; j < pool.length; j++) {
        const aId = pool[i]!
        const bId = pool[j]!
        if (excludedPairs.has(`${aId}:${bId}`)) continue
        const ca = candidateById.get(aId)!
        const cb = candidateById.get(bId)!
        const payload = computeAdminPairPayload(ca, cb, { distanceOverride: 1.0 })
        if (!payload.breakdown.eligible) {
          skippedIneligible++
          continue
        }
        scoredPairs.push({ a: aId, b: bId, score: payload.score, reasons: payload.reasons })
      }
    }

    // Greedy assignment by descending score
    scoredPairs.sort((x, y) => y.score - x.score)

    const paired = new Set<string>()
    const newMatches: Array<{ user_a: string; user_b: string; score: number; reasons: Record<string, unknown> }> = []

    for (const pair of scoredPairs) {
      if (paired.has(pair.a) || paired.has(pair.b)) continue
      const ua = pair.a < pair.b ? pair.a : pair.b
      const ub = pair.a < pair.b ? pair.b : pair.a
      newMatches.push({ user_a: ua, user_b: ub, score: pair.score, reasons: pair.reasons })
      paired.add(pair.a)
      paired.add(pair.b)
    }

    const unmatched = pool.length - paired.size

    if (newMatches.length > 0) {
      const rows = newMatches.map(({ user_a, user_b, score, reasons }) => ({
        user_a,
        user_b,
        status: 'active',
        admin_approval_status: 'approved',
        score,
        reasons: { ...reasons, source: 'weekly_event', event_id: eventId },
      }))
      const { error } = await supabase.from('match_candidates').insert(rows)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, matched: newMatches.length, unmatched, skipped_ineligible: skippedIneligible })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
