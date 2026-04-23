import { getIntakeMulti, getIntakeSingle } from '@/lib/intake-response-utils'
import {
  everydayAnchorMultiCompatibility,
  hopingForCompatibilityScore,
  lifeChapterMultiCompatibility,
  opennessCompatibilityScore,
} from '@/lib/match/compatibility-matrices'
import { marketTenureFitScore, workFitScore } from '@/lib/match/tenure-work-fit'
import {
  AVOID_TOPICS_PENALTY_CAP,
  AVOID_TOPICS_PENALTY_PER_HIT,
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
  SEVERE_MISMATCH_PENALTY_CAP,
  TIME_FIT_BLEND,
} from '@/lib/match/weights'

export type MatcherProfile = {
  lat: number | null
  lng: number | null
  birthdate: string | null
  gender: string | null
  /** Legacy column; pairing uses same-gender-only (`checkPairEligibility`), not this field. */
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
    timeFit: number
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
    hopingForFit: number
    marketTenureFit: number
    workFit: number
    textureFit: number
    total: number
  }
  penalties: {
    avoidTopicsPenalty: number
    severeMismatchPenalty: number
    total: number
  }
  finalScore: number
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

const SPORTS_INTERESTS = new Set([
  'Basketball',
  'Football',
  'Soccer',
  'Baseball',
  'Running',
  'Hiking',
  'Outdoors',
  'Yoga / Pilates',
  'Weightlifting',
  'Cycling',
  'Swimming',
  'Tennis',
  'Pickleball',
  'Dance',
])

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

function timeOverlapFeasibilityScore(timesA: string[], timesB: string[]): number {
  const sa = Array.from(new Set(timesA.map((x) => x.trim()).filter(Boolean)))
  const sb = Array.from(new Set(timesB.map((x) => x.trim()).filter(Boolean)))
  if (sa.length === 0 || sb.length === 0) return 0.5
  const setA = new Set(sa)
  const setB = new Set(sb)
  const inter = Array.from(setA).filter((x) => setB.has(x)).length
  if (inter === 0) return 0
  const union = setA.size + setB.size - inter
  const jaccard = union > 0 ? inter / union : 0
  const minSize = Math.min(setA.size, setB.size)
  const overlapCoeff = minSize > 0 ? inter / minSize : 0
  return TIME_FIT_BLEND.jaccard * jaccard + TIME_FIT_BLEND.overlapCoeff * overlapCoeff
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
  const multi = ['q_interests', 'q_what_makes_great_fika', 'q_life_chapter', 'q_curiosity', 'q_everyday_anchor', 'q_typical_fika_times']
  if (multi.includes(questionId)) {
    return getIntakeMulti(responses, questionId).length > 0
  }
  if (questionId === 'confirm_intent') {
    const v = getIntakeSingle(responses, 'confirm_intent')
    return v === CONFIRM_INTENT_REQUIRED_VALUE
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

function sameGender(a: string, b: string): boolean {
  const x = a.trim().toLowerCase()
  const y = b.trim().toLowerCase()
  if (x === y) return true
  if ((x === 'female' || x === 'woman' || x === 'women') && (y === 'female' || y === 'woman' || y === 'women')) return true
  if ((x === 'male' || x === 'man' || x === 'men') && (y === 'male' || y === 'man' || y === 'men')) return true
  if ((x === 'non-binary' || x === 'nonbinary') && (y === 'non-binary' || y === 'nonbinary')) return true
  return false
}

function avoidTopicsPenaltySymmetric(a: MatcherPerson, b: MatcherPerson): number {
  const avoidA = getIntakeMulti(a.responses, 'q_avoid_topics').filter((x) => !AVOID_IGNORE.has(x))
  const avoidB = getIntakeMulti(b.responses, 'q_avoid_topics').filter((x) => !AVOID_IGNORE.has(x))
  const interestsA = getIntakeMulti(a.responses, 'q_interests')
  const interestsB = getIntakeMulti(b.responses, 'q_interests')
  let hits = 0
  for (const av of avoidA) {
    const mapped = AVOID_TO_INTERESTS[av]
    if (mapped?.some((t) => interestsB.includes(t))) hits++
    if (av === 'Health' && interestsB.some((t) => SPORTS_INTERESTS.has(t))) hits++
  }
  for (const av of avoidB) {
    const mapped = AVOID_TO_INTERESTS[av]
    if (mapped?.some((t) => interestsA.includes(t))) hits++
    if (av === 'Health' && interestsA.some((t) => SPORTS_INTERESTS.has(t))) hits++
  }
  return Math.min(AVOID_TOPICS_PENALTY_CAP, hits * AVOID_TOPICS_PENALTY_PER_HIT)
}

function severeMismatchPenalty(opennessFit: number, hopingFit: number): number {
  let s = 0
  if (hopingFit < 0.48) s += Math.min(0.035, 0.48 - hopingFit)
  if (opennessFit < 0.4) s += Math.min(0.035, 0.4 - opennessFit)
  return Math.min(SEVERE_MISMATCH_PENALTY_CAP, s)
}

export type EligibilityOptions = {
  relaxedEligibility?: boolean
}

export function checkPairEligibility(
  a: MatcherPerson,
  b: MatcherPerson,
  opts?: EligibilityOptions
): { eligible: boolean; rejectReasons: string[]; distanceKm: number | null; combinedRadiusKm: number } {
  const reasons: string[] = []
  const relaxed = opts?.relaxedEligibility === true
  const combinedRadiusKm = a.radiusKm + b.radiusKm

  let distanceKm: number | null = null
  if (
    a.profile.lat != null &&
    a.profile.lng != null &&
    b.profile.lat != null &&
    b.profile.lng != null
  ) {
    distanceKm = calculateDistanceKm(a.profile.lat, a.profile.lng, b.profile.lat, b.profile.lng)
    if (distanceKm > combinedRadiusKm * DISTANCE_HARD_REJECT_RATIO) {
      reasons.push('geography')
    }
  }

  if (!relaxed) {
    const la = Array.isArray(a.profile.languages) ? a.profile.languages : []
    const lb = Array.isArray(b.profile.languages) ? b.profile.languages : []
    if (la.length > 0 && lb.length > 0) {
      const setA = new Set(la.map((x) => x.trim().toLowerCase()))
      const overlap = lb.some((x) => setA.has(x.trim().toLowerCase()))
      if (!overlap) reasons.push('languages')
    }
  }

  if (!relaxed) {
    const ga = a.profile.gender?.trim()
    const gb = b.profile.gender?.trim()
    if (!ga || !gb) {
      reasons.push('gender_missing')
    } else if (!sameGender(ga, gb)) {
      reasons.push('same_gender_required')
    }
  }

  if (!relaxed) {
    const ca = getIntakeSingle(a.responses, 'confirm_intent')
    const cb = getIntakeSingle(b.responses, 'confirm_intent')
    if (ca !== CONFIRM_INTENT_REQUIRED_VALUE || cb !== CONFIRM_INTENT_REQUIRED_VALUE) {
      reasons.push('confirm_intent')
    }
  }

  return {
    eligible: reasons.length === 0,
    rejectReasons: reasons,
    distanceKm,
    combinedRadiusKm,
  }
}

export type ScorePairOptions = EligibilityOptions & {
  logMatrixUnknown?: (msg: string) => void
}

export function scoreFikaPair(a: MatcherPerson, b: MatcherPerson, opts?: ScorePairOptions): FikaMatchBreakdown {
  const log = opts?.logMatrixUnknown
  const { eligible, rejectReasons, distanceKm, combinedRadiusKm } = checkPairEligibility(a, b, opts)

  const distanceFit = distanceFitScore(distanceKm, combinedRadiusKm)
  const timesA = getIntakeMulti(a.responses, 'q_typical_fika_times')
  const timesB = getIntakeMulti(b.responses, 'q_typical_fika_times')
  const timeFit = timeOverlapFeasibilityScore(timesA, timesB)
  const dataConfidence = pairDataConfidence(a, b)
  const feasibilityTotal =
    FEASIBILITY_WEIGHTS.distanceFit * distanceFit +
    FEASIBILITY_WEIGHTS.timeFit * timeFit +
    FEASIBILITY_WEIGHTS.dataConfidence * dataConfidence

  const greatFikaA = getIntakeMulti(a.responses, 'q_what_makes_great_fika')
  const greatFikaB = getIntakeMulti(b.responses, 'q_what_makes_great_fika')
  const greatFikaFit =
    greatFikaA.length === 0 && greatFikaB.length === 0
      ? 0.5
      : multiSelectChipOverlapScore(greatFikaA, greatFikaB)
  const interestsFit = multiSelectChipOverlapScore(
    getIntakeMulti(a.responses, 'q_interests'),
    getIntakeMulti(b.responses, 'q_interests')
  )
  const curiosityA = getIntakeMulti(a.responses, 'q_curiosity')
  const curiosityB = getIntakeMulti(b.responses, 'q_curiosity')
  const curiosityFit =
    curiosityA.length === 0 && curiosityB.length === 0
      ? 0.5
      : multiSelectChipOverlapScore(curiosityA, curiosityB)
  const lifeChapterFit = lifeChapterMultiCompatibility(a.responses, b.responses, log)
  const everydayAnchorFit = everydayAnchorMultiCompatibility(a.responses, b.responses, log)
  const oa = getIntakeSingle(a.responses, 'q_openness')
  const ob = getIntakeSingle(b.responses, 'q_openness')
  const opennessFit = opennessCompatibilityScore(oa, ob, log)
  const ha = getIntakeSingle(a.responses, 'q_hoping_for')
  const hb = getIntakeSingle(b.responses, 'q_hoping_for')
  const hopingForFit = hopingForCompatibilityScore(ha, hb, log)
  const marketTenureFit = marketTenureFitScore(a.responses, b.responses)
  const workFit = workFitScore(a.responses, b.responses)

  const w = COMPATIBILITY_WEIGHTS
  const compatibilityTotal =
    w.greatFika * greatFikaFit +
    w.interests * interestsFit +
    w.marketTenure * marketTenureFit +
    w.work * workFit +
    w.curiosity * curiosityFit +
    w.lifeChapter * lifeChapterFit +
    w.everydayAnchor * everydayAnchorFit +
    w.openness * opennessFit +
    w.hopingFor * hopingForFit

  const avoidTopicsPenalty = avoidTopicsPenaltySymmetric(a, b)
  const severeMismatch = severeMismatchPenalty(opennessFit, hopingForFit)
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
      timeFit,
      dataConfidence,
      total: feasibilityTotal,
    },
    compatibility: {
      greatFikaFit,
      interestsFit,
      curiosityFit,
      lifeChapterFit,
      everydayAnchorFit,
      opennessFit,
      hopingForFit,
      marketTenureFit,
      workFit,
      textureFit: 0,
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
