/**
 * `q_work` values that describe life between roles, caregiving, or other situations
 * we do not surface as a noun after "a/an" in intro SMS, and we do not use to penalize match work-fit.
 *
 * Aligned with the inclusive + flexible-work block at the top of `WORK_ROLE_PRIORITY` in `work-role-options.ts`
 * (through "Work visa / limited work authorization", before founders/leadership).
 */

const NORMALIZED_EXACT = new Set(
  [
    'Currently unemployed',
    'Between jobs',
    'Stay-at-home parent',
    'Full-time caregiver at home',
    'Retired',
    'Gig worker',
    'Freelancer',
    'Independent contractor',
    'Part-time worker',
    'Seasonal worker',
    'Working night shifts',
    'Apprentice',
    'AmeriCorps member',
    'Between contracts',
    'Work visa / limited work authorization',
  ].map((s) => s.trim().toLowerCase().replace(/\s+/g, ' '))
)

/** Custom or near-miss titles that should follow the same omit / neutral-score rules. */
const SENSITIVE_PHRASE_RES = [
  /\bcurrently\s+unemployed\b/i,
  /\bunemployed\b/i,
  /\blaid[\s-]?off\b/i,
  /\bfurloughed\b/i,
  /\bbetween\s+jobs\b/i,
  /\bjob\s+search\b/i,
  /\bseeking\s+(work|employment|a\s+role|opportunities)\b/i,
  /\bout\s+of\s+work\b/i,
  /\bin\s+transition\b/i,
  /\bwork\s+visa\s*\/\s*limited\b/i,
]

export function normalizeWorkIntakeLabel(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** True when this `q_work` answer should not appear in intro-style copy or drive work-fit distance. */
export function isSensitiveWorkIntakeLabel(label: string | null | undefined): boolean {
  if (label == null) return false
  const key = normalizeWorkIntakeLabel(String(label))
  if (!key) return false
  if (NORMALIZED_EXACT.has(key)) return true
  for (const re of SENSITIVE_PHRASE_RES) {
    if (re.test(key)) return true
  }
  return false
}
