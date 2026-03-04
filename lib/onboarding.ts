import { getSupabase } from './supabase'
import type { ProfileRow, IntakeResponsesV5Row } from './db-types'
import { INTAKE_STEPS, type ProfileStep } from './onboarding-data'

/** Profile is complete when these are set (LA Beta; phone optional, from SMS or settings). */
export function isProfileComplete(p: ProfileRow | null): boolean {
  if (!p) return false
  return !!(
    p.first_name?.trim() &&
    p.birthdate &&
    p.city?.trim() &&
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

/** Get current batch week (Monday) as YYYY-MM-DD, in UTC so the value is consistent everywhere. */
export function getCurrentBatchWeek(): string {
  const d = new Date()
  const day = d.getUTCDay()
  const date = d.getUTCDate()
  const diff = date - day + (day === 0 ? -6 : 1)
  const monday = new Date(d)
  monday.setUTCDate(diff)
  return monday.toISOString().slice(0, 10)
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
  const missing: string[] = []
  for (const s of INTAKE_STEPS) {
    if (intake?.completed_at && s.id === 'confirm_intent') continue
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
  const out: ProfileStep[] = []
  for (const s of INTAKE_STEPS) {
    if (intake?.completed_at && s.id === 'confirm_intent') continue
    if (!answered.has(s.id)) out.push(s)
  }
  return out
}
