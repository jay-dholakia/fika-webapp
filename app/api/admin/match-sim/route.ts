import { createClient } from '@supabase/supabase-js'
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
} from '@/lib/match/admin-match-pair'
import { MATCH_SCORING_VERSION } from '@/lib/match/weights'

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
  const market = typeof body.market === 'string' ? body.market.trim() : null
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

  let profilesQuery = supabase.from('profiles').select(ADMIN_MATCH_PROFILE_SELECT)
    .eq('is_active', true)
    .limit(maxUsers)

  if (activeSlugs.length > 0) profilesQuery = profilesQuery.in('market', activeSlugs)
  if (market) profilesQuery = profilesQuery.eq('market', market)

  const { data: profiles, error: profilesErr } = await profilesQuery
  if (profilesErr) return NextResponse.json({ error: profilesErr.message }, { status: 500 })

  const userProfiles = (profiles ?? []) as ProfileRow[]
  const ids = userProfiles.map((p) => p.id)
  if (ids.length < 2) {
    return NextResponse.json({
      summary: {
        totalProfiles: userProfiles.length,
        usersConsidered: 0,
        usersSkippedNoIntake: 0,
        pairsScored: 0,
        filteredOut: 0,
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
  for (const p of userProfiles) {
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
        pairsScored: 0,
        filteredOut: 0,
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
      pairsScored: pairs.length,
      filteredOut,
      market,
      scoring: MATCH_SCORING_VERSION,
    },
    pairs: top,
  })
}
