/**
 * Relative milestones backward from `fika_starts_at`.
 * Used by the plan in `docs/WEEKLY_FIKA_RELATIVE_CADENCE.md`.
 *
 * v1 uses fixed UTC durations (hours/days) from the Fika instant — good for
 * scheduling order; upgrade to calendar-day math in `iana_tz` when product requires it.
 */
const MS_PER_HOUR = 60 * 60 * 1000
const MS_PER_DAY = 24 * MS_PER_HOUR

export type RelativeCadenceDaysBefore = {
  /** First opt-in blast / open window comms */
  optInBlast: number
  /** Hard close for opt-in before matcher */
  optInClose: number
  /** Step-2 intro SMS for approved pairs */
  introSms: number
}

/** Example from product discussion: blast T−3d, close T−2d, intro T−1d. */
export const DEFAULT_RELATIVE_CADENCE_DAYS_BEFORE: RelativeCadenceDaysBefore = {
  optInBlast: 3,
  optInClose: 2,
  introSms: 1,
}

export type RelativeCadenceHoursBefore = {
  /** First opt-in blast / open window comms */
  optInBlast: number
  /** Hard close for opt-in before matcher */
  optInClose: number
  /** Match ready / send “you’re in” or “intro” step for approved rows */
  matchSend: number
}

/** Social Fika v1: blast T−48h, close T−24h, match/intros T−6h. */
export const DEFAULT_SOCIAL_FIKA_CADENCE_HOURS_BEFORE: RelativeCadenceHoursBefore = {
  optInBlast: 48,
  optInClose: 24,
  matchSend: 6,
}

export type RelativeCadenceInstants = {
  optInBlastDueAt: string
  optInClosesAt: string
  introSmsDueAt: string
}

export function computeRelativeCadenceInstants(
  fikaStartsAtIso: string,
  days: RelativeCadenceDaysBefore = DEFAULT_RELATIVE_CADENCE_DAYS_BEFORE
): RelativeCadenceInstants {
  const t = new Date(fikaStartsAtIso).getTime()
  if (!Number.isFinite(t)) {
    throw new Error(`Invalid fika_starts_at: ${fikaStartsAtIso}`)
  }
  return {
    optInBlastDueAt: new Date(t - days.optInBlast * MS_PER_DAY).toISOString(),
    optInClosesAt: new Date(t - days.optInClose * MS_PER_DAY).toISOString(),
    introSmsDueAt: new Date(t - days.introSms * MS_PER_DAY).toISOString(),
  }
}

export function computeSocialFikaCadenceInstants(
  fikaStartsAtIso: string,
  hours: RelativeCadenceHoursBefore = DEFAULT_SOCIAL_FIKA_CADENCE_HOURS_BEFORE
): { optInBlastDueAt: string; optInClosesAt: string; matchSendDueAt: string } {
  const t = new Date(fikaStartsAtIso).getTime()
  if (!Number.isFinite(t)) {
    throw new Error(`Invalid fika_starts_at: ${fikaStartsAtIso}`)
  }
  return {
    optInBlastDueAt: new Date(t - hours.optInBlast * MS_PER_HOUR).toISOString(),
    optInClosesAt: new Date(t - hours.optInClose * MS_PER_HOUR).toISOString(),
    matchSendDueAt: new Date(t - hours.matchSend * MS_PER_HOUR).toISOString(),
  }
}

/** Minimum span (ms) from `now` to `fika_starts_at` so T−48h/T−24h/T−6h do not collide. */
export function assertFikaStartsAfter(
  fikaStartsAtIso: string,
  nowMs: number,
  minimumLeadMs: number = 48 * MS_PER_HOUR
): { ok: true } | { ok: false; reason: string } {
  const end = new Date(fikaStartsAtIso).getTime()
  if (!Number.isFinite(end)) return { ok: false, reason: 'invalid_fika_starts_at' }
  if (end - nowMs < minimumLeadMs) {
    return { ok: false, reason: 'fika_too_soon_for_configured_cadence' }
  }
  return { ok: true }
}
