import type { SupabaseClient } from '@supabase/supabase-js'
import type { IntakeResponseItem } from '@/lib/db-types'
import { buildIntroCardFallback, type IntroCardSummary } from '@/lib/intro-card-summary'
import { formatIntakeAnswer } from '@/lib/intro-detail'

function factsPayloadForPrompt(responses: IntakeResponseItem[]): Record<string, string | null> {
  const byId = new Map(responses.map((r) => [r.question_id, r]))
  const str = (id: string) => {
    const r = byId.get(id)
    if (!r?.answer) return null
    const s = formatIntakeAnswer(r.answer).trim()
    return s || null
  }
  return {
    life_chapter: str('q_life_chapter'),
    work: str('q_work'),
    everyday_anchor: str('q_everyday_anchor'),
    interests: str('q_interests'),
    curiosity: str('q_curiosity'),
    like_talking_about: str('q_like_talking_about'),
    openness: str('q_openness'),
    what_makes_great_fika: str('q_what_makes_great_fika'),
  }
}

async function fetchOpenAiIntroSummary(
  facts: Record<string, string | null>,
  apiKey: string
): Promise<IntroCardSummary | null> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You write short intro cards for people meeting in person. Rules:
- Use ONLY facts present in the user JSON. Never invent employer, job title, city, education, or relationship details.
- If a field is null or missing, omit it; do not guess.
- Output valid JSON with keys: paragraph (string, max 2 short sentences), bullets (array of 2-4 short strings, each one scannable line).
- Friendly, warm, third person ("they"). No marketing hype.`,
        },
        {
          role: 'user',
          content: JSON.stringify({ facts }),
        },
      ],
    }),
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`OpenAI chat failed: ${res.status} ${t}`)
  }
  const data = await res.json()
  const text = data?.choices?.[0]?.message?.content
  if (typeof text !== 'string' || !text.trim()) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    return null
  }
  if (parsed == null || typeof parsed !== 'object') return null
  const o = parsed as Record<string, unknown>
  const paragraph = typeof o.paragraph === 'string' ? o.paragraph.trim() : ''
  const bulletsIn = o.bullets
  const bullets: string[] = []
  if (Array.isArray(bulletsIn)) {
    for (const b of bulletsIn) {
      if (typeof b === 'string' && b.trim()) bullets.push(b.trim().slice(0, 280))
    }
  }
  if (!paragraph && bullets.length === 0) return null
  return { paragraph, bullets: bullets.slice(0, 4), source: 'openai' }
}

/**
 * Builds intro card copy (OpenAI when possible) and persists to intake_responses_v5.intro_card_summary.
 * Safe to call after embedding; failures fall back to structured intake lines.
 */
export async function computeAndStoreIntroCardSummary(
  supabase: SupabaseClient,
  userId: string,
  openaiKey: string
): Promise<{ ok: true; summary: IntroCardSummary } | { ok: false; error: string }> {
  const { data: row, error: fetchError } = await supabase
    .from('intake_responses_v5')
    .select('responses')
    .eq('user_id', userId)
    .maybeSingle()

  if (fetchError) return { ok: false, error: fetchError.message }
  if (!row?.responses || !Array.isArray(row.responses)) {
    return { ok: false, error: 'No intake responses found' }
  }

  const responses = row.responses as IntakeResponseItem[]
  const fallback = buildIntroCardFallback(responses)
  let summary: IntroCardSummary = fallback

  const facts = factsPayloadForPrompt(responses)
  const hasAnyFact = Object.values(facts).some((v) => v != null && String(v).trim() !== '')
  if (hasAnyFact) {
    try {
      const ai = await fetchOpenAiIntroSummary(facts, openaiKey.trim())
      if (ai && (ai.paragraph || ai.bullets.length > 0)) {
        summary = ai
      }
    } catch {
      summary = fallback
    }
  }

  const updatedAt = new Date().toISOString()
  const { error: updateError } = await supabase
    .from('intake_responses_v5')
    .update({
      intro_card_summary: summary,
      updated_at: updatedAt,
    })
    .eq('user_id', userId)

  if (updateError) return { ok: false, error: updateError.message }
  return { ok: true, summary }
}
