/**
 * Cancel + mutual opt-in to retry an intro later (no rescheduling / no time proposals).
 * State: match_candidates.cancel_retry_flow; scheduling_status = cancelled_pending_retry while pending.
 */

export const CANCEL_RETRY_SCHEDULING_STATUS = 'cancelled_pending_retry' as const

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

export function getCancelRetryNudgeHours(): number {
  const n = parseInt(process.env.CANCEL_RETRY_NUDGE_HOURS ?? '6', 10)
  return Number.isFinite(n) && n > 0 ? n : 6
}

export function getCancelRetryDeadlineHours(): number {
  const n = parseInt(process.env.CANCEL_RETRY_DEADLINE_HOURS ?? '12', 10)
  return Number.isFinite(n) && n > 0 ? n : 12
}

export function isoHoursFromNow(hours: number): string {
  return new Date(Date.now() + hours * 3600000).toISOString()
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

export function applyRetryAnswer(
  flow: CancelRetryFlowJson,
  userId: string,
  userA: string,
  userB: string,
  yes: boolean
): CancelRetryFlowJson {
  const next = normalizeRetryFlags(flow)
  if (userId === userA) {
    next.user_a_retry = yes
  } else if (userId === userB) {
    next.user_b_retry = yes
  }
  return next
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

export function buildInitialCancelRetryFlow(params: {
  initiatorUserId: string
  snapshot: {
    cancelled_confirmed_slot_id: string | null
    cancelled_confirmed_venue_id: string | null
    cancelled_week_anchor_monday: string | null
  }
}): CancelRetryFlowJson {
  const nudgeH = getCancelRetryNudgeHours()
  const deadlineH = getCancelRetryDeadlineHours()
  const started = new Date().toISOString()
  return {
    phase: 'cancel_pending_retry',
    initiator_user_id: params.initiatorUserId,
    user_a_retry: null,
    user_b_retry: null,
    started_at: started,
    nudge_after_at: isoHoursFromNow(nudgeH),
    deadline_at: isoHoursFromNow(deadlineH),
    nudge_sent_at: null,
    snapshot: params.snapshot,
  }
}

export function markResolved(flow: CancelRetryFlowJson, resolution: 'both_yes' | 'closed'): CancelRetryFlowJson {
  return {
    ...normalizeRetryFlags(flow),
    phase: 'resolved',
    resolution,
    resolved_at: new Date().toISOString(),
  }
}
