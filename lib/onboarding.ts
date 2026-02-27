import { getSupabase } from './supabase'
import type { ProfileRow, IntakeResponsesV5Row } from './db-types'
import { INTAKE_STEPS, type ProfileStep } from './onboarding-data'

/** Gate values that show the industry (work) question. */
const WORK_STUDY_SHOW_INDUSTRY = ['I work', 'I work and study']
/** Gate values that show the university/major (school) questions. */
const WORK_STUDY_SHOW_SCHOOL = ["I'm in school", 'I work and study']

export function showIndustryStep(gate: string | undefined): boolean {
  return !!gate && WORK_STUDY_SHOW_INDUSTRY.includes(gate)
}

export function showSchoolSteps(gate: string | undefined): boolean {
  return !!gate && WORK_STUDY_SHOW_SCHOOL.includes(gate)
}

/** Profile is complete when these are set (per spec). */
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
 * Legacy: if intake has completed_at but profile has no intent_confirmed_at (user finished before we wrote it from last step), we still consider onboarding complete when profile has essentials (name, birthdate, city).
 */
export function isOnboardingComplete(
  profile: ProfileRow | null,
  intake: IntakeResponsesV5Row | null
): boolean {
  if (!profile || !intake) return false
  if (!isIntakeComplete(intake)) return false
  const hasEssentials = !!(profile.first_name?.trim() && profile.birthdate && profile.city?.trim())
  return isProfileComplete(profile) || hasEssentials
}

/** Get current batch week (Monday) as YYYY-MM-DD. */
export function getCurrentBatchWeek(): string {
  const d = new Date()
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1) // Monday
  const monday = new Date(d)
  monday.setDate(diff)
  return monday.toISOString().slice(0, 10)
}

/**
 * Returns intake step ids that have no answer (for users who completed onboarding
 * before we added new questions). Used to show "New intro questions added" card.
 * Applies the same branching as onboarding (Work vs Study) so we only count steps that apply to this user.
 * When intake already has completed_at, we do not count confirm_intent as missing (legacy completions).
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
  const gate = (responses.find((r) => r.question_id === 'q3_work_or_study')?.answer as string) || undefined
  const missing: string[] = []
  for (const s of INTAKE_STEPS) {
    if (s.id === 'q3_profession' && !showIndustryStep(gate)) continue
    if ((s.id === 'q3_university' || s.id === 'q3_major') && !showSchoolSteps(gate)) continue
    if (intake?.completed_at && s.id === 'confirm_intent') continue
    if (!answered.has(s.id)) missing.push(s.id)
  }
  return missing
}

/**
 * Returns missing intake steps in display order with branching applied (same as onboarding).
 * Used to show new questions card-by-card on the app page.
 * When intake has completed_at, confirm_intent is not included as missing (legacy).
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
  const gate = (responses.find((r) => r.question_id === 'q3_work_or_study')?.answer as string) || undefined
  const out: ProfileStep[] = []
  for (const s of INTAKE_STEPS) {
    if (s.id === 'q3_profession' && !showIndustryStep(gate)) continue
    if ((s.id === 'q3_university' || s.id === 'q3_major') && !showSchoolSteps(gate)) continue
    if (intake?.completed_at && s.id === 'confirm_intent') continue
    if (!answered.has(s.id)) out.push(s)
  }
  return out
}
