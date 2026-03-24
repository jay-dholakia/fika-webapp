import { PROFILE_STEPS, INTAKE_STEPS } from './onboarding-data'
import { INTAKE_ANSWER_SKIPPED } from './intro-detail'
import type { ProfileRow, IntakeResponsesV5Row } from './db-types'
import type { IntakeResponseItem } from './db-types'

function normalizeIntakeAnswerForDisplay(answer: string | string[] | number | null | undefined, stepType?: string): string | string[] | number {
  if (answer == null) return stepType === 'multi_select' ? [] : ''
  if (answer === INTAKE_ANSWER_SKIPPED) return stepType === 'multi_select' ? [] : ''
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
    else if (s.id === 'gender') answers.gender = profile?.gender ?? ''
    else if (s.id === 'languages') answers.languages = Array.isArray(profile?.languages) ? profile.languages : []
    else if (s.id === 'location' && profile?.city != null)
      answers.location = { city: profile.city, lat: profile.lat ?? 0, lng: profile.lng ?? 0 }
  }
  answers.gender_preference = profile?.gender_preference ?? ''
  answers.age_preference = profile?.age_preference ?? ''
  const responses = intake?.responses ?? []
  for (const s of INTAKE_STEPS) {
    const r = responses.find((x: IntakeResponseItem) => x.question_id === s.id)
    if (r != null) answers[s.id] = normalizeIntakeAnswerForDisplay(r.answer as string | string[] | number, s.type) as string | string[] | number
  }
  const qRel = answers.q_relationship_status
  const qRelEmpty =
    qRel === undefined ||
    qRel === '' ||
    (typeof qRel === 'string' && (qRel === 'N/A' || !qRel.trim()))
  if (qRelEmpty && profile?.relationship_status?.trim()) {
    answers.q_relationship_status = profile.relationship_status
  }
  answers.gender_preference = profile?.gender_preference ?? ''
  answers.age_preference = profile?.age_preference ?? ''
  answers.phone = profile?.phone ?? ''
  return answers
}
