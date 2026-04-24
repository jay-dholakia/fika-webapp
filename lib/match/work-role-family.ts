/**
 * Coarse work “families” for match scoring when titles differ (e.g. UX designer vs software engineer).
 * Complements token/bigram similarity in `tenure-work-fit.ts` — not a taxonomy of every job.
 */

export type WorkFamilyId =
  | 'student_break'
  | 'freelance_gig'
  | 'healthcare'
  | 'education'
  | 'legal'
  | 'finance'
  | 'tech_build'
  | 'gtm_revenue'
  | 'creative_media'
  | 'trades_physical'
  | 'science_academic'

const FAMILY_ORDER: WorkFamilyId[] = [
  'student_break',
  'freelance_gig',
  'healthcare',
  'education',
  'legal',
  'finance',
  'tech_build',
  'gtm_revenue',
  'creative_media',
  'trades_physical',
  'science_academic',
]

/** First matching rule wins (most specific families first). */
const FAMILY_RULES: { family: WorkFamilyId; re: RegExp }[] = [
  {
    family: 'student_break',
    re: /\b(currently unemployed|between jobs|career break|taking a career break|stay-at-home|caregiver at home|on sabbatical|retired|full-time student|college student|grad student|phd student)\b/i,
  },
  {
    family: 'freelance_gig',
    re: /\b(freelancer|freelance|gig worker|independent contractor|1099|between contracts|seasonal worker|part-time worker)\b/i,
  },
  { family: 'healthcare', re: /\b(nurse|rn|np|physician|doctor|surgeon|therapist|dentist|dental|pharmacist|emt|paramedic|hospital|clinic|medical assistant|healthcare)\b/i },
  { family: 'education', re: /\b(teacher|professor|educator|principal|tutor|librarian|school)\b/i },
  { family: 'legal', re: /\b(attorney|lawyer|paralegal|counsel|esquire)\b/i },
  {
    family: 'finance',
    re: /\b(accountant|cpa|bookkeeper|financial advisor|controller|treasury|investment banker|actuary|underwriter|mortgage|loan officer)\b/i,
  },
  {
    family: 'tech_build',
    re: /\b(software|developer|programmer|devops|full[\s-]?stack|front[\s-]?end|back[\s-]?end|web developer|mobile developer|sre\b|site reliability|platform engineer|cloud engineer|data engineer|machine learning|ml engineer|ai engineer|qa engineer|quality assurance|test engineer|automation engineer|embedded|firmware|security engineer|cybersecurity|it support|help desk|sysadmin|systems admin|network engineer|technical writer|scrum master|developer advocate|devrel|solutions engineer|sales engineer|ux\b|ui designer|product designer|interaction designer|content designer|ux researcher|product manager|technical program|programmer|game developer|data scientist|research engineer)\b/i,
  },
  {
    family: 'gtm_revenue',
    re: /\b(marketing|growth marketer|account executive|account manager|customer success|sales manager|business development|bd\b|revops|partnerships|brand manager|seo\b|sem\b)\b/i,
  },
  {
    family: 'creative_media',
    re: /\b(writer|author|journalist|editor|filmmaker|photographer|videographer|graphic designer|motion designer|animator|illustrator|musician|actor|voice actor|youtube|podcast host|social media manager)\b/i,
  },
  { family: 'trades_physical', re: /\b(electrician|plumber|carpenter|hvac|welder|mechanic|construction|roofer|insulator)\b/i },
  {
    family: 'science_academic',
    re: /\b(research scientist|postdoc|postdoctoral|physicist|chemist|biologist|geologist|laboratory scientist|academic researcher)\b/i,
  },
  // Broad “engineer” / “designer” not caught above (e.g. civil engineer) — light touch
  { family: 'tech_build', re: /\b(engineer|engineering manager|designer)\b/i },
]

/** Same-family affinity (both in e.g. tech_build). */
const SAME_FAMILY_SCORE = 0.56

/** Related-but-different families (symmetric). */
const ADJACENT_PAIRS: [WorkFamilyId, WorkFamilyId, number][] = [
  ['tech_build', 'gtm_revenue', 0.36],
  ['tech_build', 'creative_media', 0.32],
  ['tech_build', 'science_academic', 0.34],
  ['gtm_revenue', 'creative_media', 0.26],
  ['finance', 'legal', 0.28],
  ['healthcare', 'science_academic', 0.3],
  ['education', 'science_academic', 0.34],
  ['freelance_gig', 'tech_build', 0.3],
  ['freelance_gig', 'creative_media', 0.28],
  ['student_break', 'freelance_gig', 0.24],
]

const adjacentKey = (a: WorkFamilyId, b: WorkFamilyId) => [a, b].sort().join(':')

const ADJACENT_MAP: Map<string, number> = (() => {
  const m = new Map<string, number>()
  for (const [x, y, s] of ADJACENT_PAIRS) {
    m.set(adjacentKey(x, y), s)
  }
  return m
})()

function normalizeForFamily(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Best-effort single family for a work string (list pick or custom title).
 * Returns null when no rule matches — caller should rely on textual similarity only.
 */
export function inferWorkFamily(label: string): WorkFamilyId | null {
  const t = normalizeForFamily(label)
  if (!t) return null
  for (const { family, re } of FAMILY_RULES) {
    if (re.test(t)) return family
  }
  return null
}

/** 0 when either side unknown; otherwise same-family, adjacent-family, or 0. */
export function workFamilyAffinity(fa: WorkFamilyId | null, fb: WorkFamilyId | null): number {
  if (fa == null || fb == null) return 0
  if (fa === fb) return SAME_FAMILY_SCORE
  return ADJACENT_MAP.get(adjacentKey(fa, fb)) ?? 0
}

export function workFamilyIds(): readonly WorkFamilyId[] {
  return FAMILY_ORDER
}
