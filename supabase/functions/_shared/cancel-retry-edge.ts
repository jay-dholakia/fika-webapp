/**
 * Cancel/retry cron logic for Deno Edge (keep in sync with lib/cancel-retry-flow + lib/cancel-retry-notify).
 */

export const CANCEL_RETRY_SCHEDULING_STATUS = 'cancelled_pending_retry'

export type CancelRetryFlowJson = {
  phase: 'cancel_pending_retry' | 'resolved'
  initiator_user_id: string
  user_a_retry: boolean | null
  user_b_retry: boolean | null
  started_at: string
  nudge_after_at: string
  deadline_at: string
  nudge_sent_at: string | null
  snapshot?: {
    cancelled_confirmed_slot_id?: string | null
    cancelled_confirmed_venue_id?: string | null
    cancelled_week_anchor_monday?: string | null
  }
  resolution?: 'both_yes' | 'closed' | null
  resolved_at?: string | null
}

function optBool(v: unknown): boolean | null {
  if (v === true) return true
  if (v === false) return false
  return null
}

export function parseCancelRetryFlow(raw: unknown): CancelRetryFlowJson | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (o.phase !== 'cancel_pending_retry' && o.phase !== 'resolved') return null
  const initiator = typeof o.initiator_user_id === 'string' ? o.initiator_user_id : null
  if (!initiator) return null
  const started = typeof o.started_at === 'string' ? o.started_at : null
  if (!started) return null
  return {
    phase: o.phase as CancelRetryFlowJson['phase'],
    initiator_user_id: initiator,
    user_a_retry: optBool(o.user_a_retry),
    user_b_retry: optBool(o.user_b_retry),
    started_at: started,
    nudge_after_at: typeof o.nudge_after_at === 'string' ? o.nudge_after_at : started,
    deadline_at: typeof o.deadline_at === 'string' ? o.deadline_at : started,
    nudge_sent_at: typeof o.nudge_sent_at === 'string' ? o.nudge_sent_at : null,
    snapshot:
      o.snapshot && typeof o.snapshot === 'object'
        ? (o.snapshot as CancelRetryFlowJson['snapshot'])
        : undefined,
    resolution:
      o.resolution === 'both_yes' || o.resolution === 'closed'
        ? o.resolution
        : o.resolution === null
          ? null
          : undefined,
    resolved_at: typeof o.resolved_at === 'string' ? o.resolved_at : undefined,
  }
}

export function normalizeRetryFlags(flow: CancelRetryFlowJson): CancelRetryFlowJson {
  return {
    ...flow,
    user_a_retry: typeof flow.user_a_retry === 'boolean' ? flow.user_a_retry : null,
    user_b_retry: typeof flow.user_b_retry === 'boolean' ? flow.user_b_retry : null,
  }
}

export function outcomeFromDecisions(flow: CancelRetryFlowJson): 'both_yes' | 'closed' | null {
  const { user_a_retry: a, user_b_retry: b } = normalizeRetryFlags(flow)
  if (a === false || b === false) return 'closed'
  if (a === true && b === true) return 'both_yes'
  return null
}

export function applyDeadlineDefaults(flow: CancelRetryFlowJson): CancelRetryFlowJson {
  const next = normalizeRetryFlags(flow)
  if (next.user_a_retry === null) next.user_a_retry = false
  if (next.user_b_retry === null) next.user_b_retry = false
  return next
}

export function markResolved(flow: CancelRetryFlowJson, resolution: 'both_yes' | 'closed'): CancelRetryFlowJson {
  return {
    ...normalizeRetryFlags(flow),
    phase: 'resolved',
    resolution,
    resolved_at: new Date().toISOString(),
  }
}

const SENDBLUE_URL = 'https://api.sendblue.co/api/send-message'

const MSG_BOTH_YES = `Got it — we'll reach back out with a new time.`
const MSG_CLOSED = `No worries — we'll close this one out here.`
const MSG_NUDGE = `Quick check — want to try this intro again another time?\nReply YES or NO.`

async function sendConciergeDeno(
  apiKeyId: string,
  apiSecret: string,
  phone: string,
  content: string
): Promise<{ ok: boolean; error?: string; message_handle?: string }> {
  try {
    const res = await fetch(SENDBLUE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'sb-api-key-id': apiKeyId,
        'sb-api-secret-key': apiSecret,
      },
      body: JSON.stringify({ number: phone, content }),
    })
    const text = await res.text()
    let data: { message_handle?: string; error_message?: string } | null = null
    try {
      data = text ? (JSON.parse(text) as { message_handle?: string; error_message?: string }) : null
    } catch {
      // ignore
    }
    if (!res.ok) {
      const err = data?.error_message ?? text ?? res.statusText
      return { ok: false, error: err }
    }
    return { ok: true, message_handle: data?.message_handle }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'send failed' }
  }
}

async function insertMessageLedger(
  supabase: any,
  entry: {
    user_id: string
    direction: 'outbound'
    peer_phone: string
    content_snippet: string
    context: string
    message_handle?: string | null
    match_id: string
  }
): Promise<void> {
  const snippet =
    entry.content_snippet.length > 500 ? entry.content_snippet.slice(0, 500) + '…' : entry.content_snippet
  const { error } = await supabase.from('message_ledger').insert({
    user_id: entry.user_id,
    direction: entry.direction,
    peer_phone: entry.peer_phone,
    content_snippet: snippet,
    context: entry.context,
    message_handle: entry.message_handle ?? null,
    match_id: entry.match_id,
  })
  if (error) console.error('[sms-cancel-retry] ledger insert failed', error.message)
}

async function completeCancelRetryMatch(
  supabase: any,
  apiKeyId: string,
  apiSecret: string,
  match: { id: string; user_a: string; user_b: string },
  flow: CancelRetryFlowJson,
  outcome: 'both_yes' | 'closed'
): Promise<void> {
  const resolved = markResolved(flow, outcome)
  const { error } = await supabase
    .from('match_candidates')
    .update({
      scheduling_status: 'expired',
      cancel_retry_flow: resolved,
    })
    .eq('id', match.id)
  if (error) {
    console.error('[sms-cancel-retry] update match failed', error)
    throw new Error(error.message)
  }

  const body = outcome === 'both_yes' ? MSG_BOTH_YES : MSG_CLOSED
  const { data: profs } = await supabase
    .from('profiles')
    .select('id, phone')
    .in('id', [match.user_a, match.user_b])

  const phoneBy = (profs ?? []).reduce((acc: Record<string, string>, p: { id: string; phone: string | null }) => {
    const ph = p.phone?.trim()
    if (ph) acc[p.id] = ph
    return acc
  }, {})

  for (const uid of [match.user_a, match.user_b]) {
    const phone = phoneBy[uid]
    if (!phone) continue
    const result = await sendConciergeDeno(apiKeyId, apiSecret, phone, body)
    if (!result.ok) {
      console.error('[sms-cancel-retry] send failed', { matchId: match.id, uid, error: result.error })
      continue
    }
    await insertMessageLedger(supabase, {
      user_id: uid,
      direction: 'outbound',
      peer_phone: phone,
      content_snippet: body,
      context: outcome === 'both_yes' ? 'cancel_retry_resolved_both_yes' : 'cancel_retry_resolved_closed',
      message_handle: result.message_handle ?? null,
      match_id: match.id,
    })
  }
}

async function sendCancelRetryNudgeIfDue(
  supabase: any,
  apiKeyId: string,
  apiSecret: string,
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
  const phoneBy = (profs ?? []).reduce((acc: Record<string, string>, p: { id: string; phone: string | null }) => {
    const ph = p.phone?.trim()
    if (ph) acc[p.id] = ph
    return acc
  }, {})

  for (const uid of pending) {
    const phone = phoneBy[uid]
    if (!phone) continue
    const result = await sendConciergeDeno(apiKeyId, apiSecret, phone, MSG_NUDGE)
    if (!result.ok) {
      console.error('[sms-cancel-retry] nudge send failed', { matchId: match.id, uid, error: result.error })
      continue
    }
    await insertMessageLedger(supabase, {
      user_id: uid,
      direction: 'outbound',
      peer_phone: phone,
      content_snippet: MSG_NUDGE,
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
    .update({ cancel_retry_flow: next })
    .eq('id', match.id)
    .eq('scheduling_status', CANCEL_RETRY_SCHEDULING_STATUS)
  if (error) {
    console.error('[sms-cancel-retry] nudge persist failed', error)
    return null
  }
  return next
}

async function finalizeCancelRetryIfDeadlinePassed(
  supabase: any,
  apiKeyId: string,
  apiSecret: string,
  match: { id: string; user_a: string; user_b: string },
  flow: CancelRetryFlowJson
): Promise<boolean> {
  if (new Date(flow.deadline_at).getTime() > Date.now()) return false

  const withDefaults = applyDeadlineDefaults(flow)
  const outcome = outcomeFromDecisions(withDefaults)
  if (!outcome) return false

  await completeCancelRetryMatch(supabase, apiKeyId, apiSecret, match, withDefaults, outcome)
  return true
}

export async function runCancelRetryCronEdge(supabase: any, apiKeyId: string, apiSecret: string): Promise<{
  nudged: number
  finalized: number
  error?: string
}> {
  const { data: rows, error: qErr } = await supabase
    .from('match_candidates')
    .select('id, user_a, user_b, cancel_retry_flow')
    .eq('scheduling_status', CANCEL_RETRY_SCHEDULING_STATUS)

  if (qErr) return { nudged: 0, finalized: 0, error: qErr.message }

  let nudged = 0
  let finalized = 0

  for (const r of rows ?? []) {
    const flow = parseCancelRetryFlow(r.cancel_retry_flow)
    if (!flow || flow.phase !== 'cancel_pending_retry') continue

    const match = { id: r.id as string, user_a: r.user_a as string, user_b: r.user_b as string }

    const closed = await finalizeCancelRetryIfDeadlinePassed(supabase, apiKeyId, apiSecret, match, flow)
    if (closed) {
      finalized++
      continue
    }

    const after = await sendCancelRetryNudgeIfDue(supabase, apiKeyId, apiSecret, match, flow)
    if (after) nudged++
  }

  return { nudged, finalized }
}
