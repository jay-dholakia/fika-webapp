import type { SupabaseClient } from '@supabase/supabase-js'
import { computeAndStoreIntakeEmbedding } from '@/lib/intake-embed-server'

export const EDITABLE_QUESTIONS: Record<string, { label: string; choices?: string[] }> = {
  q_neighborhood:        { label: 'Neighborhood' },
  q_kids:                { label: 'Kids' },
  q_work:                { label: 'Work' },
  q_interests_freetext:  { label: 'Life outside work' },
  q_anything_else:       { label: 'Anything else' },
  q_relationship_status: { label: 'Relationship status' },
  q_market_tenure:       { label: 'Time in the city' },
  q_social_goal: {
    label: 'What you want from Fika',
    choices: [
      'Expand my circle',
      'Find activity buddies',
      'Have more interesting conversations',
      'Make actual friends',
      "Just see who's out there",
    ],
  },
}

function parseChoice(text: string, choices: string[]): string | null {
  const t = text.trim().toLowerCase()
  const num = parseInt(t, 10)
  if (!isNaN(num) && num >= 1 && num <= choices.length) return choices[num - 1]
  const exact = choices.findIndex((c) => c.toLowerCase() === t)
  if (exact >= 0) return choices[exact]
  const partial = choices.findIndex(
    (c) => c.toLowerCase().startsWith(t) || t.startsWith(c.toLowerCase().slice(0, 4))
  )
  if (partial >= 0) return choices[partial]
  return null
}

async function updateIntakeResponse(
  supabase: SupabaseClient,
  userId: string,
  questionId: string,
  newAnswer: string,
  questionLabel: string
): Promise<void> {
  const { data: existing } = await supabase
    .from('intake_responses_v5')
    .select('responses, completed_at')
    .eq('user_id', userId)
    .maybeSingle()

  const responses = Array.isArray(existing?.responses) ? [...(existing.responses as object[])] : []
  const now = new Date().toISOString()
  const newItem = {
    question_id: questionId,
    question_text: questionLabel,
    answer: newAnswer,
    type: 'text',
    answered_at: now,
  }
  const idx = responses.findIndex((r: unknown) => (r as { question_id?: string }).question_id === questionId)
  if (idx >= 0) responses[idx] = newItem
  else responses.push(newItem)

  await supabase.from('intake_responses_v5').upsert(
    {
      user_id: userId,
      responses,
      updated_at: now,
      ...(existing?.completed_at ? { completed_at: existing.completed_at } : {}),
    },
    { onConflict: 'user_id' }
  )
}

async function setPendingEdit(
  supabase: SupabaseClient,
  userId: string,
  questionId: string | null
): Promise<void> {
  const newPayload = questionId ? { pending_profile_edit: questionId } : {}
  await supabase
    .from('sms_conversation_states')
    .update({ payload: newPayload, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('match_id', null)
}

type EditSendFn = (content: string, context: string) => Promise<unknown>

export async function handleEditCommand(params: {
  supabase: SupabaseClient
  userId: string
  questionId: string
  body: string
  send: EditSendFn
}): Promise<void> {
  const { supabase, userId, questionId, body, send } = params
  const qDef = EDITABLE_QUESTIONS[questionId]
  if (!qDef) {
    await send(
      "Hmm, something didn't look right — tap Edit next to the question in your profile and try again.",
      'profile_edit_unknown'
    )
    return
  }

  if (qDef.choices) {
    const list = qDef.choices.map((c, i) => `${i + 1}. ${c}`).join('\n')
    await send(`${qDef.label}:\n${list}`, 'profile_edit_choice_prompt')
    await setPendingEdit(supabase, userId, questionId)
    return
  }

  const newAnswer = body.trim()
  if (!newAnswer) {
    await send(
      "Hmm, something didn't look right — tap Edit next to the question in your profile and try again.",
      'profile_edit_empty'
    )
    return
  }
  await updateIntakeResponse(supabase, userId, questionId, newAnswer, qDef.label)
  computeAndStoreIntakeEmbedding(supabase, userId).catch(() => {})
  await send('Done! Your answer has been updated.', 'profile_edit_confirmed')
}

export async function handlePendingEdit(params: {
  supabase: SupabaseClient
  userId: string
  pendingQuestionId: string
  content: string
  send: EditSendFn
}): Promise<boolean> {
  const { supabase, userId, pendingQuestionId, content, send } = params
  const qDef = EDITABLE_QUESTIONS[pendingQuestionId]
  if (!qDef?.choices) {
    await setPendingEdit(supabase, userId, null)
    return false
  }

  const parsed = parseChoice(content, qDef.choices)
  if (!parsed) {
    const list = qDef.choices.map((c, i) => `${i + 1}. ${c}`).join('\n')
    await send(`Just reply with a number from the list:\n${list}`, 'profile_edit_choice_reask')
    await setPendingEdit(supabase, userId, null)
    return true
  }

  await updateIntakeResponse(supabase, userId, pendingQuestionId, parsed, qDef.label)
  await setPendingEdit(supabase, userId, null)
  computeAndStoreIntakeEmbedding(supabase, userId).catch(() => {})
  await send('Done! Updated.', 'profile_edit_choice_confirmed')
  return true
}
