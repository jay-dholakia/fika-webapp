import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { isAdminByUserId } from '@/lib/admin-markets'
import { getIntakeRadiusKm } from '@/lib/intake-radius'
import { fetchUserIdsWithUpcomingConfirmedFika } from '@/lib/upcoming-confirmed-fika'

/** Admin simulation: ranks pairs by structured intake overlap + distance (+ hard filters). `trigger_sms` → `match_candidates` + `sms-match-delivery`. */
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
  const responses = Array.isArray(intake.responses) ? intake.responses as Array<{ question_id?: string; answer?: unknown }> : []
  const r = responses.find((x) => x.question_id === questionId)
  const value = r?.answer
  if (value === 'N/A') return null
  if (Array.isArray(value) && value.length === 1 && value[0] === 'N/A') return null
  return value ?? null
}

function getMulti(intake: IntakeRow, questionId: string): string[] {
  const v = getResponseValue(intake, questionId)
  if (Array.isArray(v)) return v.map((x) => String(x))
  if (typeof v === 'string' && v.trim()) return [v]
  return []
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

const OPENNESS_OPEN_ANYONE = "I'm open to anyone"
const OPENNESS_RELATE = "Someone I'd instantly relate to"
const OPENNESS_BUBBLE = 'Someone outside my usual bubble'

/** Overlap count / max(selected lengths); 0 if either side empty. */
function multiSelectOverlapScore(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0
  const overlap = a.filter((v) => b.includes(v)).length
  return overlap / Math.max(a.length, b.length)
}

function distanceProportionScore(distanceKm: number | null, maxKm: number): number {
  if (distanceKm == null || maxKm <= 0) return 0.5
  return Math.max(0, Math.min(1, 1 - distanceKm / maxKm))
}

function opennessFitSubscore(oa: string | null, ob: string | null): number {
  if (!oa || !ob) return 0.55
  if (oa === OPENNESS_OPEN_ANYONE && ob === OPENNESS_OPEN_ANYONE) return 1
  if (oa === OPENNESS_OPEN_ANYONE || ob === OPENNESS_OPEN_ANYONE) return 0.88
  if (oa === ob) return 1
  return 0.5
}

const AVOID_IGNORE = new Set(['Nothing in particular', 'Prefer not to say'])

/** Maps avoid-topic chip → interest labels that conflict if the other person selected them. */
const AVOID_TO_INTERESTS: Record<string, string[]> = {
  Politics: ['Politics & current events'],
  Religion: ['Philosophy'],
  'Work & career': ['Entrepreneurship & startups', 'Investing & finance'],
  'Relationship status': [],
  Health: ['Fitness', 'Running', 'Hiking', 'Outdoors', 'Yoga / Pilates', 'Weightlifting', 'Cycling', 'Swimming'],
  'Personal finances': ['Investing & finance'],
}

function avoidTopicsPenalty(a: SimCandidate, b: SimCandidate): number {
  const avoidA = getMulti(a.intake, 'q_avoid_topics').filter((x) => !AVOID_IGNORE.has(x))
  const avoidB = getMulti(b.intake, 'q_avoid_topics').filter((x) => !AVOID_IGNORE.has(x))
  const interestsA = getMulti(a.intake, 'q_interests')
  const interestsB = getMulti(b.intake, 'q_interests')
  let hits = 0
  for (const av of avoidA) {
    const mapped = AVOID_TO_INTERESTS[av]
    if (mapped?.some((t) => interestsB.includes(t))) hits++
  }
  for (const av of avoidB) {
    const mapped = AVOID_TO_INTERESTS[av]
    if (mapped?.some((t) => interestsA.includes(t))) hits++
  }
  return Math.min(0.12, hits * 0.04)
}

const STRUCTURED_WEIGHTS = {
  interests: 0.28,
  greatFika: 0.22,
  lifeChapter: 0.14,
  curiosity: 0.12,
  everydayAnchor: 0.1,
  distance: 0.06,
  openness: 0.04,
} as const

function structuredPairScore(
  a: SimCandidate,
  b: SimCandidate,
  distanceKm: number | null
): { score: number; sectionScores: Record<string, number> } {
  const sInt = multiSelectOverlapScore(getMulti(a.intake, 'q_interests'), getMulti(b.intake, 'q_interests'))
  const sGf = multiSelectOverlapScore(
    getMulti(a.intake, 'q_what_makes_great_fika'),
    getMulti(b.intake, 'q_what_makes_great_fika')
  )
  const sLc = multiSelectOverlapScore(getMulti(a.intake, 'q_life_chapter'), getMulti(b.intake, 'q_life_chapter'))
  const sCur = multiSelectOverlapScore(getMulti(a.intake, 'q_curiosity'), getMulti(b.intake, 'q_curiosity'))
  const sEa = multiSelectOverlapScore(getMulti(a.intake, 'q_everyday_anchor'), getMulti(b.intake, 'q_everyday_anchor'))
  const maxKm = a.radiusKm + b.radiusKm
  const sDist = distanceProportionScore(distanceKm, maxKm)
  const oa = getMulti(a.intake, 'q_openness')[0] ?? null
  const ob = getMulti(b.intake, 'q_openness')[0] ?? null
  const sOpen = opennessFitSubscore(oa, ob)
  const pen = avoidTopicsPenalty(a, b)

  let raw =
    STRUCTURED_WEIGHTS.interests * sInt +
    STRUCTURED_WEIGHTS.greatFika * sGf +
    STRUCTURED_WEIGHTS.lifeChapter * sLc +
    STRUCTURED_WEIGHTS.curiosity * sCur +
    STRUCTURED_WEIGHTS.everydayAnchor * sEa +
    STRUCTURED_WEIGHTS.distance * sDist +
    STRUCTURED_WEIGHTS.openness * sOpen
  raw = Math.max(0, Math.min(1, raw - pen))

  return {
    score: raw,
    sectionScores: {
      q_interests: sInt,
      q_what_makes_great_fika: sGf,
      q_life_chapter: sLc,
      q_curiosity: sCur,
      q_everyday_anchor: sEa,
      distance: sDist,
      q_openness_fit: sOpen,
      avoid_topics_penalty: pen,
    },
  }
}

function sameGender(a: string, b: string): boolean {
  if (a === b) return true
  if ((a === 'female' || a === 'woman' || a === 'women') && (b === 'female' || b === 'woman' || b === 'women')) return true
  if ((a === 'male' || a === 'man' || a === 'men') && (b === 'male' || b === 'man' || b === 'men')) return true
  if ((a === 'non-binary' || a === 'nonbinary') && (b === 'non-binary' || b === 'nonbinary')) return true
  return false
}

function preferenceAllows(pref: string, userGender: string, candidateGender: string): boolean {
  if (pref === 'no preference') return true
  if (pref === 'same gender') return sameGender(userGender, candidateGender)
  if (pref === 'different gender') return !sameGender(userGender, candidateGender)
  return true
}

function passesFilters(
  a: SimCandidate,
  b: SimCandidate,
  opts?: { relaxedFilters?: boolean }
): { ok: boolean; reason?: string } {
  const relaxedFilters = opts?.relaxedFilters === true
  if (a.profile.lat != null && a.profile.lng != null && b.profile.lat != null && b.profile.lng != null) {
    const distanceKm = calculateDistance(a.profile.lat, a.profile.lng, b.profile.lat, b.profile.lng)
    const maxKm = a.radiusKm + b.radiusKm
    if (distanceKm > maxKm) return { ok: false, reason: 'geography' }
  }

  if (!relaxedFilters) {
    const la = Array.isArray(a.profile.languages) ? a.profile.languages : []
    const lb = Array.isArray(b.profile.languages) ? b.profile.languages : []
    if (la.length > 0 && lb.length > 0) {
      const setA = new Set(la.map((x) => x.trim().toLowerCase()))
      const overlap = lb.some((x) => setA.has(x.trim().toLowerCase()))
      if (!overlap) return { ok: false, reason: 'languages' }
    }
  }

  if (
    a.profile.gender && b.profile.gender &&
    a.profile.gender_preference && b.profile.gender_preference
  ) {
    const aGender = a.profile.gender.trim().toLowerCase()
    const bGender = b.profile.gender.trim().toLowerCase()
    const aPref = a.profile.gender_preference.trim().toLowerCase()
    const bPref = b.profile.gender_preference.trim().toLowerCase()
    if (!preferenceAllows(aPref, aGender, bGender)) return { ok: false, reason: 'gender_pref' }
    if (!preferenceAllows(bPref, bGender, aGender)) return { ok: false, reason: 'gender_pref' }
  }

  {
    const preferAround = 'Prefer around my age'
    const aAround = a.profile.age_preference?.trim() === preferAround
    const bAround = b.profile.age_preference?.trim() === preferAround

    if (aAround) {
      if (a.age == null || b.age == null) return { ok: false, reason: 'age_pref' }
      if (Math.abs(a.age - b.age) > 3) return { ok: false, reason: 'age_pref' }
    }
    if (bAround) {
      if (a.age == null || b.age == null) return { ok: false, reason: 'age_pref' }
      if (Math.abs(a.age - b.age) > 3) return { ok: false, reason: 'age_pref' }
    }
  }

  if (!relaxedFilters) {
    const convOnly = 'Conversation with new people — not necessarily friendship'
    const activeFriends = 'Actively looking for new friends'
    const aHop = getMulti(a.intake, 'q_hoping_for')[0] ?? null
    const bHop = getMulti(b.intake, 'q_hoping_for')[0] ?? null
    if ((aHop === convOnly && bHop === activeFriends) || (aHop === activeFriends && bHop === convOnly)) {
      return { ok: false, reason: 'hoping_for' }
    }

    const timesA = getMulti(a.intake, 'q_typical_fika_times')
    const timesB = getMulti(b.intake, 'q_typical_fika_times')
    if (timesA.length === 0 || timesB.length === 0) {
      return { ok: false, reason: 'fika_times' }
    }
    if (!timesA.some((t) => timesB.includes(t))) {
      return { ok: false, reason: 'fika_times' }
    }

    const oa = getMulti(a.intake, 'q_openness')[0] ?? null
    const ob = getMulti(b.intake, 'q_openness')[0] ?? null
    if (oa && ob && oa !== OPENNESS_OPEN_ANYONE && ob !== OPENNESS_OPEN_ANYONE) {
      const clash =
        (oa === OPENNESS_RELATE && ob === OPENNESS_BUBBLE) ||
        (oa === OPENNESS_BUBBLE && ob === OPENNESS_RELATE)
      if (clash) return { ok: false, reason: 'openness' }
    }
  }

  return { ok: true }
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

  const market = typeof body.market === 'string' && body.market.trim() ? body.market.trim() : null
  const optedInOnly = body.optedInOnly === true
  const relaxedFilters = body.relaxedFilters === true
  const maxUsers = Math.min(300, Math.max(20, typeof body.maxUsers === 'number' ? Math.floor(body.maxUsers) : 120))
  const topN = Math.min(300, Math.max(10, typeof body.topN === 'number' ? Math.floor(body.topN) : 100))

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
        scoring: 'structured_v1',
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
      radiusKm: getIntakeRadiusKm(intake),
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
        scoring: 'structured_v1',
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
    compareRows: CompareRow[]
    sectionScores: Record<string, number>
  }> = []

  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i]
      const b = candidates[j]
      const pass = passesFilters(a, b, { relaxedFilters })
      if (!pass.ok) {
        filteredOut++
        continue
      }
      const distanceKm =
        a.profile.lat != null && a.profile.lng != null && b.profile.lat != null && b.profile.lng != null
          ? calculateDistance(a.profile.lat, a.profile.lng, b.profile.lat, b.profile.lng)
          : null
      const scored = structuredPairScore(a, b, distanceKm)
      const aLang = Array.isArray(a.profile.languages) ? a.profile.languages : []
      const bLang = Array.isArray(b.profile.languages) ? b.profile.languages : []
      const langSet = new Set(aLang.map((x) => x.trim().toLowerCase()))
      const sharedLanguages = bLang.filter((x) => langSet.has(x.trim().toLowerCase()))
      const hopingA = getMulti(a.intake, 'q_hoping_for')[0] ?? null
      const hopingB = getMulti(b.intake, 'q_hoping_for')[0] ?? null
      const overlapGreatFika = getMulti(a.intake, 'q_what_makes_great_fika').filter((x) =>
        getMulti(b.intake, 'q_what_makes_great_fika').includes(x)
      )
      const overlapInterests = getMulti(a.intake, 'q_interests').filter((x) =>
        getMulti(b.intake, 'q_interests').includes(x)
      )
      const compareRows = buildComparisonRows(a, b)
      pairs.push({
        userAId: a.profile.id,
        userAName: a.profile.first_name?.trim() || 'Unknown',
        userAAge: a.age,
        userAGender: a.profile.gender ?? null,
        userACity: a.profile.city ?? null,
        userBId: b.profile.id,
        userBName: b.profile.first_name?.trim() || 'Unknown',
        userBAge: b.age,
        userBGender: b.profile.gender ?? null,
        userBCity: b.profile.city ?? null,
        score: scored.score,
        distanceKm,
        sharedLanguages,
        hopingA,
        hopingB,
        overlapGreatFika,
        overlapInterests,
        compareRows,
        sectionScores: scored.sectionScores,
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
      scoring: 'structured_v1',
    },
    pairs: top,
  })
}

