import { PROFILE_STEPS, INTAKE_STEPS } from './onboarding-data'
import { INTAKE_ANSWER_SKIPPED } from './intro-detail'
import type { ProfileRow, IntakeResponsesV5Row } from './db-types'
import type { IntakeResponseItem } from './db-types'

function normalizeIntakeAnswerForDisplay(answer: string | string[] | number | null | undefined, stepType?: string): string | string[] | number {
  const multi = stepType === 'multi_select' || stepType === 'searchable_multi'
  if (answer == null) return multi ? [] : ''
  if (answer === INTAKE_ANSWER_SKIPPED) return multi ? [] : ''
  if (Array.isArray(answer) && answer.length === 1 && answer[0] === INTAKE_ANSWER_SKIPPED) return []
  return answer
}

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
    else if (s.id === 'pronouns') {
      let pr = profile?.pronouns?.trim() ?? ''
      if (!pr && profile?.gender?.trim()) {
        const g = profile.gender.trim().toLowerCase()
        if (g === 'female' || g === 'woman' || g === 'women') pr = 'She/her'
        else if (g === 'male' || g === 'man' || g === 'men') pr = 'He/him'
        else if (g === 'non-binary' || g === 'nonbinary') pr = 'They/them'
        else pr = 'They/them'
      }
      answers.pronouns = pr
    }
    else if (s.id === 'languages') answers.languages = Array.isArray(profile?.languages) ? profile.languages : []
    else if (s.id === 'location' && profile?.city != null)
      answers.location = { city: profile.city, lat: profile.lat ?? 0, lng: profile.lng ?? 0 }
  }
  if (profile?.neighborhood) answers.q_neighborhood = profile.neighborhood
  answers.gender_preference = profile?.gender_preference ?? ''
  const responses = intake?.responses ?? []
  for (const s of INTAKE_STEPS) {
    const r = responses.find((x: IntakeResponseItem) => x.question_id === s.id)
    if (r != null) answers[s.id] = normalizeIntakeAnswerForDisplay(r.answer as string | string[] | number, s.type) as string | string[] | number
  }
  answers.gender_preference = profile?.gender_preference ?? ''
  answers.phone = profile?.phone ?? ''
  return answers
}
