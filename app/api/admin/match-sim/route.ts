import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { isAdminByUserId } from '@/lib/admin-markets'
import { getIntakeRadiusKm } from '@/lib/intake-radius'

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

const OPTIONS_LIFE_CHAPTER = [
  "I'm in college or university", "I'm in graduate school", 'I recently graduated', "I'm early in my career", "I'm growing in my career", "I'm established in my career", "I'm building something (startup, project, business)", "I'm working independently or freelancing", "I'm transitioning into a new career", 'I recently moved to this city', 'I recently got married or entered a long-term partnership', "I'm exploring a new direction", "I'm taking time to figure out what's next", "I'm taking a break or sabbatical", "I'm starting a family", "I'm raising kids", "I'm caring for family members", "I'm semi-retired", "I'm retired",
]
const OPTIONS_EVERYDAY_ANCHOR = [
  'Work', 'Side hustles', 'Job search', 'School', 'Family life', 'Parenting', 'Family caregiving', 'Romantic relationship', 'Close friendships', 'Fitness routine', 'Creative projects', 'Community or volunteering', 'Faith or spiritual practice', 'Travel', 'Something else',
]
const OPTIONS_INTERESTS = [
  'Reading', 'Music', 'Film & TV', 'Podcasts', 'Cooking', 'Travel', 'Fitness', 'Dance', 'Basketball', 'Football', 'Soccer', 'Baseball', 'Running', 'Hiking', 'Outdoors', 'Yoga / Pilates', 'Weightlifting', 'Cycling', 'Swimming', 'Tennis', 'Pickleball', 'Photography', 'Art & design', 'Writing', 'Gaming', 'Entrepreneurship & startups', 'Investing & finance', 'History', 'Science', 'Philosophy', 'Politics & current events',
]
const OPTIONS_CURIOSITY = [
  'Take a pottery class', 'Learn how to paint', 'Learn an instrument', 'Take a dance class', 'Take a cooking class', 'Start learning a new language', 'Join a storytelling workshop', 'Take a photography course', 'Start a fitness program', 'Join a local sports league', 'Take a coding course', 'Take an AI course', 'Take a philosophy class', 'Take an improv class', 'Take a human behavior course', 'Join a public speaking group', 'Take a course on how to build a business', 'Take a class on personal finance',
]
const OPTIONS_GREAT_FIKA = [
  'Swapping stories from our lives (chapters, how we got here)',
  "Stuff we're into lately (books, shows, podcasts, games)",
  "Recent travel and places you've visited",
  "What we're working on (work or projects)",
  'Giving/getting advice for professional & personal growth',
  'Life in our city (neighborhoods, restaurants, hangout spots)',
  'Big questions and how we see the world',
  "Hobbies and things we'd like to try next",
]
const OPTIONS_OPENNESS = ["Someone I'd instantly relate to", 'Someone outside my usual bubble', "I'm open to anyone"]
const OPTIONS_HOPING_FOR = [
  'Conversation with new people — not necessarily friendship',
  'Meeting people nearby — open to friendship if it happens',
  'Actively looking for new friends',
]

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

function ensureEmbedVector(vec: unknown): number[] | null {
  if (!vec) return null
  if (Array.isArray(vec) && vec.length > 0 && typeof vec[0] === 'number') return vec as number[]
  if (typeof vec === 'string') {
    try {
      const parsed = JSON.parse(vec) as unknown
      return Array.isArray(parsed) ? parsed as number[] : null
    } catch {
      return null
    }
  }
  return null
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

function multiHot(selected: string[], options: string[]): number[] {
  const set = new Set(selected.map((s) => s.trim()))
  return options.map((o) => (set.has(o) ? 1 : 0))
}

function normalizeL2(vec: number[]): number[] {
  const sum = vec.reduce((acc, x) => acc + x * x, 0)
  const norm = Math.sqrt(sum)
  if (norm === 0) return vec
  return vec.map((x) => x / norm)
}

function sectionCosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0
  let dot = 0
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i]
  return Math.max(0, dot)
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

function scorePair(a: SimCandidate, b: SimCandidate): { score: number; sectionScores: Record<string, number> } {
  const sectionScores: Record<string, number> = {}

  const aVec = ensureEmbedVector(a.intake.embed_vector)
  const bVec = ensureEmbedVector(b.intake.embed_vector)
  sectionScores.open_text_embedding = (aVec && bVec) ? cosineSimilarity(aVec, bVec) : 0

  const aLife = normalizeL2(multiHot(getMulti(a.intake, 'q_life_chapter'), OPTIONS_LIFE_CHAPTER))
  const bLife = normalizeL2(multiHot(getMulti(b.intake, 'q_life_chapter'), OPTIONS_LIFE_CHAPTER))
  sectionScores.life_chapter = sectionCosine(aLife, bLife)

  const aAnchor = normalizeL2(multiHot(getMulti(a.intake, 'q_everyday_anchor'), OPTIONS_EVERYDAY_ANCHOR))
  const bAnchor = normalizeL2(multiHot(getMulti(b.intake, 'q_everyday_anchor'), OPTIONS_EVERYDAY_ANCHOR))
  sectionScores.day_to_day_anchors = sectionCosine(aAnchor, bAnchor)

  const aInt = normalizeL2(multiHot(getMulti(a.intake, 'q_interests'), OPTIONS_INTERESTS))
  const bInt = normalizeL2(multiHot(getMulti(b.intake, 'q_interests'), OPTIONS_INTERESTS))
  sectionScores.interests = sectionCosine(aInt, bInt)

  const aCur = normalizeL2(multiHot(getMulti(a.intake, 'q_curiosity'), OPTIONS_CURIOSITY))
  const bCur = normalizeL2(multiHot(getMulti(b.intake, 'q_curiosity'), OPTIONS_CURIOSITY))
  sectionScores.pick_up_next = sectionCosine(aCur, bCur)

  const aFika = normalizeL2(multiHot(getMulti(a.intake, 'q_what_makes_great_fika'), OPTIONS_GREAT_FIKA))
  const bFika = normalizeL2(multiHot(getMulti(b.intake, 'q_what_makes_great_fika'), OPTIONS_GREAT_FIKA))
  sectionScores.great_fika_conversation = sectionCosine(aFika, bFika)

  const aOpen = normalizeL2(multiHot(getMulti(a.intake, 'q_openness'), OPTIONS_OPENNESS))
  const bOpen = normalizeL2(multiHot(getMulti(b.intake, 'q_openness'), OPTIONS_OPENNESS))
  sectionScores.openness = sectionCosine(aOpen, bOpen)

  const aHop = normalizeL2(multiHot(getMulti(a.intake, 'q_hoping_for'), OPTIONS_HOPING_FOR))
  const bHop = normalizeL2(multiHot(getMulti(b.intake, 'q_hoping_for'), OPTIONS_HOPING_FOR))
  sectionScores.fika_intent = sectionCosine(aHop, bHop)

  const weights: Record<string, number> = {
    life_chapter: 0.22,
    day_to_day_anchors: 0.12,
    interests: 0.18,
    pick_up_next: 0.14,
    great_fika_conversation: 0.14,
    openness: 0.06,
    fika_intent: 0.06,
    open_text_embedding: 0.08,
  }
  let total = 0
  for (const [k, w] of Object.entries(weights)) total += (sectionScores[k] ?? 0) * w
  return { score: Math.max(0, Math.min(1, total)), sectionScores }
}

function getBatchWeekMonday(now: Date): string {
  const day = now.getDay()
  const daysToMonday = day === 0 ? 6 : day - 1
  const monday = new Date(now)
  monday.setDate(now.getDate() - daysToMonday)
  monday.setHours(0, 0, 0, 0)
  return monday.toISOString().split('T')[0]
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
    const fnUrl = `${url}/functions/v1/sms-match-delivery`
    const res = await fetch(fnUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: '{}',
    })
    const raw = await res.text()
    return NextResponse.json({
      ok: res.ok,
      status: res.status,
      response: raw,
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
      summary: { usersConsidered: ids.length, pairsScored: 0, filteredOut: 0, optedInOnly, market },
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

  const candidates: SimCandidate[] = []
  for (const p of userProfiles) {
    const intake = intakeById.get(p.id)
    if (!intake) continue
    candidates.push({
      profile: p,
      intake,
      age: ageFromBirthdate(p.birthdate),
      radiusKm: getIntakeRadiusKm(intake),
    })
  }

  let filteredOut = 0
  const pairs: Array<{
    userAId: string
    userAName: string
    userBId: string
    userBName: string
    score: number
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
      const score = scorePair(a, b)
      pairs.push({
        userAId: a.profile.id,
        userAName: a.profile.first_name?.trim() || 'Unknown',
        userBId: b.profile.id,
        userBName: b.profile.first_name?.trim() || 'Unknown',
        score: score.score,
        sectionScores: score.sectionScores,
      })
    }
  }

  pairs.sort((a, b) => b.score - a.score)
  const top = pairs.slice(0, topN)

  return NextResponse.json({
    summary: {
      usersConsidered: candidates.length,
      pairsScored: pairs.length,
      filteredOut,
      optedInOnly,
      market,
    },
    pairs: top,
  })
}

