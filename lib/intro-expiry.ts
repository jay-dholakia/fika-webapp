import type { SupabaseClient } from '@supabase/supabase-js'
import { INTRO_OFFER_WINDOW_MS } from '@/lib/intro-eligibility'

const POSITIVE_MATCH_DECISIONS = new Set(['opt_in', 'yes'])

function mutualMatchOptInFromRows(
  rows: Array<{ user_id?: string | null; decision?: string | null }>,
  userA: string,
  userB: string
): boolean {
  let aOk = false
  let bOk = false
  for (const r of rows) {
    const uid = r.user_id as string | undefined
    const dec = typeof r.decision === 'string' ? r.decision : ''
    if (!POSITIVE_MATCH_DECISIONS.has(dec)) continue
    if (uid === userA) aOk = true
    if (uid === userB) bOk = true
  }
  return aOk && bOk
}

/**
 * Removes stale `match_offered` SMS rows past the intro-offer window so users become eligible again.
 */
export async function expireStaleIntroOffers(
  supabase: SupabaseClient
): Promise<{ deleted: number }> {
  const cutoff = Date.now() - INTRO_OFFER_WINDOW_MS
  const { data: rows, error } = await supabase
    .from('sms_conversation_states')
    .select('id, intro_offer_sent_at, updated_at')
    .eq('state', 'match_offered')
    .not('match_id', 'is', null)

  if (error) throw new Error(error.message)

  const staleIds = (rows ?? [])
    .filter((r) => {
      const raw = r.intro_offer_sent_at ?? r.updated_at
      if (!raw) return false
      const t = new Date(raw).getTime()
      return Number.isFinite(t) && t <= cutoff
    })
    .map((r) => r.id as string)

  if (staleIds.length === 0) return { deleted: 0 }

  const { error: delErr } = await supabase.from('sms_conversation_states').delete().in('id', staleIds)
  if (delErr) throw new Error(delErr.message)
  return { deleted: staleIds.length }
}

/**
 * Expires active matches past `match_opt_in_deadline_at` when scheduling is not confirmed and mutual opt_ins are missing.
 */
export async function expireMissedMatchOptIns(
  supabase: SupabaseClient
): Promise<{ expired: number }> {
  const nowIso = new Date().toISOString()
  const { data: candidates, error } = await supabase
    .from('match_candidates')
    .select('id, user_a, user_b, scheduling_status')
    .eq('status', 'active')
    .not('match_opt_in_deadline_at', 'is', null)
    .lt('match_opt_in_deadline_at', nowIso)

  if (error) throw new Error(error.message)

  let expired = 0
  for (const m of candidates ?? []) {
    const ss = (m as { scheduling_status?: string | null }).scheduling_status
    if (ss === 'confirmed') continue

    const id = m.id as string
    const userA = m.user_a as string
    const userB = m.user_b as string

    const { data: optRows } = await supabase.from('opt_ins').select('user_id, decision').eq('match_id', id)

    if (mutualMatchOptInFromRows(optRows ?? [], userA, userB)) continue

    const { error: upErr } = await supabase
      .from('match_candidates')
      .update({
        status: 'expired',
        scheduling_status: 'expired',
      })
      .eq('id', id)
      .eq('status', 'active')

    if (!upErr) expired++
  }

  return { expired }
}
