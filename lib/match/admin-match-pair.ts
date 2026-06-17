import type { SupabaseClient } from '@supabase/supabase-js'
import { DEFAULT_RADIUS_KM } from '@/lib/intake-radius'
import { getIntakeMulti, getIntakeSingle } from '@/lib/intake-response-utils'
import type { FikaMatchBreakdown, MatcherPerson, ScorePairOptions } from '@/lib/match/fika-matcher'
import { scoreFikaPair } from '@/lib/match/fika-matcher'

export type AdminMatchProfileRow = {
  id: string
  first_name: string | null
  market: string | null
  city: string | null
  lat: number | null
  lng: number | null
  birthdate: string | null
  gender: string | null
  pronouns: string | null
  gender_preference: string | null
  age_preference: string | null
  languages: string[] | null
  is_active: boolean | null
}

export type AdminMatchIntakeRow = {
  user_id: string
  responses: unknown
}

export type AdminSimCandidate = {
  profile: AdminMatchProfileRow
  intake: AdminMatchIntakeRow
  age: number | null
  radiusKm: number
}

export type AdminCopyDimensionKey =
  | 'q_interests'
  | 'q_like_talking_about'
  | 'q_curiosity'
  | 'q_what_makes_great_fika'
  | 'q_life_chapter'
  | 'q_everyday_anchor'

export type AdminScoredPairPayload = {
  breakdown: FikaMatchBreakdown
  score: number
  reasons: Record<string, unknown>
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
  topCopyDimensions: AdminCopyDimensionKey[]
  sectionScores: Record<string, number>
}

export const ADMIN_MATCH_PROFILE_SELECT =
  'id, first_name, market, city, lat, lng, birthdate, gender, pronouns, gender_preference, age_preference, languages, is_active'

export function ageFromBirthdate(birthdate: string | null | undefined): number | null {
  if (!birthdate || typeof birthdate !== 'string') return null
  const date = new Date(birthdate.trim())
  if (Number.isNaN(date.getTime())) return null
  const today = new Date()
  let age = today.getFullYear() - date.getFullYear()
  const monthDiff = today.getMonth() - date.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < date.getDate())) age--
  return age >= 0 ? age : null
}

function calculateDistanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const r = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) *
      Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return r * c
}

function intakeMulti(intake: AdminMatchIntakeRow, questionId: string): string[] {
  return getIntakeMulti(intake.responses, questionId)
}

const TEXTURE_QUESTION_IDS = [
  'q_tv_streaming_shows',
  'q_podcasts',
  'q_favorite_artists',
  'q_favorite_teams',
] as const

const TEXTURE_Q_KIND: Record<(typeof TEXTURE_QUESTION_IDS)[number], 'tv' | 'podcast' | 'artist' | 'team'> = {
  q_tv_streaming_shows: 'tv',
  q_podcasts: 'podcast',
  q_favorite_artists: 'artist',
  q_favorite_teams: 'team',
}

function textureOverlapsBetweenIntakes(a: AdminMatchIntakeRow, b: AdminMatchIntakeRow): string[] {
  const out: string[] = []
  for (const q of TEXTURE_QUESTION_IDS) {
    const kind = TEXTURE_Q_KIND[q]
    const ai = intakeMulti(a, q)
    const bi = intakeMulti(b, q)
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

export function adminSimCandidateFromProfileRow(
  profile: AdminMatchProfileRow,
  intake: AdminMatchIntakeRow
): AdminSimCandidate {
  return {
    profile,
    intake,
    age: ageFromBirthdate(profile.birthdate),
    radiusKm: DEFAULT_RADIUS_KM,
  }
}

export function toMatcherPerson(c: AdminSimCandidate): MatcherPerson {
  return {
    profile: {
      lat: c.profile.lat,
      lng: c.profile.lng,
      birthdate: c.profile.birthdate,
      gender: c.profile.gender,
      pronouns: c.profile.pronouns ?? null,
      gender_preference: c.profile.gender_preference,
      age_preference: c.profile.age_preference,
      languages: c.profile.languages,
    },
    responses: c.intake.responses,
    age: c.age,
    radiusKm: c.radiusKm,
  }
}

function rankCopyDimensions(breakdown: FikaMatchBreakdown): AdminCopyDimensionKey[] {
  const c = breakdown.compatibility
  const copySafe: AdminCopyDimensionKey[] = [
    'q_interests',
    'q_like_talking_about',
    'q_curiosity',
    'q_what_makes_great_fika',
    'q_life_chapter',
    'q_everyday_anchor',
  ]
  const scores: Record<AdminCopyDimensionKey, number> = {
    q_interests: c.interestsFit,
    q_like_talking_about: c.likeTalkingAboutFit,
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

function sectionScoresFromBreakdown(bd: FikaMatchBreakdown): Record<string, number> {
  return {
    feasibility_total: bd.feasibility.total,
    distance_fit: bd.feasibility.distanceFit,
    data_confidence: bd.feasibility.dataConfidence,
    compatibility_total: bd.compatibility.total,
    q_what_makes_great_fika: bd.compatibility.greatFikaFit,
    q_interests: bd.compatibility.interestsFit,
    q_curiosity: bd.compatibility.curiosityFit,
    q_life_chapter: bd.compatibility.lifeChapterFit,
    q_everyday_anchor: bd.compatibility.everydayAnchorFit,
    q_openness_fit: bd.compatibility.opennessFit,
    q_like_talking_about_fit: bd.compatibility.likeTalkingAboutFit,
    q_market_tenure_fit: bd.compatibility.marketTenureFit,
    q_work_fit: bd.compatibility.workFit,
    age_fit: bd.compatibility.ageFit,
    texture_fit: bd.compatibility.textureFit,
    avoid_topics_penalty: bd.penalties.avoidTopicsPenalty,
    severe_mismatch_penalty: bd.penalties.severeMismatchPenalty,
    penalty_total: bd.penalties.total,
  }
}

function buildMatchCandidateReasons(
  breakdown: FikaMatchBreakdown,
  sectionScores: Record<string, number>,
  topCopyDimensions: AdminCopyDimensionKey[],
  overlapGreatFika: string[],
  overlapLikeTalkingAbout: string[],
  overlapInterests: string[],
  overlapCuriosity: string[],
  overlapLifeChapter: string[],
  overlapEverydayAnchor: string[],
  textureOverlap: string[]
): Record<string, unknown> {
  return {
    matchBreakdown: breakdown,
    raw: {
      sectionScores,
      matchBreakdown: breakdown,
      shared_interests: overlapInterests.slice(0, 3),
      conversation_hooks: overlapGreatFika.slice(0, 2),
      fika_talk_overlap: overlapLikeTalkingAbout.slice(0, 5),
      curiosity_overlap: overlapCuriosity.slice(0, 3),
      life_chapter_overlap: overlapLifeChapter.slice(0, 2),
      everyday_anchor_overlap: overlapEverydayAnchor.slice(0, 2),
      texture_overlap: textureOverlap ?? [],
    },
    copy: {
      top_copy_dimensions: topCopyDimensions.slice(0, 3),
      shared_interests: overlapInterests.slice(0, 3),
      shared_topics: [
        ...overlapLikeTalkingAbout.slice(0, 2),
        ...overlapCuriosity.slice(0, 3),
        ...overlapGreatFika.slice(0, 2),
      ].slice(0, 5),
      shared_fika_style: overlapGreatFika.slice(0, 2),
      shared_life_context: overlapLifeChapter.slice(0, 2),
      shared_everyday_anchor: overlapEverydayAnchor.slice(0, 2),
    },
  }
}

/**
 * Single scoring + overlap + `reasons` shape used for admin preview rows and `match_candidates.reasons` on intro SMS.
 */
export function computeAdminPairPayload(
  ca: AdminSimCandidate,
  cb: AdminSimCandidate,
  scoreOpts?: ScorePairOptions
): AdminScoredPairPayload {
  const ma = toMatcherPerson(ca)
  const mb = toMatcherPerson(cb)
  const breakdown = scoreFikaPair(ma, mb, scoreOpts)

  const distanceKm =
    ca.profile.lat != null &&
    ca.profile.lng != null &&
    cb.profile.lat != null &&
    cb.profile.lng != null
      ? calculateDistanceKm(ca.profile.lat, ca.profile.lng, cb.profile.lat, cb.profile.lng)
      : null

  const aLang = Array.isArray(ca.profile.languages) ? ca.profile.languages : []
  const bLang = Array.isArray(cb.profile.languages) ? cb.profile.languages : []
  const langSet = new Set(aLang.map((x) => x.trim().toLowerCase()))
  const sharedLanguages = bLang.filter((x) => langSet.has(x.trim().toLowerCase()))

  const talkA = intakeMulti(ca.intake, 'q_like_talking_about')
  const talkB = intakeMulti(cb.intake, 'q_like_talking_about')
  const likeTalkingAboutA = talkA.length ? talkA.join(', ') : null
  const likeTalkingAboutB = talkB.length ? talkB.join(', ') : null

  const overlapGreatFika = intakeMulti(ca.intake, 'q_what_makes_great_fika').filter((x) =>
    intakeMulti(cb.intake, 'q_what_makes_great_fika').includes(x)
  )
  const overlapLikeTalkingAbout = intakeMulti(ca.intake, 'q_like_talking_about').filter((x) =>
    intakeMulti(cb.intake, 'q_like_talking_about').includes(x)
  )
  const overlapInterests = intakeMulti(ca.intake, 'q_interests').filter((x) =>
    intakeMulti(cb.intake, 'q_interests').includes(x)
  )
  const overlapCuriosity = intakeMulti(ca.intake, 'q_curiosity').filter((x) =>
    intakeMulti(cb.intake, 'q_curiosity').includes(x)
  )
  const overlapLifeChapter = intakeMulti(ca.intake, 'q_life_chapter').filter((x) =>
    intakeMulti(cb.intake, 'q_life_chapter').includes(x)
  )
  const overlapEverydayAnchor = intakeMulti(ca.intake, 'q_everyday_anchor').filter((x) =>
    intakeMulti(cb.intake, 'q_everyday_anchor').includes(x)
  )
  const textureOverlap = textureOverlapsBetweenIntakes(ca.intake, cb.intake)
  const topCopyDimensions = rankCopyDimensions(breakdown)
  const sectionScores = sectionScoresFromBreakdown(breakdown)
  const reasons = buildMatchCandidateReasons(
    breakdown,
    sectionScores,
    topCopyDimensions,
    overlapGreatFika,
    overlapLikeTalkingAbout,
    overlapInterests,
    overlapCuriosity,
    overlapLifeChapter,
    overlapEverydayAnchor,
    textureOverlap
  )

  return {
    breakdown,
    score: breakdown.finalScore,
    reasons,
    distanceKm,
    sharedLanguages,
    likeTalkingAboutA,
    likeTalkingAboutB,
    overlapGreatFika,
    overlapLikeTalkingAbout,
    overlapInterests,
    overlapCuriosity,
    overlapLifeChapter,
    overlapEverydayAnchor,
    textureOverlap,
    topCopyDimensions,
    sectionScores,
  }
}

export async function loadAdminSimCandidatesForCanonicalPair(
  supabase: SupabaseClient,
  canonicalUserA: string,
  canonicalUserB: string
): Promise<{ ca: AdminSimCandidate; cb: AdminSimCandidate } | { error: string }> {
  const { data: profiles, error: profilesErr } = await supabase
    .from('profiles')
    .select(ADMIN_MATCH_PROFILE_SELECT)
    .in('id', [canonicalUserA, canonicalUserB])
  if (profilesErr) return { error: profilesErr.message }
  const list = (profiles ?? []) as AdminMatchProfileRow[]
  if (list.length !== 2) {
    return { error: 'Expected two profiles for this pair (check user ids).' }
  }
  const byId = new Map(list.map((p) => [p.id, p]))
  const pa = byId.get(canonicalUserA)
  const pb = byId.get(canonicalUserB)
  if (!pa || !pb) return { error: 'Could not load both profiles for this pair.' }

  const { data: intakes, error: intakeErr } = await supabase
    .from('intake_responses_v5')
    .select('user_id, responses')
    .in('user_id', [canonicalUserA, canonicalUserB])
  if (intakeErr) return { error: intakeErr.message }
  const intakeRows = (intakes ?? []) as AdminMatchIntakeRow[]
  const intakeBy = new Map(intakeRows.map((r) => [r.user_id, r]))
  const ia = intakeBy.get(canonicalUserA)
  const ib = intakeBy.get(canonicalUserB)
  if (!ia || !ib) return { error: 'Both users must have intake completed before sending an intro.' }

  return {
    ca: adminSimCandidateFromProfileRow(pa, ia),
    cb: adminSimCandidateFromProfileRow(pb, ib),
  }
}
