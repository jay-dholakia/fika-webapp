import { getSupabase } from './supabase'
import type { ProfileRow, IntakeResponsesV5Row } from './db-types'

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

export function isOnboardingComplete(
  profile: ProfileRow | null,
  intake: IntakeResponsesV5Row | null
): boolean {
  return isProfileComplete(profile) && isIntakeComplete(intake)
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
