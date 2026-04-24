import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { isAdminByUserId } from '@/lib/admin-markets'
import { getIntakeAnswer, getIntakeSingle } from '@/lib/intake-response-utils'
import type { FikaMatchBreakdown } from '@/lib/match/fika-matcher'
import {
  ADMIN_MATCH_PROFILE_SELECT,
  type AdminCopyDimensionKey,
  type AdminMatchIntakeRow,
  type AdminMatchProfileRow,
  type AdminSimCandidate,
  adminSimCandidateFromProfileRow,
  computeAdminPairPayload,
  loadAdminSimCandidatesForCanonicalPair,
} from '@/lib/match/admin-match-pair'
import { MATCH_SCORING_VERSION } from '@/lib/match/weights'
import { fetchUserIdsWithUpcomingConfirmedFika } from '@/lib/upcoming-confirmed-fika'

/** Admin simulation: config-driven structured matcher (eligibility + feasibility + compatibility). */
export const dynamic = 'force-dynamic'

type ProfileRow = AdminMatchProfileRow
type IntakeRow = AdminMatchIntakeRow
type SimCandidate = AdminSimCandidate

type CompareRow = {
  label: string
  a: string
  b: string
}

type SelectedPairInput = {
  userAId: string
  userBId: string
  score?: number
  reasons?: Record<string, unknown>
}

type CopyDimensionKey = AdminCopyDimensionKey

function getResponseValue(intake: IntakeRow, questionId: string): unknown {
  return getIntakeAnswer(intake.responses, questionId)
}

function asDisplay(value: unknown): string {
  if (value == null) return '—'
  if (Array.isArray(value)) {
    const items = value
      .map((x) => String(x).trim())
      .filter(Boolean)
    return items.length ? items.join(', ') : '—'
  }
  const text = String(value).trim()
  return text || '—'
}

function buildComparisonRows(a: SimCandidate, b: SimCandidate): CompareRow[] {
  return [
    { label: 'Time in area', a: asDisplay(getResponseValue(a.intake, 'q_market_tenure')), b: asDisplay(getResponseValue(b.intake, 'q_market_tenure')) },
    { label: 'Ethnicity', a: asDisplay(getResponseValue(a.intake, 'q_ethnicity')), b: asDisplay(getResponseValue(b.intake, 'q_ethnicity')) },
    { label: 'Relationship', a: asDisplay(getResponseValue(a.intake, 'q_relationship_status')), b: asDisplay(getResponseValue(b.intake, 'q_relationship_status')) },
    { label: 'Work', a: asDisplay(getResponseValue(a.intake, 'q_work')), b: asDisplay(getResponseValue(b.intake, 'q_work')) },
    { label: 'Interests', a: asDisplay(getResponseValue(a.intake, 'q_interests')), b: asDisplay(getResponseValue(b.intake, 'q_interests')) },
    { label: 'Fika talk topics', a: asDisplay(getResponseValue(a.intake, 'q_like_talking_about')), b: asDisplay(getResponseValue(b.intake, 'q_like_talking_about')) },
    { label: 'Travel radius', a: asDisplay(getResponseValue(a.intake, 'q_radius')), b: asDisplay(getResponseValue(b.intake, 'q_radius')) },
    { label: 'Typical Fika times', a: asDisplay(getResponseValue(a.intake, 'q_typical_fika_times')), b: asDisplay(getResponseValue(b.intake, 'q_typical_fika_times')) },
    { label: 'Safety confirm', a: asDisplay(getResponseValue(a.intake, 'confirm_intent')), b: asDisplay(getResponseValue(b.intake, 'confirm_intent')) },
    { label: 'Languages', a: asDisplay(a.profile.languages), b: asDisplay(b.profile.languages) },
    { label: 'Pronouns (pairing)', a: asDisplay(a.profile.pronouns ?? a.profile.gender), b: asDisplay(b.profile.pronouns ?? b.profile.gender) },
    { label: 'Age', a: a.age != null ? String(a.age) : '—', b: b.age != null ? String(b.age) : '—' },
  ]
}

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

/**
 * Insert or update a match_candidate for admin trigger_sms.
 * Handles 23505 when a row already exists: unique may be (user_a, user_b, week_anchor_monday)
 * or only (user_a, user_b). Updating by week alone can match 0 rows → PostgREST PGRST116 on .single().
 */
async function insertOrUpdateMatchCandidateForTrigger(
  supabase: SupabaseClient,
  params: {
    userA: string
    userB: string
    weekAnchorMonday: string
    expiresAt: string
    score: number
    reasons: Record<string, unknown>
  }
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { userA, userB, weekAnchorMonday, expiresAt, score, reasons } = params

  const { data: inserted, error: insertErr } = await supabase
    .from('match_candidates')
    .insert({
      user_a: userA,
      user_b: userB,
      score,
      reasons,
      status: 'active',
      week_anchor_monday: weekAnchorMonday,
      expires_at: expiresAt,
    })
    .select('id')
    .maybeSingle()

  if (!insertErr && inserted?.id) return { ok: true, id: inserted.id as string }

  if (insertErr?.code !== '23505') {
    return { ok: false, error: insertErr?.message ?? 'insert failed' }
  }

  const { data: sameWeekRows } = await supabase
    .from('match_candidates')
    .select('id')
    .eq('user_a', userA)
    .eq('user_b', userB)
    .eq('week_anchor_monday', weekAnchorMonday)
    .limit(2)

  const sameWeekId = sameWeekRows?.[0]?.id as string | undefined
  if (sameWeekId) {
    const { data: updated, error: updateErr } = await supabase
      .from('match_candidates')
      .update({
        score,
        reasons,
        expires_at: expiresAt,
      })
      .eq('id', sameWeekId)
      .select('id')
      .maybeSingle()
    if (updateErr) return { ok: false, error: updateErr.message }
    if (updated?.id) return { ok: true, id: updated.id as string }
    return { ok: false, error: 'update by id returned no row' }
  }

  const { data: pairRows } = await supabase
    .from('match_candidates')
    .select('id')
    .eq('user_a', userA)
    .eq('user_b', userB)
    .order('week_anchor_monday', { ascending: false })
    .limit(1)

  const pairId = pairRows?.[0]?.id as string | undefined
  if (!pairId) {
    return { ok: false, error: 'duplicate insert but no existing row for this pair' }
  }

  const { data: updatedPair, error: updatePairErr } = await supabase
    .from('match_candidates')
    .update({
      score,
      reasons,
      expires_at: expiresAt,
      week_anchor_monday: weekAnchorMonday,
      status: 'active',
    })
    .eq('id', pairId)
    .select('id')
    .maybeSingle()

  if (updatePairErr) return { ok: false, error: updatePairErr.message }
  if (updatedPair?.id) return { ok: true, id: updatedPair.id as string }
  return { ok: false, error: 'update pair row returned no row' }
}

function getWeekAnchorMonday(now: Date): string {
  const monday = new Date(now)
  const day = monday.getUTCDay()
  const diffToMonday = (day + 6) % 7
  monday.setUTCDate(monday.getUTCDate() - diffToMonday)
  monday.setUTCHours(0, 0, 0, 0)
  return monday.toISOString().split('T')[0]
}

function getExpiresAtWednesdayMidnightUtc(weekAnchorMonday: string): string {
  const d = new Date(`${weekAnchorMonday}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + 2)
  return d.toISOString()
}

export async function POST(request: Request) {
  const userId = await getAdminUserId(request)
  if (!userId) return NextResponse.json({ error: 'Not signed in', code: 'NO_SESSION' }, { status: 401 })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) return NextResponse.json({ error: 'Server not configured' }, { status: 500 })
  const supabase = createClient(url, key)

  const isAdmin = await isAdminByUserId(supabase, userId)
  if (!isAdmin) return NextResponse.json({ error: 'Admin role required', code: 'NOT_ADMIN' }, { status: 403 })

  const body = await request.json().catch(() => ({} as Record<string, unknown>))
  const action = typeof body.action === 'string' ? body.action : 'simulate'

  if (action === 'trigger_sms') {
    const selectedPairsRaw = Array.isArray(body.selectedPairs) ? body.selectedPairs as unknown[] : []
    const selectedPairs: SelectedPairInput[] = selectedPairsRaw
      .filter((p): p is SelectedPairInput => {
        const v = p as SelectedPairInput
        return (
          typeof v?.userAId === 'string' &&
          v.userAId.trim().length > 0 &&
          typeof v?.userBId === 'string' &&
          v.userBId.trim().length > 0
        )
      })

    const blockedUpcoming = await fetchUserIdsWithUpcomingConfirmedFika(supabase)
    if (selectedPairs.length > 0) {
      for (const pair of selectedPairs) {
        const userA = pair.userAId < pair.userBId ? pair.userAId : pair.userBId
        const userB = pair.userAId < pair.userBId ? pair.userBId : pair.userAId
        if (blockedUpcoming.has(userA) || blockedUpcoming.has(userB)) {
          const blockedIds = [userA, userB].filter((id) => blockedUpcoming.has(id))
          return NextResponse.json(
            {
              error:
                'One or both users have a confirmed Fika that has not happened yet. They cannot receive a new intro until after that Fika.',
              code: 'BLOCKED_UPCOMING_CONFIRMED',
              blockedUserIds: blockedIds,
            },
            { status: 400 }
          )
        }
      }
    }

    const weekAnchorMonday = getWeekAnchorMonday(new Date())
    let targetMatchIds: string[] | null = null

    if (selectedPairs.length > 0) {
      const expiresAt = getExpiresAtWednesdayMidnightUtc(weekAnchorMonday)
      const createdIds: string[] = []
      for (const pair of selectedPairs) {
        const userA = pair.userAId < pair.userBId ? pair.userAId : pair.userBId
        const userB = pair.userAId < pair.userBId ? pair.userBId : pair.userAId

        const loaded = await loadAdminSimCandidatesForCanonicalPair(supabase, userA, userB)
        if ('error' in loaded) {
          return NextResponse.json(
            { error: loaded.error, code: 'INTRO_PAIR_LOAD' },
            { status: 400 }
          )
        }
        const payload = computeAdminPairPayload(loaded.ca, loaded.cb)
        if (!payload.breakdown.eligible) {
          return NextResponse.json(
            {
              error:
                'This pair does not pass intro matcher eligibility (geography, languages when both set, same pronoun group, platonic confirm). Pick another pair or fix profile/intake gaps.',
              code: 'PAIR_NOT_INTRO_ELIGIBLE',
              rejectReasons: payload.breakdown.rejectReasons,
            },
            { status: 400 }
          )
        }

        const result = await insertOrUpdateMatchCandidateForTrigger(supabase, {
          userA,
          userB,
          weekAnchorMonday,
          expiresAt,
          score: payload.score,
          reasons: payload.reasons,
        })
        if (!result.ok) {
          return NextResponse.json({ error: result.error, code: 'MATCH_CANDIDATE_UPSERT' }, { status: 500 })
        }
        createdIds.push(result.id)
      }
      targetMatchIds = createdIds
    }

    const fnUrl = `${url}/functions/v1/sms-match-delivery`
    const res = await fetch(fnUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(
        targetMatchIds && targetMatchIds.length > 0
          ? { match_ids: targetMatchIds }
          : {}
      ),
    })
    const raw = await res.text()
    return NextResponse.json({
      ok: res.ok,
      status: res.status,
      response: raw,
      targeted_matches: targetMatchIds?.length ?? 0,
    }, { status: res.ok ? 200 : 500 })
  }

  const market = typeof body.market === 'string' ? body.market.trim() : null
  const optedInOnly = body.optedInOnly === true
  const maxUsers = Math.min(300, Math.max(20, typeof body.maxUsers === 'number' ? Math.floor(body.maxUsers) : 120))
  const topN = Math.min(300, Math.max(10, typeof body.topN === 'number' ? Math.floor(body.topN) : 100))

  const logMatrix =
    process.env.NODE_ENV === 'development'
      ? (msg: string) => {
          console.debug(msg)
        }
      : undefined

  const { data: activeMarkets } = await supabase.from('markets').select('slug').eq('active', true)
  const activeSlugs = (activeMarkets ?? []).map((m: { slug: string }) => m.slug)
  let candidateIds: string[] | null = null

  if (optedInOnly) {
    const weekAnchorMonday = getWeekAnchorMonday(new Date())
    const { data: optIns } = await supabase
      .from('weekly_match_opt_ins')
      .select('user_id')
      .eq('week_anchor_monday', weekAnchorMonday)
    candidateIds = (optIns ?? []).map((x: { user_id: string }) => x.user_id)
  }

  let profilesQuery = supabase.from('profiles').select(ADMIN_MATCH_PROFILE_SELECT)
    .eq('in_match_bowl', true)
    .eq('is_active', true)
    .limit(maxUsers)

  if (activeSlugs.length > 0) profilesQuery = profilesQuery.in('market', activeSlugs)
  if (market) profilesQuery = profilesQuery.eq('market', market)
  if (candidateIds && candidateIds.length > 0) profilesQuery = profilesQuery.in('id', candidateIds)

  const { data: profiles, error: profilesErr } = await profilesQuery
  if (profilesErr) return NextResponse.json({ error: profilesErr.message }, { status: 500 })

  const userProfiles = (profiles ?? []) as ProfileRow[]
  const blockedUpcoming = await fetchUserIdsWithUpcomingConfirmedFika(supabase)
  const usersSkippedUpcomingConfirmed = userProfiles.filter((p) => blockedUpcoming.has(p.id)).length
  const filteredProfiles = userProfiles.filter((p) => !blockedUpcoming.has(p.id))
  const ids = filteredProfiles.map((p) => p.id)
  if (ids.length < 2) {
    return NextResponse.json({
      summary: {
        totalProfiles: userProfiles.length,
        usersConsidered: 0,
        usersSkippedNoIntake: 0,
        usersSkippedNoEmbedding: 0,
        usersSkippedUpcomingConfirmed,
        pairsScored: 0,
        filteredOut: 0,
        optedInOnly,
        market,
        scoring: MATCH_SCORING_VERSION,
      },
      pairs: [],
    })
  }

  const { data: intakeRows, error: intakeErr } = await supabase
    .from('intake_responses_v5')
    .select('user_id, responses')
    .in('user_id', ids)
  if (intakeErr) return NextResponse.json({ error: intakeErr.message }, { status: 500 })
  const intakeById = new Map<string, IntakeRow>()
  for (const r of (intakeRows ?? []) as IntakeRow[]) intakeById.set(r.user_id, r)

  let usersSkippedNoIntake = 0
  const candidates: SimCandidate[] = []
  for (const p of filteredProfiles) {
    const intake = intakeById.get(p.id)
    if (!intake) {
      usersSkippedNoIntake++
      continue
    }
    candidates.push(adminSimCandidateFromProfileRow(p, intake))
  }

  if (candidates.length < 2) {
    return NextResponse.json({
      summary: {
        totalProfiles: userProfiles.length,
        usersConsidered: candidates.length,
        usersSkippedNoIntake,
        usersSkippedNoEmbedding: 0,
        usersSkippedUpcomingConfirmed,
        pairsScored: 0,
        filteredOut: 0,
        optedInOnly,
        market,
        scoring: MATCH_SCORING_VERSION,
      },
      pairs: [],
    })
  }

  let filteredOut = 0
  const pairs: Array<{
    userAId: string
    userAName: string
    userAAge: number | null
    userAGender: string | null
    userAPronouns: string | null
    userAWorkLabel: string | null
    userACity: string | null
    userBId: string
    userBName: string
    userBAge: number | null
    userBGender: string | null
    userBPronouns: string | null
    userBWorkLabel: string | null
    userBCity: string | null
    score: number
    distanceKm: number | null
    sharedLanguages: string[]
    likeTalkingAboutA: string | null
    likeTalkingAboutB: string | null
    overlapGreatFika: string[]
    overlapLikeTalkingAbout: string[]
    overlapInterests: string[]
    overlapCuriosity: string[]
    overlapLifeChapter: string[]
    overlapEverydayAnchor: string[]
    textureOverlap: string[]
    topCopyDimensions: CopyDimensionKey[]
    compareRows: CompareRow[]
    sectionScores: Record<string, number>
    matchBreakdown: FikaMatchBreakdown
  }> = []

  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const ca = candidates[i]
      const cb = candidates[j]
      const scoreOpts = logMatrix ? { logMatrixUnknown: logMatrix } : undefined
      const p = computeAdminPairPayload(ca, cb, scoreOpts)
      if (!p.breakdown.eligible) {
        filteredOut++
        continue
      }
      const compareRows = buildComparisonRows(ca, cb)
      const userAWorkLabel = getIntakeSingle(ca.intake.responses, 'q_work')
      const userBWorkLabel = getIntakeSingle(cb.intake.responses, 'q_work')
      pairs.push({
        userAId: ca.profile.id,
        userAName: ca.profile.first_name?.trim() || 'Unknown',
        userAAge: ca.age,
        userAGender: ca.profile.gender ?? null,
        userAPronouns: ca.profile.pronouns ?? null,
        userAWorkLabel,
        userACity: ca.profile.city ?? null,
        userBId: cb.profile.id,
        userBName: cb.profile.first_name?.trim() || 'Unknown',
        userBAge: cb.age,
        userBGender: cb.profile.gender ?? null,
        userBPronouns: cb.profile.pronouns ?? null,
        userBWorkLabel,
        userBCity: cb.profile.city ?? null,
        score: p.score,
        distanceKm: p.distanceKm,
        sharedLanguages: p.sharedLanguages,
        likeTalkingAboutA: p.likeTalkingAboutA,
        likeTalkingAboutB: p.likeTalkingAboutB,
        overlapGreatFika: p.overlapGreatFika,
        overlapLikeTalkingAbout: p.overlapLikeTalkingAbout,
        overlapInterests: p.overlapInterests,
        overlapCuriosity: p.overlapCuriosity,
        overlapLifeChapter: p.overlapLifeChapter,
        overlapEverydayAnchor: p.overlapEverydayAnchor,
        textureOverlap: p.textureOverlap,
        topCopyDimensions: p.topCopyDimensions,
        compareRows,
        sectionScores: p.sectionScores,
        matchBreakdown: p.breakdown,
      })
    }
  }

  pairs.sort((a, b) => b.score - a.score)
  const top = pairs.slice(0, topN)

  return NextResponse.json({
    summary: {
      totalProfiles: userProfiles.length,
      usersConsidered: candidates.length,
      usersSkippedNoIntake,
      usersSkippedNoEmbedding: 0,
      usersSkippedUpcomingConfirmed,
      pairsScored: pairs.length,
      filteredOut,
      optedInOnly,
      market,
      scoring: MATCH_SCORING_VERSION,
    },
    pairs: top,
  })
}
