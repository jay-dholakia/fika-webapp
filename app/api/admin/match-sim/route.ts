import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { isAdminByUserId } from '@/lib/admin-markets'
import { getIntakeRadiusKm } from '@/lib/intake-radius'
import { getIntakeMulti, getIntakeAnswer } from '@/lib/intake-response-utils'
import type { FikaMatchBreakdown } from '@/lib/match/fika-matcher'
import { scoreFikaPair, type MatcherPerson } from '@/lib/match/fika-matcher'
import { MATCH_SCORING_VERSION } from '@/lib/match/weights'
import { fetchUserIdsWithUpcomingConfirmedFika } from '@/lib/upcoming-confirmed-fika'

/** Admin simulation: config-driven structured matcher (eligibility + feasibility + compatibility). */
export const dynamic = 'force-dynamic'

type ProfileRow = {
  id: string
  first_name: string | null
  market: string | null
  city: string | null
  lat: number | null
  lng: number | null
  birthdate: string | null
  gender: string | null
  gender_preference: string | null
  age_preference: string | null
  languages: string[] | null
  in_match_bowl: boolean | null
  is_active: boolean | null
}

type IntakeRow = {
  user_id: string
  responses: unknown
}

type SimCandidate = {
  profile: ProfileRow
  intake: IntakeRow
  age: number | null
  radiusKm: number
}

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

type CopyDimensionKey =
  | 'q_interests'
  | 'q_curiosity'
  | 'q_what_makes_great_fika'
  | 'q_life_chapter'
  | 'q_everyday_anchor'

function ageFromBirthdate(birthdate: string | null | undefined): number | null {
  if (!birthdate || typeof birthdate !== 'string') return null
  const date = new Date(birthdate.trim())
  if (Number.isNaN(date.getTime())) return null
  const today = new Date()
  let age = today.getFullYear() - date.getFullYear()
  const monthDiff = today.getMonth() - date.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < date.getDate())) age--
  return age >= 0 ? age : null
}

function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const r = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return r * c
}

function getResponseValue(intake: IntakeRow, questionId: string): unknown {
  return getIntakeAnswer(intake.responses, questionId)
}

function getMulti(intake: IntakeRow, questionId: string): string[] {
  return getIntakeMulti(intake.responses, questionId)
}

const TEXTURE_QUESTION_IDS = [
  'q_tv_streaming_shows',
  'q_podcasts',
  'q_favorite_artists',
  'q_favorite_teams',
] as const

/** Prefix + label; `formatMatchRevealSentence` turns these into watch / listen / fans phrasing. */
const TEXTURE_Q_KIND: Record<(typeof TEXTURE_QUESTION_IDS)[number], 'tv' | 'podcast' | 'artist' | 'team'> = {
  q_tv_streaming_shows: 'tv',
  q_podcasts: 'podcast',
  q_favorite_artists: 'artist',
  q_favorite_teams: 'team',
}

/** Exact string overlap on fandom/media fields (for reveal SMS texture line). */
function textureOverlapsBetweenIntakes(a: IntakeRow, b: IntakeRow): string[] {
  const out: string[] = []
  for (const q of TEXTURE_QUESTION_IDS) {
    const kind = TEXTURE_Q_KIND[q]
    const ai = getMulti(a, q)
    const bi = getMulti(b, q)
    for (const x of ai) {
      const token = `${kind}:${x}`
      if (bi.includes(x) && !out.includes(token)) {
        out.push(token)
        if (out.length >= 2) return out
      }
    }
  }
  return out
}

function toMatcherPerson(c: SimCandidate): MatcherPerson {
  return {
    profile: {
      lat: c.profile.lat,
      lng: c.profile.lng,
      birthdate: c.profile.birthdate,
      gender: c.profile.gender,
      gender_preference: c.profile.gender_preference,
      age_preference: c.profile.age_preference,
      languages: c.profile.languages,
    },
    responses: c.intake.responses,
    age: c.age,
    radiusKm: c.radiusKm,
  }
}

function rankCopyDimensions(breakdown: FikaMatchBreakdown): CopyDimensionKey[] {
  const c = breakdown.compatibility
  const copySafe: CopyDimensionKey[] = [
    'q_interests',
    'q_curiosity',
    'q_what_makes_great_fika',
    'q_life_chapter',
    'q_everyday_anchor',
  ]
  const scores: Record<CopyDimensionKey, number> = {
    q_interests: c.interestsFit,
    q_curiosity: c.curiosityFit,
    q_what_makes_great_fika: c.greatFikaFit,
    q_life_chapter: c.lifeChapterFit,
    q_everyday_anchor: c.everydayAnchorFit,
  }
  return [...copySafe].sort((a, b) => {
    const scoreDiff = (scores[b] ?? 0) - (scores[a] ?? 0)
    if (scoreDiff !== 0) return scoreDiff
    return copySafe.indexOf(a) - copySafe.indexOf(b)
  })
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
    { label: 'Work', a: asDisplay(getResponseValue(a.intake, 'q_work')), b: asDisplay(getResponseValue(b.intake, 'q_work')) },
    { label: 'Life chapter', a: asDisplay(getResponseValue(a.intake, 'q_life_chapter')), b: asDisplay(getResponseValue(b.intake, 'q_life_chapter')) },
    { label: 'Day-to-day anchor', a: asDisplay(getResponseValue(a.intake, 'q_everyday_anchor')), b: asDisplay(getResponseValue(b.intake, 'q_everyday_anchor')) },
    { label: 'Interests', a: asDisplay(getResponseValue(a.intake, 'q_interests')), b: asDisplay(getResponseValue(b.intake, 'q_interests')) },
    { label: 'Curiosity', a: asDisplay(getResponseValue(a.intake, 'q_curiosity')), b: asDisplay(getResponseValue(b.intake, 'q_curiosity')) },
    { label: 'Great Fika looks like', a: asDisplay(getResponseValue(a.intake, 'q_what_makes_great_fika')), b: asDisplay(getResponseValue(b.intake, 'q_what_makes_great_fika')) },
    { label: 'Hoping for', a: asDisplay(getResponseValue(a.intake, 'q_hoping_for')), b: asDisplay(getResponseValue(b.intake, 'q_hoping_for')) },
    { label: 'Typical Fika times', a: asDisplay(getResponseValue(a.intake, 'q_typical_fika_times')), b: asDisplay(getResponseValue(b.intake, 'q_typical_fika_times')) },
    { label: 'Openness', a: asDisplay(getResponseValue(a.intake, 'q_openness')), b: asDisplay(getResponseValue(b.intake, 'q_openness')) },
    { label: 'Avoid topics', a: asDisplay(getResponseValue(a.intake, 'q_avoid_topics')), b: asDisplay(getResponseValue(b.intake, 'q_avoid_topics')) },
    { label: 'Languages', a: asDisplay(a.profile.languages), b: asDisplay(b.profile.languages) },
    { label: 'Gender preference', a: asDisplay(a.profile.gender_preference), b: asDisplay(b.profile.gender_preference) },
    { label: 'Age preference', a: asDisplay(a.profile.age_preference), b: asDisplay(b.profile.age_preference) },
  ]
}

function sectionScoresFromBreakdown(bd: FikaMatchBreakdown): Record<string, number> {
  return {
    feasibility_total: bd.feasibility.total,
    distance_fit: bd.feasibility.distanceFit,
    time_fit: bd.feasibility.timeFit,
    data_confidence: bd.feasibility.dataConfidence,
    compatibility_total: bd.compatibility.total,
    q_what_makes_great_fika: bd.compatibility.greatFikaFit,
    q_interests: bd.compatibility.interestsFit,
    q_curiosity: bd.compatibility.curiosityFit,
    q_life_chapter: bd.compatibility.lifeChapterFit,
    q_everyday_anchor: bd.compatibility.everydayAnchorFit,
    q_openness_fit: bd.compatibility.opennessFit,
    q_hoping_for_fit: bd.compatibility.hopingForFit,
    q_market_tenure_fit: bd.compatibility.marketTenureFit,
    q_work_fit: bd.compatibility.workFit,
    texture_fit: bd.compatibility.textureFit,
    avoid_topics_penalty: bd.penalties.avoidTopicsPenalty,
    severe_mismatch_penalty: bd.penalties.severeMismatchPenalty,
    penalty_total: bd.penalties.total,
  }
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
        const score = typeof pair.score === 'number' && Number.isFinite(pair.score) ? pair.score : 0
        const reasons = (pair.reasons && typeof pair.reasons === 'object') ? pair.reasons : {}

        const result = await insertOrUpdateMatchCandidateForTrigger(supabase, {
          userA,
          userB,
          weekAnchorMonday,
          expiresAt,
          score,
          reasons,
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
  const relaxedFilters = body.relaxedFilters === true
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

  let profilesQuery = supabase
    .from('profiles')
    .select('id, first_name, market, city, lat, lng, birthdate, gender, gender_preference, age_preference, languages, in_match_bowl, is_active')
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
        relaxedFilters,
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
    candidates.push({
      profile: p,
      intake,
      age: ageFromBirthdate(p.birthdate),
      radiusKm: getIntakeRadiusKm(intake.responses),
    })
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
        relaxedFilters,
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
    userACity: string | null
    userBId: string
    userBName: string
    userBAge: number | null
    userBGender: string | null
    userBCity: string | null
    score: number
    distanceKm: number | null
    sharedLanguages: string[]
    hopingA: string | null
    hopingB: string | null
    overlapGreatFika: string[]
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
      const ma = toMatcherPerson(ca)
      const mb = toMatcherPerson(cb)
      const breakdown = scoreFikaPair(ma, mb, {
        relaxedEligibility: relaxedFilters,
        logMatrixUnknown: logMatrix,
      })
      if (!breakdown.eligible) {
        filteredOut++
        continue
      }
      const distanceKm =
        ca.profile.lat != null && ca.profile.lng != null && cb.profile.lat != null && cb.profile.lng != null
          ? calculateDistance(ca.profile.lat, ca.profile.lng, cb.profile.lat, cb.profile.lng)
          : null
      const aLang = Array.isArray(ca.profile.languages) ? ca.profile.languages : []
      const bLang = Array.isArray(cb.profile.languages) ? cb.profile.languages : []
      const langSet = new Set(aLang.map((x) => x.trim().toLowerCase()))
      const sharedLanguages = bLang.filter((x) => langSet.has(x.trim().toLowerCase()))
      const hopingA = getMulti(ca.intake, 'q_hoping_for')[0] ?? null
      const hopingB = getMulti(cb.intake, 'q_hoping_for')[0] ?? null
      const overlapGreatFika = getMulti(ca.intake, 'q_what_makes_great_fika').filter((x) =>
        getMulti(cb.intake, 'q_what_makes_great_fika').includes(x)
      )
      const overlapInterests = getMulti(ca.intake, 'q_interests').filter((x) =>
        getMulti(cb.intake, 'q_interests').includes(x)
      )
      const overlapCuriosity = getMulti(ca.intake, 'q_curiosity').filter((x) =>
        getMulti(cb.intake, 'q_curiosity').includes(x)
      )
      const overlapLifeChapter = getMulti(ca.intake, 'q_life_chapter').filter((x) =>
        getMulti(cb.intake, 'q_life_chapter').includes(x)
      )
      const overlapEverydayAnchor = getMulti(ca.intake, 'q_everyday_anchor').filter((x) =>
        getMulti(cb.intake, 'q_everyday_anchor').includes(x)
      )
      const textureOverlap = textureOverlapsBetweenIntakes(ca.intake, cb.intake)
      const compareRows = buildComparisonRows(ca, cb)
      pairs.push({
        userAId: ca.profile.id,
        userAName: ca.profile.first_name?.trim() || 'Unknown',
        userAAge: ca.age,
        userAGender: ca.profile.gender ?? null,
        userACity: ca.profile.city ?? null,
        userBId: cb.profile.id,
        userBName: cb.profile.first_name?.trim() || 'Unknown',
        userBAge: cb.age,
        userBGender: cb.profile.gender ?? null,
        userBCity: cb.profile.city ?? null,
        score: breakdown.finalScore,
        distanceKm,
        sharedLanguages,
        hopingA,
        hopingB,
        overlapGreatFika,
        overlapInterests,
        overlapCuriosity,
        overlapLifeChapter,
        overlapEverydayAnchor,
        textureOverlap,
        topCopyDimensions: rankCopyDimensions(breakdown),
        compareRows,
        sectionScores: sectionScoresFromBreakdown(breakdown),
        matchBreakdown: breakdown,
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
      relaxedFilters,
      market,
      scoring: MATCH_SCORING_VERSION,
    },
    pairs: top,
  })
}
