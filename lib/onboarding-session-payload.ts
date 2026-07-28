/**
 * Build payload for onboarding_sessions (and merge) from answers state.
 * Used by /app/onboarding when token is present (SMS signup flow).
 */

import { HOME_COUNTRY_UNITED_STATES } from './countries-list'
import { INTAKE_STEPS } from './onboarding-data'

export function genderDisplayToStored(display: string): string | null {
  const d = display.trim().toLowerCase()
  if (d === 'woman') return 'female'
  if (d === 'man') return 'male'
  if (d === 'non-binary') return 'non-binary'
  return display.trim() || null
}

function genderStoredToDisplay(stored: string): string {
  const s = stored.trim().toLowerCase()
  if (s === 'female' || s === 'woman' || s === 'women') return 'Woman'
  if (s === 'male' || s === 'man' || s === 'men') return 'Man'
  return 'Non-binary'
}

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
    const emptyMulti = s.type === 'multi_select' || s.type === 'searchable_multi'
    const emptyVal =
      raw === undefined || (typeof raw === 'object' && raw !== null && 'city' in raw)
        ? emptyMulti
          ? []
          : ''
        : (raw as string | string[] | number)
    let value: string | string[] | number = emptyVal as string | string[] | number
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
    gender: typeof answers.gender === 'string' ? genderDisplayToStored(answers.gender) : null,
    gender_preference: answers.gender_preference ?? null,
    languages: Array.isArray(answers.languages) ? answers.languages : null,
    city: loc?.city ?? null,
    lat: typeof loc?.lat === 'number' ? loc.lat : null,
    lng: typeof loc?.lng === 'number' ? loc.lng : null,
    neighborhood: typeof answers.q_neighborhood === 'string' ? answers.q_neighborhood.trim() || null : null,
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
  if (typeof (payload as { gender?: string }).gender === 'string' && (payload as { gender: string }).gender.trim()) {
    answers.gender = genderStoredToDisplay((payload as { gender: string }).gender)
  } else if (typeof payload.pronouns === 'string' && payload.pronouns.trim()) {
    // legacy: pronouns field from old onboarding sessions
    const p = (payload.pronouns as string).trim().toLowerCase()
    if (p.startsWith('she')) answers.gender = 'Woman'
    else if (p.startsWith('he')) answers.gender = 'Man'
    else answers.gender = 'Non-binary'
  }
  if (typeof payload.gender_preference === 'string') answers.gender_preference = payload.gender_preference
  if (Array.isArray(payload.languages)) answers.languages = payload.languages
  if (
    typeof payload.city === 'string' &&
    typeof payload.lat === 'number' &&
    typeof payload.lng === 'number'
  ) {
    answers.location = { city: payload.city, lat: payload.lat, lng: payload.lng }
  }
  if (typeof payload.neighborhood === 'string' && payload.neighborhood.trim()) {
    answers.q_neighborhood = payload.neighborhood
  }
  const responses = Array.isArray(payload.responses) ? payload.responses : []
  for (const r of responses as Array<{ question_id?: string; answer?: unknown }>) {
    if (r?.question_id != null) answers[r.question_id] = r.answer as string | string[] | number
  }
  if (typeof payload.avatar_url === 'string') answers.avatar_url = payload.avatar_url
  if (typeof payload.avatar_path === 'string') answers.avatar_path = payload.avatar_path
  return answers
}
