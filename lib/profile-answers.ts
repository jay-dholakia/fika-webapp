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
    else if (s.id === 'pronouns') answers.pronouns = profile?.pronouns ?? ''
    else if (s.id === 'relationship_status') answers.relationship_status = profile?.relationship_status ?? ''
    else if (s.id === 'location' && profile?.city != null)
      answers.location = { city: profile.city, lat: profile.lat ?? 0, lng: profile.lng ?? 0 }
    else if (s.id === 'confirm_intent') answers.confirm_intent = profile?.intent_confirmed_at ? "I'm in" : ''
  }

  const responses = intake?.responses ?? []
  for (const s of INTAKE_STEPS) {
    const r = responses.find((x: IntakeResponseItem) => x.question_id === s.id)
    if (r != null) answers[s.id] = r.answer as string | string[] | number
  }

  return answers
}
