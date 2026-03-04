import { PROFILE_STEPS, INTAKE_STEPS } from './onboarding-data'
import type { ProfileRow, IntakeResponsesV5Row } from './db-types'
import type { IntakeResponseItem } from './db-types'

export type AnswersState = Record<
  string,
  string | string[] | number | { city: string; lat: number; lng: number }
>

/** Build full answers state from profile + intake for use in edit profile / onboarding. */
export function getAnswersFromProfileAndIntake(
  profile: ProfileRow | null,
  intake: IntakeResponsesV5Row | null
): AnswersState {
  const answers: AnswersState = {}

  for (const s of PROFILE_STEPS) {
    if (s.id === 'first_name') answers.first_name = profile?.first_name?.trim() ?? ''
    else if (s.id === 'birthdate') answers.birthdate = profile?.birthdate ?? ''
    else if (s.id === 'gender') answers.gender = profile?.gender ?? ''
    else if (s.id === 'gender_preference') answers.gender_preference = profile?.gender_preference ?? ''
    else if (s.id === 'languages') answers.languages = Array.isArray(profile?.languages) ? profile.languages : []
    else if (s.id === 'location' && profile?.city != null)
      answers.location = { city: profile.city, lat: profile.lat ?? 0, lng: profile.lng ?? 0 }
  }

  const responses = intake?.responses ?? []
  for (const s of INTAKE_STEPS) {
    if (s.id === 'phone') {
      answers.phone = profile?.phone ?? ''
      continue
    }
    const r = responses.find((x: IntakeResponseItem) => x.question_id === s.id)
    if (r != null) answers[s.id] = r.answer as string | string[] | number
  }

  return answers
}
