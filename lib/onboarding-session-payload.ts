/**
 * Build payload for onboarding_sessions (and merge) from answers state.
 * Used by /app/onboarding when token is present (SMS signup flow).
 */

import { HOME_COUNTRY_UNITED_STATES } from './countries-list'
import { INTAKE_STEPS } from './onboarding-data'

export type AnswersState = Record<
  string,
  string | string[] | number | { city: string; lat: number; lng: number }
>

export function buildOnboardingSessionPayload(answers: AnswersState): Record<string, unknown> {
  const loc = answers.location as { city: string; lat: number; lng: number } | undefined
  const intakeStepsForPayload = INTAKE_STEPS
  const responses = intakeStepsForPayload.map((s) => {
    let raw = answers[s.id]
    if (s.id === 'q_home_state' && answers.q_home_country !== HOME_COUNTRY_UNITED_STATES) {
      raw = ''
    }
    let value: string | string[] | number = raw === undefined || (typeof raw === 'object' && raw !== null && 'city' in raw) ? (s.type === 'multi_select' ? [] : '') : (raw as string | string[] | number)
    const isEmpty = value === '' || (Array.isArray(value) && value.length === 0)
    if (s.required !== true && isEmpty) value = 'N/A'
    return {
      question_id: s.id,
      question_text: s.question,
      answer: value,
      type: s.type,
      answered_at: new Date().toISOString(),
    }
  })
  return {
    first_name: typeof answers.first_name === 'string' ? answers.first_name.trim() || ' ' : ' ',
    birthdate: answers.birthdate ?? null,
    gender: answers.gender ?? null,
    gender_preference: answers.gender_preference ?? null,
    age_preference: answers.age_preference ?? null,
    languages: Array.isArray(answers.languages) ? answers.languages : null,
    city: loc?.city ?? null,
    lat: typeof loc?.lat === 'number' ? loc.lat : null,
    lng: typeof loc?.lng === 'number' ? loc.lng : null,
    avatar_url: typeof answers.avatar_url === 'string' ? answers.avatar_url : null,
    avatar_path: typeof answers.avatar_path === 'string' ? answers.avatar_path : null,
    responses,
  }
}

/** Map API payload (from GET onboarding-session) into answers state for form. */
export function payloadToAnswers(payload: Record<string, unknown>): AnswersState {
  const answers: AnswersState = {}
  if (typeof payload.first_name === 'string') answers.first_name = payload.first_name
  if (typeof payload.birthdate === 'string') answers.birthdate = payload.birthdate
  if (typeof payload.gender === 'string') answers.gender = payload.gender
  if (typeof payload.gender_preference === 'string') answers.gender_preference = payload.gender_preference
  if (typeof payload.age_preference === 'string') answers.age_preference = payload.age_preference
  if (Array.isArray(payload.languages)) answers.languages = payload.languages
  if (
    typeof payload.city === 'string' &&
    typeof payload.lat === 'number' &&
    typeof payload.lng === 'number'
  ) {
    answers.location = { city: payload.city, lat: payload.lat, lng: payload.lng }
  }
  const responses = Array.isArray(payload.responses) ? payload.responses : []
  for (const r of responses as Array<{ question_id?: string; answer?: unknown }>) {
    if (r?.question_id != null) answers[r.question_id] = r.answer as string | string[] | number
  }
  if (typeof payload.avatar_url === 'string') answers.avatar_url = payload.avatar_url
  if (typeof payload.avatar_path === 'string') answers.avatar_path = payload.avatar_path
  return answers
}
