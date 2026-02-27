/**
 * Helpers for showing intro detail in the modal.
 * Safe intake question IDs = show in intro modal (not super personal).
 */

import { INTAKE_STEPS } from './onboarding-data'
import type { IntakeResponseItem } from './db-types'

/** Question IDs we're okay showing in the intro modal (interests, life chapter, work, conversation style, etc.). */
export const SAFE_INTAKE_QUESTION_IDS = new Set([
  'q2_life_chapter',
  'q3_work_or_study',
  'q3_profession',
  'q3_university',
  'q3_major',
  'q5_talk_about',
  'q10_first_conversation_feel',
  'q4_where_most_yourself',
  'q6_who_excited_to_meet',
  'q9_availability',
  'q11_season_of_life',
])

const questionById = new Map(INTAKE_STEPS.map((s) => [s.id, s.question]))

export function getQuestionText(questionId: string): string {
  return questionById.get(questionId) ?? questionId
}

export function formatIntakeAnswer(answer: string | number | string[]): string {
  if (answer == null) return ''
  if (Array.isArray(answer)) return answer.filter(Boolean).join(', ')
  return String(answer)
}

export function filterSafeIntakeResponses(responses: IntakeResponseItem[]): IntakeResponseItem[] {
  return responses.filter((r) => SAFE_INTAKE_QUESTION_IDS.has(r.question_id))
}

/** Build a short prose summary from "about them" intake (excludes q1 + q5). Returns null if nothing to say. */
export function buildIntroSummary(responses: IntakeResponseItem[]): string | null {
  const byId = new Map(responses.map((r) => [r.question_id, r]))
  const str = (id: string) => {
    const r = byId.get(id)
    if (!r) return null
    const s = formatIntakeAnswer(r.answer).trim()
    return s || null
  }
  const life = str('q2_life_chapter')
  const work = str('q3_work_or_study')
  const convoFeel = str('q10_first_conversation_feel')
  const where = str('q4_where_most_yourself')
  const who = str('q6_who_excited_to_meet')
  const when = str('q9_availability')

  const parts: string[] = []
  if (life) {
    parts.push(`Right now they're in a season of ${life.toLowerCase()}.`)
  }
  if (work) {
    parts.push(`They're ${work.toLowerCase()}.`)
  }
  const connectParts: string[] = []
  if (convoFeel) connectParts.push(`like first conversations to feel ${convoFeel.toLowerCase()}`)
  if (where) connectParts.push(`prefer ${where.toLowerCase()} for meetups`)
  if (who) connectParts.push(`open to ${who.toLowerCase()}`)
  if (when) connectParts.push(`usually free ${when.toLowerCase()}`)
  if (connectParts.length > 0) {
    parts.push(`They ${connectParts.join(', ')}.`)
  }
  const summary = parts.join(' ').trim()
  return summary || null
}

/** Compute age from YYYY-MM-DD birthdate. */
export function ageFromBirthdate(birthdate: string | null): number | null {
  if (!birthdate) return null
  const d = new Date(birthdate)
  if (Number.isNaN(d.getTime())) return null
  const today = new Date()
  let age = today.getFullYear() - d.getFullYear()
  const m = today.getMonth() - d.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age -= 1
  return age >= 0 ? age : null
}
