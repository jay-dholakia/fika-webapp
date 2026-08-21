/**
 * Symmetric compatibility scores for single-select fields (0..1).
 * Multi-select life chapter / everyday anchor use cluster lookups below.
 *
 * If product copy changes, update labels here to match `lib/onboarding-data.ts` exactly.
 */

import { getIntakeMulti } from '@/lib/intake-response-utils'

// --- Openness (chips_single) — exact strings from onboarding ---

const OPENNESS_OPEN = "I'm open to anyone"
const OPENNESS_RELATE = "Someone I'd instantly relate to"
const OPENNESS_BUBBLE = 'Someone outside my usual bubble'

const OPENNESS_SCORES: Record<string, Record<string, number>> = {
  [OPENNESS_RELATE]: {
    [OPENNESS_RELATE]: 1,
    [OPENNESS_BUBBLE]: 0.28,
    [OPENNESS_OPEN]: 0.92,
  },
  [OPENNESS_BUBBLE]: {
    [OPENNESS_RELATE]: 0.28,
    [OPENNESS_BUBBLE]: 1,
    [OPENNESS_OPEN]: 0.92,
  },
  [OPENNESS_OPEN]: {
    [OPENNESS_RELATE]: 0.92,
    [OPENNESS_BUBBLE]: 0.92,
    [OPENNESS_OPEN]: 1,
  },
}

// --- Hoping for (chips_single) ---

const HOPING_CONV = 'Conversation with new people — not necessarily friendship'
const HOPING_NEAR = 'Meeting people nearby — open to friendship if it happens'
const HOPING_FRIENDS = 'Actively looking for new friends'

const HOPING_SCORES: Record<string, Record<string, number>> = {
  [HOPING_CONV]: {
    [HOPING_CONV]: 1,
    [HOPING_NEAR]: 0.74,
    [HOPING_FRIENDS]: 0.42,
  },
  [HOPING_NEAR]: {
    [HOPING_CONV]: 0.74,
    [HOPING_NEAR]: 1,
    [HOPING_FRIENDS]: 0.62,
  },
  [HOPING_FRIENDS]: {
    [HOPING_CONV]: 0.42,
    [HOPING_NEAR]: 0.62,
    [HOPING_FRIENDS]: 1,
  },
}

/**
 * Symmetric matrix lookup; missing keys → neutral 0.5.
 * In development, unknown labels are logged once per process (optional caller).
 */
export function matrixPairScore(
  a: string | null,
  b: string | null,
  matrix: Record<string, Record<string, number>>,
  fieldKey: string,
  logUnknown?: (msg: string) => void
): number {
  if (!a || !b) return 0.5
  const row = matrix[a]
  if (row && typeof row[b] === 'number') return row[b]
  const rev = matrix[b]
  if (rev && typeof rev[a] === 'number') return rev[a]
  logUnknown?.(`[fika-matcher] Unknown ${fieldKey} pair: ${JSON.stringify(a)} × ${JSON.stringify(b)}`)
  return 0.5
}

export function opennessCompatibilityScore(
  a: string | null,
  b: string | null,
  logUnknown?: (msg: string) => void
): number {
  return matrixPairScore(a, b, OPENNESS_SCORES, 'q_openness', logUnknown)
}

export function hopingForCompatibilityScore(
  a: string | null,
  b: string | null,
  logUnknown?: (msg: string) => void
): number {
  return matrixPairScore(a, b, HOPING_SCORES, 'q_hoping_for', logUnknown)
}

// --- Fika vibe (q_fika_vibe): what kind of conversation they want ---

const FIKA_VIBE_SCORES: Record<string, Record<string, number>> = {
  'Someone who challenges how I think': {
    'Someone who challenges how I think': 1.0,
    'Good laughs, easy conversation': 0.25,
    'Real talk, no performance': 0.80,
    'A totally different perspective': 0.75,
    "Wherever it goes, I'm in": 0.70,
  },
  'Good laughs, easy conversation': {
    'Good laughs, easy conversation': 1.0,
    'Real talk, no performance': 0.50,
    'A totally different perspective': 0.65,
    "Wherever it goes, I'm in": 0.75,
  },
  'Real talk, no performance': {
    'Real talk, no performance': 1.0,
    'A totally different perspective': 0.75,
    "Wherever it goes, I'm in": 0.75,
  },
  'A totally different perspective': {
    'A totally different perspective': 0.75,
    "Wherever it goes, I'm in": 0.80,
  },
  "Wherever it goes, I'm in": {
    "Wherever it goes, I'm in": 0.70,
  },
}

export function fikaVibeCompatibilityScore(
  a: string | null,
  b: string | null,
  logUnknown?: (msg: string) => void
): number {
  return matrixPairScore(a, b, FIKA_VIBE_SCORES, 'q_fika_vibe', logUnknown)
}

// --- Social style (q_social_style): personality fit for 1-on-1 Fika ---

const SOCIAL_STYLE_SCORES: Record<string, Record<string, number>> = {
  'The one starting conversations': {
    'The one starting conversations': 0.70,
    'Warm once comfortable, slow to open up': 0.90,
    'More one-on-one than group': 0.80,
    'Depends on the day': 0.80,
  },
  'Warm once comfortable, slow to open up': {
    'Warm once comfortable, slow to open up': 0.70,
    'More one-on-one than group': 0.85,
    'Depends on the day': 0.75,
  },
  'More one-on-one than group': {
    'More one-on-one than group': 0.95,
    'Depends on the day': 0.80,
  },
  'Depends on the day': {
    'Depends on the day': 0.75,
  },
}

export function socialStyleCompatibilityScore(
  a: string | null,
  b: string | null,
  logUnknown?: (msg: string) => void
): number {
  return matrixPairScore(a, b, SOCIAL_STYLE_SCORES, 'q_social_style', logUnknown)
}

// --- Life chapter (multi_select): cluster → cluster compatibility ---

export type LifeCluster =
  | 'education'
  | 'early_career'
  | 'mid_career'
  | 'independent'
  | 'family'
  | 'pause'
  | 'retire'

const LIFE_CHAPTER_TO_CLUSTER: Record<string, LifeCluster> = {
  "I'm in college or university": 'education',
  "I'm in graduate school": 'education',
  'I recently graduated': 'early_career',
  "I'm early in my career": 'early_career',
  "I'm transitioning into a new career": 'early_career',
  'I recently moved to this city': 'early_career',
  "I'm exploring a new direction": 'early_career',
  "I'm growing in my career": 'mid_career',
  "I'm established in my career": 'mid_career',
  "I'm building something (startup, project, business)": 'independent',
  "I'm working independently or freelancing": 'independent',
  'I recently got married or entered a long-term partnership': 'family',
  "I'm starting a family": 'family',
  "I'm raising kids": 'family',
  "I'm caring for family members": 'family',
  "I'm taking time to figure out what's next": 'pause',
  "I'm taking a break or sabbatical": 'pause',
  "I'm semi-retired": 'retire',
  "I'm retired": 'retire',
}

const LIFE_CLUSTER_MATRIX: Record<LifeCluster, Record<LifeCluster, number>> = {
  education: {
    education: 1,
    early_career: 0.88,
    mid_career: 0.55,
    independent: 0.62,
    family: 0.5,
    pause: 0.58,
    retire: 0.35,
  },
  early_career: {
    education: 0.88,
    early_career: 1,
    mid_career: 0.82,
    independent: 0.78,
    family: 0.62,
    pause: 0.72,
    retire: 0.4,
  },
  mid_career: {
    education: 0.55,
    early_career: 0.82,
    mid_career: 1,
    independent: 0.85,
    family: 0.7,
    pause: 0.55,
    retire: 0.52,
  },
  independent: {
    education: 0.62,
    early_career: 0.78,
    mid_career: 0.85,
    independent: 1,
    family: 0.58,
    pause: 0.65,
    retire: 0.48,
  },
  family: {
    education: 0.5,
    early_career: 0.62,
    mid_career: 0.7,
    independent: 0.58,
    family: 1,
    pause: 0.52,
    retire: 0.45,
  },
  pause: {
    education: 0.58,
    early_career: 0.72,
    mid_career: 0.55,
    independent: 0.65,
    family: 0.52,
    pause: 1,
    retire: 0.6,
  },
  retire: {
    education: 0.35,
    early_career: 0.4,
    mid_career: 0.52,
    independent: 0.48,
    family: 0.45,
    pause: 0.6,
    retire: 1,
  },
}

function lifeClusterForLabel(label: string, logUnknown?: (msg: string) => void): LifeCluster | null {
  const c = LIFE_CHAPTER_TO_CLUSTER[label]
  if (!c) {
    logUnknown?.(`[fika-matcher] Unknown q_life_chapter label: ${JSON.stringify(label)}`)
    return null
  }
  return c
}

function lifeClusterPairScore(ca: LifeCluster | null, cb: LifeCluster | null): number {
  if (!ca || !cb) return 0.5
  return LIFE_CLUSTER_MATRIX[ca][cb] ?? 0.5
}

/** Average matrix compatibility over all selected chapter pairs (multi × multi). */
export function lifeChapterMultiCompatibility(
  responsesA: unknown,
  responsesB: unknown,
  logUnknown?: (msg: string) => void
): number {
  const sa = getIntakeMulti(responsesA, 'q_life_chapter')
  const sb = getIntakeMulti(responsesB, 'q_life_chapter')
  if (sa.length === 0 || sb.length === 0) return 0.5
  let sum = 0
  let n = 0
  for (const la of sa) {
    const ca = lifeClusterForLabel(la, logUnknown)
    for (const lb of sb) {
      const cb = lifeClusterForLabel(lb, logUnknown)
      sum += lifeClusterPairScore(ca, cb)
      n++
    }
  }
  return n > 0 ? sum / n : 0.5
}

// --- Everyday anchor (multi_select): cluster matrix ---

export type AnchorCluster =
  | 'work_school'
  | 'family_care'
  | 'social'
  | 'health_creative'
  | 'faith_travel'
  | 'other'

const ANCHOR_TO_CLUSTER: Record<string, AnchorCluster> = {
  Work: 'work_school',
  'Side hustles': 'work_school',
  'Job search': 'work_school',
  School: 'work_school',
  'Family life': 'family_care',
  Parenting: 'family_care',
  'Family caregiving': 'family_care',
  'Romantic relationship': 'social',
  'Close friendships': 'social',
  'Community or volunteering': 'social',
  'Fitness routine': 'health_creative',
  'Creative projects': 'health_creative',
  'Faith or spiritual practice': 'faith_travel',
  Travel: 'faith_travel',
  'Something else': 'other',
}

const ANCHOR_CLUSTER_MATRIX: Record<AnchorCluster, Record<AnchorCluster, number>> = {
  work_school: {
    work_school: 1,
    family_care: 0.62,
    social: 0.72,
    health_creative: 0.68,
    faith_travel: 0.65,
    other: 0.55,
  },
  family_care: {
    work_school: 0.62,
    family_care: 1,
    social: 0.7,
    health_creative: 0.58,
    faith_travel: 0.55,
    other: 0.52,
  },
  social: {
    work_school: 0.72,
    family_care: 0.7,
    social: 1,
    health_creative: 0.75,
    faith_travel: 0.78,
    other: 0.62,
  },
  health_creative: {
    work_school: 0.68,
    family_care: 0.58,
    social: 0.75,
    health_creative: 1,
    faith_travel: 0.7,
    other: 0.6,
  },
  faith_travel: {
    work_school: 0.65,
    family_care: 0.55,
    social: 0.78,
    health_creative: 0.7,
    faith_travel: 1,
    other: 0.58,
  },
  other: {
    work_school: 0.55,
    family_care: 0.52,
    social: 0.62,
    health_creative: 0.6,
    faith_travel: 0.58,
    other: 0.65,
  },
}

function anchorClusterPairScore(ca: AnchorCluster | null, cb: AnchorCluster | null): number {
  if (!ca || !cb) return 0.5
  return ANCHOR_CLUSTER_MATRIX[ca][cb] ?? 0.5
}

function anchorClusterForLabel(label: string, logUnknown?: (msg: string) => void): AnchorCluster | null {
  const c = ANCHOR_TO_CLUSTER[label]
  if (!c) {
    logUnknown?.(`[fika-matcher] Unknown q_everyday_anchor label: ${JSON.stringify(label)}`)
    return null
  }
  return c
}

export function everydayAnchorMultiCompatibility(
  responsesA: unknown,
  responsesB: unknown,
  logUnknown?: (msg: string) => void
): number {
  const sa = getIntakeMulti(responsesA, 'q_everyday_anchor')
  const sb = getIntakeMulti(responsesB, 'q_everyday_anchor')
  if (sa.length === 0 || sb.length === 0) return 0.5
  let sum = 0
  let n = 0
  for (const la of sa) {
    const ca = anchorClusterForLabel(la, logUnknown)
    for (const lb of sb) {
      const cb = anchorClusterForLabel(lb, logUnknown)
      sum += anchorClusterPairScore(ca, cb)
      n++
    }
  }
  return n > 0 ? sum / n : 0.5
}
