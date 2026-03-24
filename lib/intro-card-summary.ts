import type { IntakeResponseItem } from '@/lib/db-types'
import { formatIntakeAnswer, filterSafeIntakeResponses } from '@/lib/intro-detail'

/** Stored on intake_responses_v5.intro_card_summary and used by IntroDetailModal. */
export type IntroCardSummary = {
  paragraph: string
  bullets: string[]
  /** How the copy was produced (for debugging; not shown in UI). */
  source?: 'openai' | 'fallback'
}

export function parseIntroCardSummary(raw: unknown): IntroCardSummary | null {
  if (raw == null || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const paragraph = typeof o.paragraph === 'string' ? o.paragraph.trim() : ''
  const bulletsIn = o.bullets
  const bullets: string[] = []
  if (Array.isArray(bulletsIn)) {
    for (const b of bulletsIn) {
      if (typeof b === 'string' && b.trim()) bullets.push(b.trim())
    }
  }
  if (!paragraph && bullets.length === 0) return null
  const source = o.source === 'openai' || o.source === 'fallback' ? o.source : undefined
  return { paragraph, bullets, source }
}

function getAnswer(responses: IntakeResponseItem[], id: string): string | null {
  const r = responses.find((x) => x.question_id === id)
  if (!r?.answer) return null
  const s = formatIntakeAnswer(r.answer).trim()
  return s || null
}

/**
 * Deterministic copy when OpenAI is unavailable or skipped.
 * Uses only safe intake fields already shown elsewhere in the product.
 */
export function buildIntroCardFallback(responses: IntakeResponseItem[]): IntroCardSummary {
  const safe = filterSafeIntakeResponses(responses)
  const life = getAnswer(safe, 'q_life_chapter')
  const work = getAnswer(safe, 'q_work')
  const anchor = getAnswer(safe, 'q_everyday_anchor')
  const interests = getAnswer(safe, 'q_interests')
  const curiosity = getAnswer(safe, 'q_curiosity')
  const hoping = getAnswer(safe, 'q_hoping_for')
  const openness = getAnswer(safe, 'q_openness')

  const paragraphParts: string[] = []
  if (life) {
    paragraphParts.push(`They're in a life chapter that includes: ${life}.`)
  }
  if (work) {
    paragraphParts.push(`For work: ${work}.`)
  } else if (anchor && !life) {
    paragraphParts.push(`Day-to-day life is anchored by ${anchor.toLowerCase()}.`)
  }
  if (paragraphParts.length === 0 && interests) {
    paragraphParts.push(`Some interests: ${interests}.`)
  }
  const paragraph =
    paragraphParts.join(' ').trim() ||
    'They shared answers in intake — see below for more.'

  const bullets: string[] = []
  if (work) bullets.push(`Work: ${work}`)
  if (anchor) bullets.push(`Day-to-day: ${anchor}`)
  if (interests) bullets.push(`Interests: ${interests}`)
  if (curiosity) bullets.push(`Curious about: ${curiosity}`)
  if (hoping) bullets.push(`Hoping for: ${hoping}`)
  if (openness) bullets.push(`Open to: ${openness}`)
  if (life && bullets.length < 4) bullets.unshift(`Life chapter: ${life}`)

  const deduped: string[] = []
  const seen = new Set<string>()
  for (const b of bullets) {
    const key = b.slice(0, 120)
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(b)
    if (deduped.length >= 4) break
  }

  return {
    paragraph,
    bullets: deduped,
    source: 'fallback',
  }
}
