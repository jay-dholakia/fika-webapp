/**
 * SMS + DB side effects for cancel/retry flow (shared by webhook and cron).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { sendConcierge } from '@/lib/sendblue'
import { insertMessageLedger } from '@/lib/message-ledger'
import {
  messageCancelRetryBothYes,
  messageCancelRetryClosed,
  messageCancelRetryNudge,
} from '@/lib/sms-agent'
import {
  type CancelRetryFlowJson,
  markResolved,
  applyDeadlineDefaults,
  outcomeFromDecisions,
  CANCEL_RETRY_SCHEDULING_STATUS,
} from '@/lib/cancel-retry-flow'

export async function completeCancelRetryMatch(
  supabase: SupabaseClient,
  match: { id: string; user_a: string; user_b: string },
  flow: CancelRetryFlowJson,
  outcome: 'both_yes' | 'closed'
): Promise<void> {
  const resolved = markResolved(flow, outcome)
  const { error } = await supabase
    .from('match_candidates')
    .update({
      scheduling_status: 'expired',
      cancel_retry_flow: resolved as unknown as Record<string, unknown>,
    })
    .eq('id', match.id)
  if (error) {
    console.error('[cancel-retry-notify] update match failed', error)
    throw new Error(error.message)
  }

  const body = outcome === 'both_yes' ? messageCancelRetryBothYes() : messageCancelRetryClosed()
  const { data: profs } = await supabase
    .from('profiles')
    .select('id, phone')
    .in('id', [match.user_a, match.user_b])

  const phoneBy = (profs ?? []).reduce<Record<string, string>>((acc, p) => {
    const ph = (p.phone as string | null)?.trim()
    if (ph) acc[p.id as string] = ph
    return acc
  }, {})

  for (const uid of [match.user_a, match.user_b]) {
    const phone = phoneBy[uid]
    if (!phone) continue
    const result = await sendConcierge(phone, body)
    if (!result.ok) {
      console.error('[cancel-retry-notify] send failed', { matchId: match.id, uid, error: result.error })
      continue
    }
    await insertMessageLedger(supabase, {
      user_id: uid,
      direction: 'outbound',
      peer_phone: phone,
      content_snippet: body,
      context:
        outcome === 'both_yes' ? 'cancel_retry_resolved_both_yes' : 'cancel_retry_resolved_closed',
      message_handle: result.message_handle ?? null,
      match_id: match.id,
    })
  }
}

/** Send nudge to any participant still missing a YES/NO; sets nudge_sent_at once. */
export async function sendCancelRetryNudgeIfDue(
  supabase: SupabaseClient,
  match: { id: string; user_a: string; user_b: string },
  flow: CancelRetryFlowJson
): Promise<CancelRetryFlowJson | null> {
  if (flow.nudge_sent_at != null) return null
  const now = Date.now()
  if (new Date(flow.nudge_after_at).getTime() > now) return null

  const pending: string[] = []
  if (flow.user_a_retry === null) pending.push(match.user_a)
  if (flow.user_b_retry === null) pending.push(match.user_b)
  if (pending.length === 0) return null

  const { data: profs } = await supabase.from('profiles').select('id, phone').in('id', pending)
  const phoneBy = (profs ?? []).reduce<Record<string, string>>((acc, p) => {
    const ph = (p.phone as string | null)?.trim()
    if (ph) acc[p.id as string] = ph
    return acc
  }, {})

  const msg = messageCancelRetryNudge()
  for (const uid of pending) {
    const phone = phoneBy[uid]
    if (!phone) continue
    const result = await sendConcierge(phone, msg)
    if (!result.ok) {
      console.error('[cancel-retry-notify] nudge send failed', { matchId: match.id, uid, error: result.error })
      continue
    }
    await insertMessageLedger(supabase, {
      user_id: uid,
      direction: 'outbound',
      peer_phone: phone,
      content_snippet: msg,
      context: 'cancel_retry_nudge',
      message_handle: result.message_handle ?? null,
      match_id: match.id,
    })
  }

  const next: CancelRetryFlowJson = {
    ...flow,
    nudge_sent_at: new Date().toISOString(),
  }
  const { error } = await supabase
    .from('match_candidates')
    .update({ cancel_retry_flow: next as unknown as Record<string, unknown> })
    .eq('id', match.id)
    .eq('scheduling_status', CANCEL_RETRY_SCHEDULING_STATUS)
  if (error) {
    console.error('[cancel-retry-notify] nudge persist failed', error)
    return null
  }
  return next
}

/** After deadline: default null → NO, resolve, notify. Returns true if this row was finalized. */
export async function finalizeCancelRetryIfDeadlinePassed(
  supabase: SupabaseClient,
  match: { id: string; user_a: string; user_b: string },
  flow: CancelRetryFlowJson
): Promise<boolean> {
  if (new Date(flow.deadline_at).getTime() > Date.now()) return false

  const withDefaults = applyDeadlineDefaults(flow)
  const outcome = outcomeFromDecisions(withDefaults)
  if (!outcome) return false

  await completeCancelRetryMatch(supabase, match, withDefaults, outcome)
  return true
}
