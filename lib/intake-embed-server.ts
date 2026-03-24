import type { SupabaseClient } from '@supabase/supabase-js'
import { buildIntakeEmbeddingText } from '@/lib/intake-embedding-text'
import type { IntakeResponseItem } from '@/lib/db-types'

async function fetchOpenAiEmbedding(text: string, apiKey: string): Promise<number[]> {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: text,
    }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`OpenAI embeddings failed: ${res.status} ${err}`)
  }
  const data = await res.json()
  const embedding = data?.data?.[0]?.embedding
  if (!Array.isArray(embedding)) throw new Error('OpenAI did not return an embedding array')
  return embedding
}

/**
 * Reads intake_responses_v5, builds embedding text, calls OpenAI, writes embed_vector.
 * Used by complete-intake and merge-sms-signup so SMS onboarding also gets a vector.
 */
export async function computeAndStoreIntakeEmbedding(
  supabase: SupabaseClient,
  userId: string,
  openaiKey: string
): Promise<{ ok: true; embedded: boolean; completedAt: string } | { ok: false; error: string }> {
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
  const text = buildIntakeEmbeddingText(responses)
  const completedAt = new Date().toISOString()

  if (text.trim()) {
    try {
      const embedding = await fetchOpenAiEmbedding(text, openaiKey.trim())
      const { error: updateError } = await supabase
        .from('intake_responses_v5')
        .update({
          embed_vector: JSON.stringify(embedding),
          completed_at: completedAt,
          updated_at: completedAt,
        })
        .eq('user_id', userId)
      if (updateError) return { ok: false, error: updateError.message }
      return { ok: true, embedded: true, completedAt }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Embedding failed' }
    }
  }

  const { error: updateError } = await supabase
    .from('intake_responses_v5')
    .update({
      completed_at: completedAt,
      updated_at: completedAt,
    })
    .eq('user_id', userId)
  if (updateError) return { ok: false, error: updateError.message }
  return { ok: true, embedded: false, completedAt }
}
