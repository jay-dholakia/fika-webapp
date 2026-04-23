import type { SupabaseClient } from '@supabase/supabase-js'
import { computeAndStoreIntroCardSummary } from '@/lib/intro-card-summary-server'

/**
 * Finalizes intake completion (`completed_at` / `updated_at`) and optionally
 * refreshes `intro_card_summary` via OpenAI chat when `openaiKey` is set.
 *
 * **Embeddings are intentionally disabled** — we do not call OpenAI embeddings
 * or write `embed_vector` (legacy vectors in the DB are left unchanged).
 */
export async function computeAndStoreIntakeEmbedding(
  supabase: SupabaseClient,
  userId: string,
  openaiKey?: string | null
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

  const completedAt = new Date().toISOString()
  const { error: updateError } = await supabase
    .from('intake_responses_v5')
    .update({
      completed_at: completedAt,
      updated_at: completedAt,
    })
    .eq('user_id', userId)

  if (updateError) return { ok: false, error: updateError.message }

  const key = openaiKey?.trim()
  if (key) {
    try {
      await computeAndStoreIntroCardSummary(supabase, userId, key)
    } catch {
      /* non-fatal */
    }
  }

  return { ok: true, embedded: false, completedAt }
}
