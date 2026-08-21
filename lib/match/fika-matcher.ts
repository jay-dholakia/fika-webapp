import { getIntakeMulti, getIntakeSingle } from '@/lib/intake-response-utils'
import { marketTenureFitScore, workFitScore } from '@/lib/match/tenure-work-fit'
import { fikaVibeCompatibilityScore, socialStyleCompatibilityScore } from '@/lib/match/compatibility-matrices'
import {
  AGE_FIT_SCALE_YEARS,
  COMPATIBILITY_PORTION,
  COMPATIBILITY_WEIGHTS,
  CONFIRM_INTENT_REQUIRED_VALUE,
  DATA_CONFIDENCE_FIELD_IDS,
  DISTANCE_FIT_MISSING_COORDS,
  DISTANCE_FIT_SLIGHTLY_OVER_RADIUS,
  DISTANCE_HARD_REJECT_RATIO,
  FEASIBILITY_PORTION,
  FEASIBILITY_WEIGHTS,
  MULTI_CHIP_BLEND,
} from '@/lib/match/weights'

export type MatcherProfile = {
  lat: number | null
  lng: number | null
  birthdate: string | null
  /** Legacy; pairing uses `pronouns` (with gender fallback in `effectivePronounsForMatching`). */
  gender: string | null
  pronouns: string | null
  /** Legacy column; pairing uses pronoun-group matching (`checkPairEligibility`), not this field. */
  gender_preference: string | null
  /** Legacy column; age-based pairing is not used (`checkPairEligibility`). */
  age_preference: string | null
  languages: string[] | null
}

export type MatcherPerson = {
  profile: MatcherProfile
  responses: unknown
  age: number | null
  radiusKm: number
}

export type FikaMatchBreakdown = {
  eligible: boolean
  rejectReasons: string[]
  feasibility: {
    distanceFit: number
    dataConfidence: number
    total: number
  }
  compatibility: {
    greatFikaFit: number
    interestsFit: number
    curiosityFit: number
    lifeChapterFit: number
    everydayAnchorFit: number
    opennessFit: number
    likeTalkingAboutFit: number
    marketTenureFit: number
    workFit: number
    textureFit: number
    /** 0–1 from calendar-age gap; neutral 0.5 if either age unknown. */
    ageFit: number
    socialGoalFit: number
    fikaVibeFit: number
    socialStyleFit: number
    total: number
  }
  penalties: {
    avoidTopicsPenalty: number
    severeMismatchPenalty: number
    total: number
  }
  finalScore: number
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

export function multiSelectChipOverlapScore(a: string[], b: string[]): number {
  const sa = Array.from(new Set(a.map((x) => x.trim()).filter(Boolean)))
  const sb = Array.from(new Set(b.map((x) => x.trim()).filter(Boolean)))
  if (sa.length === 0 && sb.length === 0) return 0.5 // both have no data → neutral
  if (sa.length === 0 || sb.length === 0) return 0
  const setA = new Set(sa)
  const setB = new Set(sb)
  const inter = Array.from(setA).filter((x) => setB.has(x)).length
  if (inter === 0) return 0
  const union = setA.size + setB.size - inter
  const jaccard = union > 0 ? inter / union : 0
  const minSize = Math.min(setA.size, setB.size)
  const overlapCoeff = minSize > 0 ? inter / minSize : 0
  return MULTI_CHIP_BLEND.jaccard * jaccard + MULTI_CHIP_BLEND.overlapCoeff * overlapCoeff
}

/** Closer calendar ages score higher; both ages required, else neutral. */
export function ageFitScore(ageA: number | null, ageB: number | null): number {
  if (ageA == null || ageB == null || !Number.isFinite(ageA) || !Number.isFinite(ageB)) return 0.5
  const d = Math.abs(ageA - ageB)
  const raw = 1 / (1 + d / AGE_FIT_SCALE_YEARS)
  return Math.max(0, Math.min(1, raw))
}

function distanceFitScore(distanceKm: number | null, combinedRadiusKm: number): number {
  if (distanceKm == null || combinedRadiusKm <= 0) return DISTANCE_FIT_MISSING_COORDS
  const ratio = distanceKm / combinedRadiusKm
  if (ratio > DISTANCE_HARD_REJECT_RATIO) return 0
  if (ratio > 1) return DISTANCE_FIT_SLIGHTLY_OVER_RADIUS
  const curve = Math.max(0, Math.min(1, 1 - 0.78 * Math.pow(ratio, 1.15)))
  return curve
}

function intakeFieldPresent(responses: unknown, questionId: string): boolean {
  const multi = ['q_interests', 'q_like_talking_about']
  if (multi.includes(questionId)) {
    if (getIntakeMulti(responses, questionId).length > 0) return true
    // SMS onboarding stores interests as free text under a different key
    if (questionId === 'q_interests') return getIntakeMulti(responses, 'q_interests_freetext').length > 0
    return false
  }
  const s = getIntakeSingle(responses, questionId)
  return s != null && s.length > 0
}

function personDataCompletenessRatio(person: MatcherPerson): number {
  let ok = 0
  const total = DATA_CONFIDENCE_FIELD_IDS.length + 2
  for (const id of DATA_CONFIDENCE_FIELD_IDS) {
    if (intakeFieldPresent(person.responses, id)) ok++
  }
  const langs = Array.isArray(person.profile.languages) ? person.profile.languages : []
  if (langs.some((x) => String(x).trim())) ok++
  if (
    person.profile.lat != null &&
    person.profile.lng != null &&
    !Number.isNaN(person.profile.lat) &&
    !Number.isNaN(person.profile.lng)
  ) {
    ok++
  }
  return ok / total
}

function pairDataConfidence(a: MatcherPerson, b: MatcherPerson): number {
  const ca = personDataCompletenessRatio(a)
  const cb = personDataCompletenessRatio(b)
  const avg = (ca + cb) / 2
  if (avg >= 0.88) return 1
  if (avg >= 0.62) return 0.7
  return 0.4
}

function primarySubjectTokenFromPronouns(raw: string): string | null {
  const t = raw.trim().toLowerCase()
  if (!t) return null
  const seg = t
    .split(/[/,\s]+/)
    .map((s) => s.trim())
    .find((s) => s.replace(/[^a-z]/g, '').length > 0)
  if (!seg) return null
  return seg.replace(/[^a-z]/g, '')
}

function normalizedPronounsKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, '')
}

/** When `pronouns` is empty, infer from legacy onboarding `gender` (pre–pronouns-only). */
function inferredPronounsFromGender(gender: string | null | undefined): string | null {
  const g = (gender ?? '').trim().toLowerCase()
  if (!g) return null
  if (g === 'female' || g === 'woman' || g === 'women') return 'she/her'
  if (g === 'male' || g === 'man' || g === 'men') return 'he/him'
  if (g === 'non-binary' || g === 'nonbinary') return 'they/them'
  return 'they/them'
}

function effectivePronounsForMatching(profile: MatcherProfile): string | null {
  const pr = profile.pronouns?.trim()
  if (pr) return pr
  return inferredPronounsFromGender(profile.gender)
}

/** Same “group” as legacy same-gender-only: she/her/she/they, he/him/he/they, they/them, or exact custom match. */
function samePronounMatchingGroup(a: string, b: string): boolean {
  const ka = normalizedPronounsKey(a)
  const kb = normalizedPronounsKey(b)
  if (!ka || !kb) return false
  if (ka === kb) return true
  const ta = primarySubjectTokenFromPronouns(a)
  const tb = primarySubjectTokenFromPronouns(b)
  if (!ta || !tb) return false
  const fem = new Set(['she', 'her'])
  const masc = new Set(['he', 'him'])
  const they = new Set(['they', 'them'])
  if (fem.has(ta) && fem.has(tb)) return true
  if (masc.has(ta) && masc.has(tb)) return true
  if (they.has(ta) && they.has(tb)) return true
  const isStandard = (tok: string) => fem.has(tok) || masc.has(tok) || they.has(tok)
  if (!isStandard(ta) && !isStandard(tb) && ta === tb) return true
  return false
}

export function checkPairEligibility(
  a: MatcherPerson,
  b: MatcherPerson,
  opts?: { skipDistanceGate?: boolean }
): { eligible: boolean; rejectReasons: string[]; distanceKm: number | null; combinedRadiusKm: number } {
  const reasons: string[] = []
  const combinedRadiusKm = a.radiusKm + b.radiusKm

  let distanceKm: number | null = null
  if (
    a.profile.lat != null &&
    a.profile.lng != null &&
    b.profile.lat != null &&
    b.profile.lng != null
  ) {
    distanceKm = calculateDistanceKm(a.profile.lat, a.profile.lng, b.profile.lat, b.profile.lng)
    if (!opts?.skipDistanceGate && distanceKm > combinedRadiusKm * DISTANCE_HARD_REJECT_RATIO) {
      reasons.push('geography')
    }
  }

  const la = Array.isArray(a.profile.languages) ? a.profile.languages : []
  const lb = Array.isArray(b.profile.languages) ? b.profile.languages : []
  if (la.length > 0 && lb.length > 0) {
    const setA = new Set(la.map((x) => x.trim().toLowerCase()))
    const overlap = lb.some((x) => setA.has(x.trim().toLowerCase()))
    if (!overlap) reasons.push('languages')
  }

  const pa = effectivePronounsForMatching(a.profile)?.trim()
  const pb = effectivePronounsForMatching(b.profile)?.trim()
  if (!pa || !pb) {
    reasons.push('pronouns_missing')
  } else if (!samePronounMatchingGroup(pa, pb)) {
    reasons.push('same_pronoun_group_required')
  }

  const ca = getIntakeSingle(a.responses, 'confirm_intent')
  const cb = getIntakeSingle(b.responses, 'confirm_intent')
  if (ca !== CONFIRM_INTENT_REQUIRED_VALUE || cb !== CONFIRM_INTENT_REQUIRED_VALUE) {
    reasons.push('confirm_intent')
  }

  return {
    eligible: reasons.length === 0,
    rejectReasons: reasons,
    distanceKm,
    combinedRadiusKm,
  }
}

export type ScorePairOptions = {
  logMatrixUnknown?: (msg: string) => void
  /** When set, skips the distance hard-reject gate and uses this value (0–1) for distanceFit.
   *  Pass 1.0 for event matching where both users have already committed to a venue. */
  distanceOverride?: number
}

export function scoreFikaPair(a: MatcherPerson, b: MatcherPerson, opts?: ScorePairOptions): FikaMatchBreakdown {
  const skipDistanceGate = opts?.distanceOverride != null
  const { eligible, rejectReasons, distanceKm, combinedRadiusKm } = checkPairEligibility(a, b, { skipDistanceGate })

  const distanceFit = opts?.distanceOverride != null ? opts.distanceOverride : distanceFitScore(distanceKm, combinedRadiusKm)
  const dataConfidence = pairDataConfidence(a, b)
  const feasibilityTotal =
    FEASIBILITY_WEIGHTS.distanceFit * distanceFit +
    FEASIBILITY_WEIGHTS.dataConfidence * dataConfidence

  const interestsFit = multiSelectChipOverlapScore(
    getIntakeMulti(a.responses, 'q_interests'),
    getIntakeMulti(b.responses, 'q_interests')
  )
  const likeTalkingAboutFit = 0 // field removed from SMS onboarding — kept in breakdown for schema compat
  const marketTenureFit = marketTenureFitScore(a.responses, b.responses)
  const workFit = workFitScore(a.responses, b.responses)
  const ageFit = ageFitScore(a.age, b.age)
  const socialGoalFit = multiSelectChipOverlapScore(
    getIntakeMulti(a.responses, 'q_social_goal'),
    getIntakeMulti(b.responses, 'q_social_goal')
  )
  const fikaVibeFit = fikaVibeCompatibilityScore(
    getIntakeSingle(a.responses, 'q_fika_vibe'),
    getIntakeSingle(b.responses, 'q_fika_vibe'),
    opts?.logMatrixUnknown
  )
  const socialStyleFit = socialStyleCompatibilityScore(
    getIntakeSingle(a.responses, 'q_social_style'),
    getIntakeSingle(b.responses, 'q_social_style'),
    opts?.logMatrixUnknown
  )

  const w = COMPATIBILITY_WEIGHTS
  const compatibilityTotal =
    w.interests * interestsFit +
    w.marketTenure * marketTenureFit +
    w.work * workFit +
    w.fikaVibe * fikaVibeFit +
    w.ageFit * ageFit +
    w.socialGoal * socialGoalFit +
    w.socialStyle * socialStyleFit

  const avoidTopicsPenalty = 0
  const severeMismatch = 0
  const penaltyTotal = avoidTopicsPenalty + severeMismatch

  const adjustedCompat = Math.max(0, compatibilityTotal - penaltyTotal)
  let finalScore =
    FEASIBILITY_PORTION * feasibilityTotal + COMPATIBILITY_PORTION * adjustedCompat
  finalScore = Math.max(0, Math.min(1, finalScore))
  if (!eligible) finalScore = 0

  return {
    eligible,
    rejectReasons,
    feasibility: {
      distanceFit,
      dataConfidence,
      total: feasibilityTotal,
    },
    compatibility: {
      greatFikaFit: 0,
      interestsFit,
      curiosityFit: 0,
      lifeChapterFit: 0,
      everydayAnchorFit: 0,
      opennessFit: 0,
      likeTalkingAboutFit,
      marketTenureFit,
      workFit,
      textureFit: 0,
      ageFit,
      socialGoalFit,
      fikaVibeFit,
      socialStyleFit,
      total: compatibilityTotal,
    },
    penalties: {
      avoidTopicsPenalty,
      severeMismatchPenalty: severeMismatch,
      total: penaltyTotal,
    },
    finalScore,
  }
}
