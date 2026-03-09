/**
 * Helpers for showing intro detail in the modal.
 * LA Beta: safe intake IDs = life_chapter, lately, everyday_anchor, topics, convo_feel, hoping_for, openness,
 * plus profile-card-only: book/movie/place/role model (for opt-in evaluation).
 */

import { INTAKE_STEPS } from './onboarding-data'
import type { IntakeResponseItem } from './db-types'

export const SAFE_INTAKE_QUESTION_IDS = new Set([
  'q_life_chapter',
  'q_lately',
  'q_everyday_anchor',
  'q_topics',
  'q_convo_feel',
  'q_hoping_for',
  'q_openness',
  // Profile card only (shown so user can evaluate when opting in)
  'q_book_recommendation',
  'q_movie_show_recommendation',
  'q_place_recommendation',
  'q_role_model',
  'q_role_model_why',
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

/** Build a short prose summary from "about them" intake (LA Beta). */
export function buildIntroSummary(responses: IntakeResponseItem[]): string | null {
  const byId = new Map(responses.map((r) => [r.question_id, r]))
  const str = (id: string) => {
    const r = byId.get(id)
    if (!r) return null
    const s = formatIntakeAnswer(r.answer).trim()
    return s || null
  }
  const life = str('q_life_chapter')
  const convoFeel = str('q_convo_feel')
  const hopingFor = str('q_hoping_for')
  const who = str('q_openness')

  const parts: string[] = []
  if (life) {
    parts.push(`Right now they're in a chapter of ${life.toLowerCase()}.`)
  }
  const connectParts: string[] = []
  if (convoFeel) connectParts.push(`like first conversations to feel ${convoFeel.toLowerCase()}`)
  if (hopingFor) connectParts.push(`hoping for ${hopingFor.toLowerCase()}`)
  if (who) connectParts.push(`open to ${who.toLowerCase()}`)
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
