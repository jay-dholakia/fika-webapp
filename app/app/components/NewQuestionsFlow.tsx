'use client'

import { useState, useMemo, useEffect } from 'react'
import { getSupabase } from '@/lib/supabase'
import { HOME_COUNTRY_UNITED_STATES } from '@/lib/countries-list'
import { MARKET_TENURE_OPTIONS, type ProfileStep } from '@/lib/onboarding-data'
import { SearchableMultiPicker } from '@/app/app/components/SearchableMultiPicker'
import { SearchableSinglePicker } from '@/app/app/components/SearchableSinglePicker'
import { MarketTenureSlider } from '@/app/app/components/MarketTenureSlider'
import { INTAKE_ANSWER_SKIPPED } from '@/lib/intro-detail'
import type { IntakeResponseItem } from '@/lib/db-types'
import type { IntakeResponsesV5Row } from '@/lib/db-types'

type AnswersState = Record<string, string | string[] | number>

function buildAnswersFromIntake(intake: IntakeResponsesV5Row | null): AnswersState {
  const responses = Array.isArray(intake?.responses) ? intake.responses : []
  const out: AnswersState = {}
  for (const r of responses) {
    if (r.answer == null) continue
    if (r.answer === INTAKE_ANSWER_SKIPPED) continue
    if (Array.isArray(r.answer) && r.answer.length === 1 && r.answer[0] === INTAKE_ANSWER_SKIPPED) continue
    out[r.question_id] = r.answer as string | string[] | number
  }
  return out
}

async function saveIntakeAnswer(
  userId: string,
  step: ProfileStep,
  answer: string | string[] | number
): Promise<void> {
  const supabase = getSupabase()
  if (!supabase) throw new Error('Not configured')
  const { data: existing } = await supabase
    .from('intake_responses_v5')
    .select('responses, availability_times, completed_at, embed_vector')
    .eq('user_id', userId)
    .maybeSingle()

  const responses: IntakeResponseItem[] = Array.isArray(existing?.responses)
    ? [...(existing.responses as IntakeResponseItem[])]
    : []
  const newItem: IntakeResponseItem = {
    question_id: step.id,
    question_text: step.question,
    answer,
    type: step.type,
    answered_at: new Date().toISOString(),
  }
  const idx = responses.findIndex((r) => r.question_id === step.id)
  if (idx >= 0) responses[idx] = newItem
  else responses.push(newItem)

  const payload: Record<string, unknown> = {
    user_id: userId,
    responses,
    updated_at: new Date().toISOString(),
  }
  if (existing?.completed_at != null) payload.completed_at = existing.completed_at
  if (existing?.embed_vector != null) payload.embed_vector = existing.embed_vector
  const { error } = await supabase.from('intake_responses_v5').upsert(payload, { onConflict: 'user_id' })
  if (error) throw new Error(error.message)
}

type NewQuestionsFlowProps = {
  orderedSteps: ProfileStep[]
  intake: IntakeResponsesV5Row | null
  userId: string
  onComplete: () => void
}

export function NewQuestionsFlow({ orderedSteps, intake, userId, onComplete }: NewQuestionsFlowProps) {
  const initialAnswers = useMemo(() => buildAnswersFromIntake(intake), [intake])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [answers, setAnswers] = useState<AnswersState>(() => initialAnswers)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const stepsForFlow = useMemo(() => {
    const country = typeof answers.q_home_country === 'string' ? answers.q_home_country.trim() : ''
    return orderedSteps.filter(
      (s) => s.id !== 'q_home_state' || country === HOME_COUNTRY_UNITED_STATES
    )
  }, [orderedSteps, answers.q_home_country])

  useEffect(() => {
    if (stepsForFlow.length === 0) return
    if (currentIndex >= stepsForFlow.length) {
      setCurrentIndex(Math.max(0, stepsForFlow.length - 1))
    }
  }, [currentIndex, stepsForFlow.length])

  const step = stepsForFlow[currentIndex]
  const isLast = currentIndex >= stepsForFlow.length - 1
  const value = step ? answers[step.id] : undefined

  async function handleNext() {
    if (!step) return
    setError(null)

    let raw = answers[step.id]
    if (step.id === 'q_market_tenure' && (raw === undefined || raw === '')) {
      raw = MARKET_TENURE_OPTIONS[0]
      setAnswers((a) => ({ ...a, [step.id]: MARKET_TENURE_OPTIONS[0] }))
    }
    if (step.required && (raw === undefined || raw === '' || (Array.isArray(raw) && raw.length === 0))) {
      setError('Please answer this question.')
      return
    }
    if ((step.type === 'multi_select' || step.type === 'searchable_multi') && step.minSelections) {
      const arr = Array.isArray(raw) ? raw : []
      if (arr.length < step.minSelections) {
        setError(`Please choose at least ${step.minSelections}.`)
        return
      }
    }
    if ((step.type === 'multi_select' || step.type === 'searchable_multi') && step.maxSelections != null) {
      const arr = Array.isArray(raw) ? raw : []
      if (arr.length > step.maxSelections) {
        setError(`Please choose at most ${step.maxSelections}.`)
        return
      }
    }

    setSaving(true)
    try {
      const base = raw
      let answer: string | string[] | number =
        step.id === 'q_radius' && (typeof base === 'string' && base !== '')
          ? (base.includes('miles') ? base : `${base} miles`)
          : base
      if (step.id === 'q_home_state' && answers.q_home_country !== HOME_COUNTRY_UNITED_STATES) {
        answer = INTAKE_ANSWER_SKIPPED
      }
      const isEmpty = answer === undefined || answer === '' || (Array.isArray(answer) && answer.length === 0)
      if (step.required !== true && isEmpty) answer = INTAKE_ANSWER_SKIPPED
      await saveIntakeAnswer(userId, step, answer as string | string[] | number)
      if (step.id === 'confirm_intent') {
        const supabase = getSupabase()
        if (supabase) {
          await supabase.from('profiles').update({
            intent_confirmed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }).eq('id', userId)
        }
      }
      setAnswers((a) => ({ ...a, [step.id]: answer }))
      if (isLast) {
        onComplete()
        return
      }
      setCurrentIndex((i) => i + 1)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setSaving(false)
    }
  }

  if (!step) {
    onComplete()
    return null
  }

  const isCompactStep =
    step &&
    ((step.type === 'chips_single' && step.options && step.options.length <= 4) ||
      (step.type === 'multi_select' && step.options && step.options.length <= 6) ||
      step.type === 'text' ||
      step.type === 'select' ||
      step.type === 'slider_snap')

  const tenureHeadline =
    step.id === 'q_market_tenure'
      ? (() => {
          const loc = answers.location as { city?: string } | undefined
          const city = loc && typeof loc.city === 'string' && loc.city.trim() ? loc.city.trim() : ''
          if (!city || city === 'Unknown') return 'How long have you lived in this area?'
          return `How long have you lived in ${city}?`
        })()
      : step.question

  return (
    <div className="app-card app-new-questions-flow">
      <h2 className="onboarding-question" style={{ marginTop: 0 }}>
        {tenureHeadline}
      </h2>

      {step.body && (
        <div className="onboarding-body" style={{ marginBottom: '1rem' }}>
          {step.body.split(/\n\n+/).map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      )}

      {step?.type === 'slider_snap' && step.options && step.id === 'q_market_tenure' && (
        <MarketTenureSlider
          options={step.options}
          value={typeof value === 'string' ? value : undefined}
          disabled={saving}
          onChange={(next) => setAnswers((a) => ({ ...a, [step.id]: next }))}
        />
      )}

      {step?.type === 'searchable_single' && step.options && (
        <SearchableSinglePicker
          step={step as ProfileStep & { type: 'searchable_single'; options: string[] }}
          value={value}
          disabled={saving}
          onChange={(next) => setAnswers((a) => ({ ...a, [step.id]: next }))}
        />
      )}

      {step?.type === 'chips_single' && step.options && (
        <div>
          {step.options.map((opt) => {
            const isSelected = value === opt
            return (
            <button
              key={opt}
              type="button"
              className={`onboarding-chip ${isSelected ? 'selected' : ''}`}
              onClick={() =>
                setAnswers((a) => (isSelected ? { ...a, [step.id]: '' } : { ...a, [step.id]: opt }))
              }
              disabled={saving}
            >
              {step.id === 'q_radius' && !String(opt).includes('miles') ? `${opt} miles` : opt}
            </button>
          )})}
        </div>
      )}

      {step?.type === 'text' && (
        <input
          type="text"
          className="auth-input"
          placeholder={step.placeholder || ''}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => setAnswers((a) => ({ ...a, [step.id]: e.target.value }))}
          disabled={saving}
          autoComplete="off"
        />
      )}

      {step?.type === 'select' && step.options && (
        <select
          className="auth-input"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => {
            const v = e.target.value
            setAnswers((a) => {
              const next = { ...a, [step.id]: v }
              if (step.id === 'q_home_country' && v !== HOME_COUNTRY_UNITED_STATES) {
                next.q_home_state = ''
              }
              return next
            })
          }}
          disabled={saving}
          aria-label={step.question}
        >
          <option value="">(Optional)</option>
          {step.options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      )}

      {step?.type === 'searchable_multi' && step.options && (
        <SearchableMultiPicker
          step={step as ProfileStep & { type: 'searchable_multi'; options: string[] }}
          value={value}
          disabled={saving}
          onChange={(next) => setAnswers((a) => ({ ...a, [step.id]: next }))}
        />
      )}

      {step?.type === 'multi_select' && step.options && (
        <div>
          {step.options.map((opt) => {
            const arr = (Array.isArray(value) ? value : []) as string[]
            const selected = arr.includes(opt)
            const isPreferNotToSay = opt === 'Prefer not to say'
            const isExclusiveOption =
              (step.id === 'q_convo_feel' && opt === 'A mix — see where it goes') ||
              (step.id === 'q_openness' && opt === "I'm open to anyone")
            const atMax =
              step.maxSelections != null && arr.length >= step.maxSelections && !selected
            const exclusiveOptionText =
              step.id === 'q_convo_feel'
                ? 'A mix — see where it goes'
                : step.id === 'q_openness'
                  ? "I'm open to anyone"
                  : null
            return (
              <button
                key={opt}
                type="button"
                className={`onboarding-chip ${selected ? 'multi-selected' : ''}`}
                onClick={() => {
                  if (selected) {
                    setAnswers((a) => ({ ...a, [step.id]: arr.filter((x) => x !== opt) }))
                  } else if (isPreferNotToSay) {
                    setAnswers((a) => ({ ...a, [step.id]: [opt] }))
                  } else if (arr.includes('Prefer not to say')) {
                    setAnswers((a) => ({ ...a, [step.id]: [...arr.filter((x) => x !== 'Prefer not to say'), opt] }))
                  } else if (isExclusiveOption) {
                    setAnswers((a) => ({ ...a, [step.id]: [opt] }))
                  } else if (exclusiveOptionText) {
                    const withoutExclusive = arr.filter((x) => x !== exclusiveOptionText)
                    const max = step.maxSelections ?? Infinity
                    if (withoutExclusive.length < max)
                      setAnswers((a) => ({ ...a, [step.id]: [...withoutExclusive, opt] }))
                  } else if (!atMax) {
                    setAnswers((a) => ({ ...a, [step.id]: [...arr, opt] }))
                  }
                }}
                disabled={saving || (!isExclusiveOption && atMax)}
              >
                {opt}
              </button>
            )
          })}
        </div>
      )}

      {error && (
        <p className="onboarding-error" role="alert" style={{ marginTop: '0.75rem' }}>
          {error}
        </p>
      )}

      <div className={`app-new-questions-flow-actions${isCompactStep ? ' app-new-questions-flow-actions--compact' : ''}`}>
        <button
          type="button"
          className="btn btn-primary btn-block"
          onClick={handleNext}
          disabled={saving}
        >
          {saving ? 'Saving…' : isLast ? 'Done' : 'Continue'}
        </button>
      </div>
    </div>
  )
}
