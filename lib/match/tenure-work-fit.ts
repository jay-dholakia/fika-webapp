import { getIntakeSingle } from '@/lib/intake-response-utils'
import { MARKET_TENURE_OPTIONS } from '@/lib/onboarding-data'
import { inferWorkFamily, workFamilyAffinity } from '@/lib/match/work-role-family'
import { isSensitiveWorkIntakeLabel } from '@/lib/work-sensitive-intake'

/** Label → index along `MARKET_TENURE_OPTIONS` (newer on the left). */
const MARKET_TENURE_INDEX = new Map<string, number>(
  MARKET_TENURE_OPTIONS.map((label, i) => [label, i])
)

/** Inclusive index: "Just moved", "<6 months", "6mo–1yr" — treat as new-to-area band. */
const MARKET_TENURE_NEWISH_MAX_INDEX = 2

const WORK_STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'in',
  'is',
  'it',
  'my',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
  'i',
  'ii',
  'iii',
  'iv',
  'am',
  'me',
  'we',
  'our',
])

/**
 * Similar tenure → higher score; bucket distance decays smoothly.
 * When **both** are in the "new to the area" band, add a small lift so
 * "both figuring the city out" ranks a bit higher (still capped at 1).
 */
export function marketTenureFitScore(responsesA: unknown, responsesB: unknown): number {
  const a = getIntakeSingle(responsesA, 'q_market_tenure')
  const b = getIntakeSingle(responsesB, 'q_market_tenure')
  if (!a || !b) return 0.5
  const ia = MARKET_TENURE_INDEX.get(a)
  const ib = MARKET_TENURE_INDEX.get(b)
  if (ia === undefined || ib === undefined) return 0.5
  const dist = Math.abs(ia - ib)
  const base = dist === 0 ? 1 : Math.max(0.38, 1 - 0.11 * dist)
  const bothNewish = ia <= MARKET_TENURE_NEWISH_MAX_INDEX && ib <= MARKET_TENURE_NEWISH_MAX_INDEX
  return bothNewish ? Math.min(1, base + 0.1) : base
}

function normalizeWorkLabel(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

function workTokens(raw: string): string[] {
  return normalizeWorkLabel(raw)
    .split(/[^a-z0-9+]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !WORK_STOPWORDS.has(t))
}

/** Levenshtein distance ≤ 1 only for modest-length tokens (cheap typo / plural-ish). */
function editDistanceAtMost1(a: string, b: string): boolean {
  if (a === b) return true
  const la = a.length
  const lb = b.length
  if (Math.abs(la - lb) > 1) return false
  let i = 0
  let j = 0
  let edits = 0
  while (i < la && j < lb) {
    if (a[i] === b[j]) {
      i++
      j++
      continue
    }
    edits++
    if (edits > 1) return false
    if (la > lb) i++
    else if (lb > la) j++
    else {
      i++
      j++
    }
  }
  return edits + (la - i) + (lb - j) <= 1
}

function tokensRoughlyMatch(ta: string, tb: string): boolean {
  if (ta === tb) return true
  const shorter = ta.length <= tb.length ? ta : tb
  const longer = ta.length > tb.length ? ta : tb
  if (shorter.length >= 4 && longer.startsWith(shorter)) return true
  if (ta.length <= 12 && tb.length <= 12) return editDistanceAtMost1(ta, tb)
  return false
}

/** Greedy one-to-one fuzzy matches between token lists. */
function fuzzyTokenMatchCount(tokensA: string[], tokensB: string[]): number {
  const usedB = new Set<number>()
  let hits = 0
  for (const ta of tokensA) {
    for (let j = 0; j < tokensB.length; j++) {
      if (usedB.has(j)) continue
      if (tokensRoughlyMatch(ta, tokensB[j])) {
        usedB.add(j)
        hits++
        break
      }
    }
  }
  return hits
}

function fuzzyTokenJaccard(rawA: string, rawB: string): number {
  const a = workTokens(rawA)
  const b = workTokens(rawB)
  if (a.length === 0 && b.length === 0) return 0
  if (a.length === 0 || b.length === 0) return 0
  const inter = fuzzyTokenMatchCount(a, b)
  if (inter === 0) return 0
  const union = a.length + b.length - inter
  return union > 0 ? inter / union : 0
}

/** Sørensen–Dice on character bigrams (alphanumeric only). */
function diceBigramCoefficient(a: string, b: string): number {
  const na = normalizeWorkLabel(a).replace(/[^a-z0-9]/g, '')
  const nb = normalizeWorkLabel(b).replace(/[^a-z0-9]/g, '')
  if (na.length < 2 || nb.length < 2) return na === nb ? 1 : 0
  const counts = (s: string) => {
    const m = new Map<string, number>()
    for (let i = 0; i < s.length - 1; i++) {
      const bg = s.slice(i, i + 2)
      m.set(bg, (m.get(bg) ?? 0) + 1)
    }
    return m
  }
  const A = counts(na)
  const B = counts(nb)
  let inter = 0
  Array.from(A.entries()).forEach(([bg, ca]) => {
    const cb = B.get(bg) ?? 0
    if (cb > 0) inter += Math.min(ca, cb)
  })
  const totalA = Array.from(A.values()).reduce((s, n) => s + n, 0)
  const totalB = Array.from(B.values()).reduce((s, n) => s + n, 0)
  if (totalA + totalB === 0) return 0
  return (2 * inter) / (totalA + totalB)
}

/** One normalized title contains the other (e.g. "teacher" inside "substitute teacher"). */
function containmentWorkScore(a: string, b: string): number {
  const na = normalizeWorkLabel(a)
  const nb = normalizeWorkLabel(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  if (na.includes(nb)) {
    return 0.72 + 0.26 * Math.min(1, nb.length / Math.max(na.length, 1))
  }
  if (nb.includes(na)) {
    return 0.72 + 0.26 * Math.min(1, na.length / Math.max(nb.length, 1))
  }
  return 0
}

/**
 * 0–1 similarity for two work strings (list picks or custom titles).
 * Blends fuzzy token Jaccard, character bigram Dice, and substring containment.
 */
export function workLabelSimilarity(va: string, vb: string): number {
  const na = normalizeWorkLabel(va)
  const nb = normalizeWorkLabel(vb)
  if (na === nb) return 1

  const jac = fuzzyTokenJaccard(va, vb)
  const dice = diceBigramCoefficient(va, vb)
  const sub = containmentWorkScore(va, vb)
  const blended = 0.42 * jac + 0.38 * dice + 0.2 * sub
  const textual = Math.max(jac, dice, sub, blended)
  const family = workFamilyAffinity(inferWorkFamily(va), inferWorkFamily(vb))
  const peak = Math.max(textual, family)
  return Math.min(1, Math.max(0.08, peak))
}

/**
 * Work fit for `q_work`: gradual similarity between titles (not only exact string match).
 * Either side missing → neutral 0.5.
 */
export function workFitScore(responsesA: unknown, responsesB: unknown): number {
  const va = getIntakeSingle(responsesA, 'q_work')
  const vb = getIntakeSingle(responsesB, 'q_work')
  if (!va || !vb) return 0.5
  if (isSensitiveWorkIntakeLabel(va) || isSensitiveWorkIntakeLabel(vb)) return 0.5
  return workLabelSimilarity(va, vb)
}
