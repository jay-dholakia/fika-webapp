/**
 * Normalize intake `responses` whether stored as a JSON array of { question_id, answer }
 * or a legacy flat record. Used by matching, radius, and other intake readers.
 */

export type IntakeResponseArrayItem = { question_id?: string; answer?: unknown }

function normalizeAnswer(value: unknown): unknown {
  if (value === 'N/A') return null
  if (Array.isArray(value) && value.length === 1 && value[0] === 'N/A') return null
  return value ?? null
}

/** Read one answer from intake responses (array or record shape). */
export function getIntakeAnswer(responses: unknown, questionId: string): unknown {
  if (responses == null) return null
  if (Array.isArray(responses)) {
    const r = (responses as IntakeResponseArrayItem[]).find((x) => x?.question_id === questionId)
    return normalizeAnswer(r?.answer)
  }
  if (typeof responses === 'object') {
    return normalizeAnswer((responses as Record<string, unknown>)[questionId])
  }
  return null
}

/** Multi-select or single string → string list (deduped, trimmed). */
export function getIntakeMulti(responses: unknown, questionId: string): string[] {
  const v = getIntakeAnswer(responses, questionId)
  if (Array.isArray(v)) {
    const out = v.map((x) => String(x).trim()).filter(Boolean)
    return Array.from(new Set(out))
  }
  if (typeof v === 'string' && v.trim()) return [v.trim()]
  return []
}

/** First value for chips_single / searchable_single. */
export function getIntakeSingle(responses: unknown, questionId: string): string | null {
  const v = getIntakeAnswer(responses, questionId)
  if (v == null) return null
  if (typeof v === 'string') {
    const t = v.trim()
    return t || null
  }
  if (typeof v === 'number') return String(v)
  if (Array.isArray(v) && v.length > 0) return String(v[0]).trim() || null
  return null
}
