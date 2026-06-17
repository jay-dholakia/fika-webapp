import { getSupabase } from './supabase'
import type { IntakeResponseItem, ProfileRow, IntakeResponsesV5Row } from './db-types'
import { INTAKE_STEPS, type ProfileStep } from './onboarding-data'

function getStringAnswerFromResponses(responses: IntakeResponseItem[], questionId: string): string | null {
  const r = responses.find((x) => x.question_id === questionId)
  const a = r?.answer
  if (typeof a === 'string') {
    const t = a.trim()
    if (!t || t === 'N/A') return null
    return t
  }
  return null
}

/** Profile is complete when these are set (LA Beta; phone optional, avatar required). */
export function isProfileComplete(p: ProfileRow | null): boolean {
  if (!p) return false
  return !!(
    p.first_name?.trim() &&
    p.birthdate &&
    p.city?.trim() &&
    p.avatar_url?.trim() &&
    p.intent_confirmed_at
  )
}

/** Intake is complete when completed_at is set. */
export function isIntakeComplete(i: IntakeResponsesV5Row | null): boolean {
  return !!i?.completed_at
}

/**
 * Onboarding is complete when profile is complete and intake is complete.
 * Legacy: if intake has completed_at but profile has no intent_confirmed_at, we still consider complete when profile has essentials.
 */
export function isOnboardingComplete(
  profile: ProfileRow | null,
  intake: IntakeResponsesV5Row | null
): boolean {
  if (!profile || !intake) return false
  if (!isIntakeComplete(intake)) return false
  const hasEssentials = !!(
    profile.first_name?.trim() &&
    profile.birthdate &&
    profile.city?.trim()
  )
  return isProfileComplete(profile) || hasEssentials
}

/** Current week anchor: Monday YYYY-MM-DD (UTC) for slot resolution and SMS partitioning. */
export function getCurrentWeekAnchorMonday(): string {
  const d = new Date()
  const day = d.getUTCDay()
  const date = d.getUTCDate()
  const diff = date - day + (day === 0 ? -6 : 1)
  const monday = new Date(d)
  monday.setUTCDate(diff)
  return monday.toISOString().slice(0, 10)
}

/**
 * Opt-in + availability lock = Monday 11am PT.
 * Window opens Sunday 12am PT; closes Monday 11am PT. Stored as Monday 18:00 UTC (11am PDT). (In PST, 11am = 19:00 UTC.)
 */
const OPT_IN_DEADLINE_MONDAY_HOUR_UTC = 18
const OPT_IN_DEADLINE_MONDAY_MINUTE_UTC = 0

/**
 * Opt-in deadline for a week anchor Monday (YYYY-MM-DD).
 * Deadline = Monday 11am PT. Before this we accept opt-in; after this, window closed.
 */
export function getOptInDeadlineForWeekAnchorMonday(weekAnchorMonday: string): Date {
  const monday = new Date(weekAnchorMonday + 'T00:00:00Z')
  monday.setUTCHours(OPT_IN_DEADLINE_MONDAY_HOUR_UTC, OPT_IN_DEADLINE_MONDAY_MINUTE_UTC, 0, 0)
  return monday
}

/** Intro accept/pass deadline = Tuesday 9pm PT (Wednesday 04:00 UTC). After this, intro offer expires. */
export function getIntroAcceptDeadlineForWeekAnchorMonday(weekAnchorMonday: string): Date {
  const monday = new Date(weekAnchorMonday + 'T00:00:00Z')
  const wednesday = new Date(monday)
  wednesday.setUTCDate(wednesday.getUTCDate() + 2)
  wednesday.setUTCHours(4, 0, 0, 0)
  return wednesday
}

export function isPastIntroAcceptDeadline(weekAnchorMonday?: string): boolean {
  const week = weekAnchorMonday ?? getCurrentWeekAnchorMonday()
  return new Date() >= getIntroAcceptDeadlineForWeekAnchorMonday(week)
}

/**
 * True if the opt-in deadline for the given week anchor has passed.
 * Uses current week anchor if omitted.
 */
export function isPastOptInDeadline(weekAnchorMonday?: string): boolean {
  const week = weekAnchorMonday ?? getCurrentWeekAnchorMonday()
  const deadline = getOptInDeadlineForWeekAnchorMonday(week)
  return new Date() >= deadline
}

/**
 * Returns intake step ids that have no answer (LA Beta: no branching).
 * When intake already has completed_at, we do not count confirm_intent as missing.
 */
export function getMissingIntakeStepIds(intake: IntakeResponsesV5Row | null): string[] {
  const responses = Array.isArray(intake?.responses) ? intake.responses : []
  const answered = new Set(
    responses
      .filter(
        (r) =>
          r.answer != null &&
          (r.answer !== '' || (Array.isArray(r.answer) && r.answer.length >= 0))
      )
      .map((r) => r.question_id)
  )
  const homeCountry = getStringAnswerFromResponses(responses, 'q_home_country')
  const missing: string[] = []
  for (const s of INTAKE_STEPS) {
    if (intake?.completed_at && s.id === 'confirm_intent') continue
    if (s.id === 'gender_preference') continue
    if (s.id === 'q_home_state' && homeCountry !== 'United States') continue
    if (!answered.has(s.id)) missing.push(s.id)
  }
  return missing
}

/**
 * Returns missing intake steps in display order (LA Beta: no branching).
 */
export function getOrderedMissingIntakeSteps(intake: IntakeResponsesV5Row | null): ProfileStep[] {
  const responses = Array.isArray(intake?.responses) ? intake.responses : []
  const answered = new Set(
    responses
      .filter(
        (r) =>
          r.answer != null &&
          (r.answer !== '' || (Array.isArray(r.answer) && r.answer.length >= 0))
      )
      .map((r) => r.question_id)
  )
  const homeCountry = getStringAnswerFromResponses(responses, 'q_home_country')
  const out: ProfileStep[] = []
  for (const s of INTAKE_STEPS) {
    if (intake?.completed_at && s.id === 'confirm_intent') continue
    if (s.id === 'gender_preference') continue
    if (s.id === 'q_home_state' && homeCountry !== 'United States') continue
    if (!answered.has(s.id)) out.push(s)
  }
  return out
}
