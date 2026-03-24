import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { isAdminByUserId } from '@/lib/admin-markets'
import { getIntakeRadiusKm } from '@/lib/intake-radius'

/** Admin simulation: ranks pairs by intake embed_vector cosine similarity (+ hard filters). `trigger_sms` → `match_candidates` + `sms-match-delivery`. */
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
  embed_vector: unknown
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
    { label: 'Avoid topics', a: asDisplay(getResponseValue(a.intake, 'q_avoid_topics')), b: asDisplay(getResponseValue(b.intake, 'q_avoid_topics')) },
    { label: 'Languages', a: asDisplay(a.profile.languages), b: asDisplay(b.profile.languages) },
    { label: 'Gender preference', a: asDisplay(a.profile.gender_preference), b: asDisplay(b.profile.gender_preference) },
    { label: 'Age preference', a: asDisplay(a.profile.age_preference), b: asDisplay(b.profile.age_preference) },
  ]
}

function ensureEmbedVector(vec: unknown): number[] | null {
  if (vec == null) return null
  if (typeof vec === 'string') {
    const s = vec.trim()
    if (!s) return null
    try {
      return ensureEmbedVector(JSON.parse(s))
    } catch {
      return null
    }
  }
  if (!Array.isArray(vec) || vec.length === 0) return null
  const out: number[] = []
  for (const x of vec) {
    if (typeof x === 'number' && Number.isFinite(x)) out.push(x)
    else if (typeof x === 'string' && x.trim() !== '') {
      const n = Number(x)
      if (Number.isFinite(n)) out.push(n)
      else return null
    } else return null
  }
  return out.length > 0 ? out : null
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return Math.max(0, dot / (Math.sqrt(na) * Math.sqrt(nb)))
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

function passesFilters(a: SimCandidate, b: SimCandidate): { ok: boolean; reason?: string } {
  if (a.profile.lat != null && a.profile.lng != null && b.profile.lat != null && b.profile.lng != null) {
    const distanceKm = calculateDistance(a.profile.lat, a.profile.lng, b.profile.lat, b.profile.lng)
    const maxKm = a.radiusKm + b.radiusKm
    if (distanceKm > maxKm) return { ok: false, reason: 'geography' }
  }

  const la = Array.isArray(a.profile.languages) ? a.profile.languages : []
  const lb = Array.isArray(b.profile.languages) ? b.profile.languages : []
  if (la.length > 0 && lb.length > 0) {
    const setA = new Set(la.map((x) => x.trim().toLowerCase()))
    const overlap = lb.some((x) => setA.has(x.trim().toLowerCase()))
    if (!overlap) return { ok: false, reason: 'languages' }
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

  const preferAround = 'Prefer around my age'
  const aAround = a.profile.age_preference?.trim() === preferAround
  const bAround = b.profile.age_preference?.trim() === preferAround
  if ((aAround || bAround) && a.age != null && b.age != null && Math.abs(a.age - b.age) > 3) {
    return { ok: false, reason: 'age_pref' }
  }

  const convOnly = 'Conversation with new people — not necessarily friendship'
  const activeFriends = 'Actively looking for new friends'
  const aHop = getMulti(a.intake, 'q_hoping_for')[0] ?? null
  const bHop = getMulti(b.intake, 'q_hoping_for')[0] ?? null
  if ((aHop === convOnly && bHop === activeFriends) || (aHop === activeFriends && bHop === convOnly)) {
    return { ok: false, reason: 'hoping_for' }
  }

  return { ok: true }
}

/** Cosine similarity between intake embedding vectors (same space as complete-intake). */
function embeddingPairScore(a: SimCandidate, b: SimCandidate): { score: number; sectionScores: Record<string, number> } {
  const aVec = ensureEmbedVector(a.intake.embed_vector)
  const bVec = ensureEmbedVector(b.intake.embed_vector)
  if (!aVec || !bVec) {
    return { score: 0, sectionScores: {} }
  }
  const sim = cosineSimilarity(aVec, bVec)
  const score = Math.max(0, Math.min(1, sim))
  return { score, sectionScores: { embedding_cosine: score } }
}

function getBatchWeekMonday(now: Date): string {
  const monday = new Date(now)
  const day = monday.getUTCDay()
  const diffToMonday = (day + 6) % 7
  monday.setUTCDate(monday.getUTCDate() - diffToMonday)
  monday.setUTCHours(0, 0, 0, 0)
  return monday.toISOString().split('T')[0]
}

function getExpiresAtWednesdayMidnightUtc(batchWeek: string): string {
  const d = new Date(`${batchWeek}T00:00:00.000Z`)
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

    const batchWeek = getBatchWeekMonday(new Date())
    let targetMatchIds: string[] | null = null

    if (selectedPairs.length > 0) {
      const expiresAt = getExpiresAtWednesdayMidnightUtc(batchWeek)
      const createdIds: string[] = []
      for (const pair of selectedPairs) {
        const userA = pair.userAId < pair.userBId ? pair.userAId : pair.userBId
        const userB = pair.userAId < pair.userBId ? pair.userBId : pair.userAId
        const score = typeof pair.score === 'number' && Number.isFinite(pair.score) ? pair.score : 0
        const reasons = (pair.reasons && typeof pair.reasons === 'object') ? pair.reasons : {}

        const { data: inserted, error: insertErr } = await supabase
          .from('match_candidates')
          .insert({
            user_a: userA,
            user_b: userB,
            score,
            reasons,
            status: 'active',
            batch_week: batchWeek,
            expires_at: expiresAt,
          })
          .select('id')
          .single()

        if (insertErr) {
          if (insertErr.code !== '23505') {
            return NextResponse.json({ error: insertErr.message }, { status: 500 })
          }
          const { data: updated, error: updateErr } = await supabase
            .from('match_candidates')
            .update({
              score,
              reasons,
              expires_at: expiresAt,
            })
            .eq('user_a', userA)
            .eq('user_b', userB)
            .eq('batch_week', batchWeek)
            .select('id')
            .single()
          if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })
          if (updated?.id) createdIds.push(updated.id as string)
        } else if (inserted?.id) {
          createdIds.push(inserted.id as string)
        }
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
  const maxUsers = Math.min(300, Math.max(20, typeof body.maxUsers === 'number' ? Math.floor(body.maxUsers) : 120))
  const topN = Math.min(300, Math.max(10, typeof body.topN === 'number' ? Math.floor(body.topN) : 100))

  const { data: activeMarkets } = await supabase.from('markets').select('slug').eq('active', true)
  const activeSlugs = (activeMarkets ?? []).map((m: { slug: string }) => m.slug)
  let candidateIds: string[] | null = null

  if (optedInOnly) {
    const batchWeek = getBatchWeekMonday(new Date())
    const { data: optIns } = await supabase
      .from('weekly_match_opt_ins')
      .select('user_id')
      .eq('batch_week', batchWeek)
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
  const ids = userProfiles.map((p) => p.id)
  if (ids.length < 2) {
    return NextResponse.json({
      summary: {
        totalProfiles: ids.length,
        usersConsidered: 0,
        usersSkippedNoIntake: 0,
        usersSkippedNoEmbedding: 0,
        pairsScored: 0,
        filteredOut: 0,
        optedInOnly,
        market,
        scoring: 'embedding_cosine',
      },
      pairs: [],
    })
  }

  const { data: intakeRows, error: intakeErr } = await supabase
    .from('intake_responses_v5')
    .select('user_id, responses, embed_vector')
    .in('user_id', ids)
  if (intakeErr) return NextResponse.json({ error: intakeErr.message }, { status: 500 })
  const intakeById = new Map<string, IntakeRow>()
  for (const r of (intakeRows ?? []) as IntakeRow[]) intakeById.set(r.user_id, r)

  let usersSkippedNoIntake = 0
  let usersSkippedNoEmbedding = 0
  const candidates: SimCandidate[] = []
  for (const p of userProfiles) {
    const intake = intakeById.get(p.id)
    if (!intake) {
      usersSkippedNoIntake++
      continue
    }
    if (!ensureEmbedVector(intake.embed_vector)) {
      usersSkippedNoEmbedding++
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
        usersSkippedNoEmbedding,
        pairsScored: 0,
        filteredOut: 0,
        optedInOnly,
        market,
        scoring: 'embedding_cosine',
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
      const pass = passesFilters(a, b)
      if (!pass.ok) {
        filteredOut++
        continue
      }
      const score = embeddingPairScore(a, b)
      const distanceKm =
        a.profile.lat != null && a.profile.lng != null && b.profile.lat != null && b.profile.lng != null
          ? calculateDistance(a.profile.lat, a.profile.lng, b.profile.lat, b.profile.lng)
          : null
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
        score: score.score,
        distanceKm,
        sharedLanguages,
        hopingA,
        hopingB,
        overlapGreatFika,
        overlapInterests,
        compareRows,
        sectionScores: score.sectionScores,
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
      usersSkippedNoEmbedding,
      pairsScored: pairs.length,
      filteredOut,
      optedInOnly,
      market,
      scoring: 'embedding_cosine',
    },
    pairs: top,
  })
}

