import type { IntakeResponseItem } from '@/lib/db-types'
import { INTAKE_ANSWER_SKIPPED } from '@/lib/intro-detail'
import { INTAKE_STEPS } from '@/lib/onboarding-data'

/**
 * Intake question IDs omitted from embedding text: hard-matching filters on profile/intake,
 * distance, hoping-for gate, or non-semantic confirmation.
 * Align with `passesFilters` in `app/api/admin/match-sim/route.ts` + radius.
 */
export const INTAKE_EMBEDDING_EXCLUDED_IDS = new Set<string>([
  'gender_preference',
  'age_preference',
  'q_radius',
  'q_hoping_for',
  'confirm_intent',
  // Demographics / roots — keep out of similarity embedding
  'q_home_country',
  'q_home_state',
  'q_hometown',
  'q_ethnicity',
])

function responseById(responses: IntakeResponseItem[]): Map<string, IntakeResponseItem> {
  const m = new Map<string, IntakeResponseItem>()
  for (const r of responses) {
    if (r?.question_id) m.set(r.question_id, r)
  }
  return m
}

function formatAnswerForEmbedding(answer: string | number | string[] | undefined): string | null {
  if (answer == null) return null
  if (answer === INTAKE_ANSWER_SKIPPED) return null
  if (typeof answer === 'number') {
    const s = String(answer).trim()
    return s || null
  }
  if (typeof answer === 'string') {
    const t = answer.trim()
    if (!t || t === 'N/A') return null
    return t
  }
  if (Array.isArray(answer)) {
    const filtered = answer
      .map((x) => String(x).trim())
      .filter((x) => x && x !== INTAKE_ANSWER_SKIPPED && x !== 'N/A')
    return filtered.length ? filtered.join(', ') : null
  }
  return null
}

/**
 * Flat text for `text-embedding-3-small`, built from current intake steps in product order.
 * Excludes filter-only fields so the vector reflects “who they are / what a good Fika is,”
 * not attributes already enforced by hard filters.
 */
export function buildIntakeEmbeddingText(responses: IntakeResponseItem[]): string {
  const byId = responseById(responses)
  const parts: string[] = []
  for (const step of INTAKE_STEPS) {
    if (INTAKE_EMBEDDING_EXCLUDED_IDS.has(step.id)) continue
    const r = byId.get(step.id)
    if (!r) continue
    const formatted = formatAnswerForEmbedding(r.answer)
    if (!formatted) continue
    const label = step.question.trim()
    parts.push(`${label}: ${formatted}`)
  }
  return parts.join('\n\n')
}
