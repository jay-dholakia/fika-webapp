'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import { getSupabase } from '@/lib/supabase'
import { INTAKE_STEPS, type ProfileStep } from '@/lib/onboarding-data'
import { showSchoolSteps } from '@/lib/onboarding'
import type { IntakeResponseItem } from '@/lib/db-types'
import type { IntakeResponsesV5Row } from '@/lib/db-types'

type AnswersState = Record<string, string | string[] | number>

function buildAnswersFromIntake(intake: IntakeResponsesV5Row | null): AnswersState {
  const responses = Array.isArray(intake?.responses) ? intake.responses : []
  const out: AnswersState = {}
  for (const r of responses) {
    if (r.answer != null) out[r.question_id] = r.answer as string | string[] | number
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
  if (step.id === 'q9_availability' && Array.isArray(answer)) payload.availability_times = answer
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
  const [searchableQuery, setSearchableQuery] = useState('')
  const [majorSearchQuery, setMajorSearchQuery] = useState('')
  const isFirstQuestionMount = useRef(true)

  useEffect(() => {
    if (isFirstQuestionMount.current) {
      isFirstQuestionMount.current = false
      return
    }
    if (typeof window !== 'undefined' && window.innerWidth <= 768) {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }, [currentIndex])

  const step = orderedSteps[currentIndex]
  const nextStep = orderedSteps[currentIndex + 1]
  const gate = answers.q3_work_or_study as string | undefined
  const isStudyPath = showSchoolSteps(gate)
  const showCombinedStudy =
    step?.id === 'q3_university' && nextStep?.id === 'q3_major' && isStudyPath
  const isLast = currentIndex >= orderedSteps.length - 1 && !showCombinedStudy

  const value = step ? answers[step.id] : undefined

  async function handleNext() {
    if (!step) return
    setError(null)

    const raw = answers[step.id]
    if (step.required && (raw === undefined || raw === '' || (Array.isArray(raw) && raw.length === 0))) {
      setError('Please answer this question.')
      return
    }
    if (step.type === 'multi_select' && step.minSelections) {
      const arr = Array.isArray(raw) ? raw : []
      if (arr.length < step.minSelections) {
        setError(`Please choose at least ${step.minSelections}.`)
        return
      }
    }

    setSaving(true)
    try {
      if (showCombinedStudy) {
        await saveIntakeAnswer(userId, step, (answers.q3_university as string) ?? '')
        const majorStep = INTAKE_STEPS.find((s) => s.id === 'q3_major')
        if (majorStep) await saveIntakeAnswer(userId, majorStep, (answers.q3_major as string) ?? '')
        setSearchableQuery('')
        setMajorSearchQuery('')
        const nextIndex = currentIndex + 2
        setCurrentIndex(nextIndex)
        if (nextIndex >= orderedSteps.length) onComplete()
      } else {
        const base = (step.type === 'searchable_single' || step.type === 'single_select') ? (raw ?? '') : raw
        const answer =
          step.id === 'q12_first_conversation' &&
          (base == null || (typeof base === 'string' && !base.trim()))
            ? 'N/A'
            : step.id === 'q8_distance_miles' && (typeof base === 'string' && base !== '')
              ? Number(base)
              : base
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
        setSearchableQuery('')
        if (isLast) {
          onComplete()
          return
        }
        setCurrentIndex((i) => i + 1)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setSaving(false)
    }
  }

  if (!step && !showCombinedStudy) {
    onComplete()
    return null
  }

  const isCompactStep =
    step &&
    ((step.type === 'chips_single' && step.options && step.options.length <= 4) ||
      (step.type === 'multi_select' && step.options && step.options.length <= 6))

  return (
    <div className="app-card app-new-questions-flow">
      <h2 className="onboarding-question" style={{ marginTop: 0 }}>
        {showCombinedStudy ? 'Where/what do you study? (Optional)' : step?.question}
      </h2>

      {!showCombinedStudy && step?.body && (
        <div className="onboarding-body" style={{ marginBottom: '1rem' }}>
          {step.body.split(/\n\n+/).map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      )}

      {showCombinedStudy && step && nextStep && 'options' in nextStep && nextStep.options && (
        <div className="onboarding-study-fields">
          <div className="onboarding-searchable-wrap">
            <label className="onboarding-searchable-label" htmlFor="newq-university">
              What college or university do you go to?
            </label>
            <input
              id="newq-university"
              type="text"
              className="auth-input"
              placeholder={step.placeholder || ''}
              value={searchableQuery !== '' ? searchableQuery : ((answers.q3_university as string) ?? '')}
              onChange={(e) => {
                setSearchableQuery(e.target.value)
                if (!e.target.value.trim()) setAnswers((a) => ({ ...a, q3_university: '' }))
              }}
              onFocus={() => setSearchableQuery((answers.q3_university as string) || '')}
              disabled={saving}
              autoComplete="off"
            />
            {searchableQuery.length > 0 && step.options && (
              <ul className="onboarding-searchable-list" role="listbox">
                {(step.options as string[])
                  .filter((opt) => opt.toLowerCase().includes(searchableQuery.toLowerCase()))
                  .slice(0, 12)
                  .map((opt) => (
                    <li key={opt} role="option">
                      <button
                        type="button"
                        className="onboarding-searchable-option"
                        onClick={() => {
                          setAnswers((a) => ({ ...a, q3_university: opt }))
                          setSearchableQuery('')
                        }}
                        disabled={saving}
                      >
                        {opt}
                      </button>
                    </li>
                  ))}
              </ul>
            )}
          </div>
          <div className="onboarding-searchable-wrap" style={{ marginTop: '1rem' }}>
            <label className="onboarding-searchable-label" htmlFor="newq-major">
              What&apos;s your major?
            </label>
            <input
              id="newq-major"
              type="text"
              className="auth-input"
              placeholder={nextStep.placeholder || 'Search majors…'}
              value={majorSearchQuery !== '' ? majorSearchQuery : ((answers.q3_major as string) ?? '')}
              onChange={(e) => {
                setMajorSearchQuery(e.target.value)
                if (!e.target.value.trim()) setAnswers((a) => ({ ...a, q3_major: '' }))
              }}
              onFocus={() => setMajorSearchQuery((answers.q3_major as string) || '')}
              disabled={saving}
              autoComplete="off"
            />
            {majorSearchQuery.length > 0 && nextStep.options && (
              <ul className="onboarding-searchable-list" role="listbox">
                {(nextStep.options as string[])
                  .filter((opt) => opt.toLowerCase().includes(majorSearchQuery.toLowerCase()))
                  .slice(0, 12)
                  .map((opt) => (
                    <li key={opt} role="option">
                      <button
                        type="button"
                        className="onboarding-searchable-option"
                        onClick={() => {
                          setAnswers((a) => ({ ...a, q3_major: opt }))
                          setMajorSearchQuery('')
                        }}
                        disabled={saving}
                      >
                        {opt}
                      </button>
                    </li>
                  ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {!showCombinedStudy && step?.type === 'chips_single' && step.options && (
        <div>
          {step.options.map((opt) => {
            const isSelected =
              value === opt || (step.id === 'q8_distance_miles' && typeof value === 'number' && value === Number(opt))
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
              {step.id === 'q8_distance_miles' ? `${opt} miles` : opt}
            </button>
          )})}
        </div>
      )}

      {!showCombinedStudy && step?.type === 'single_select' && step.options && (
        <select
          className="auth-input"
          value={((value as string) ?? '')}
          onChange={(e) => setAnswers((a) => ({ ...a, [step.id]: e.target.value }))}
          disabled={saving}
          aria-label={step.question}
        >
          <option value="">{step.placeholder ?? 'Choose…'}</option>
          {(step.options as string[]).map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      )}

      {!showCombinedStudy && step?.type === 'searchable_single' && step.options && (
        <div className="onboarding-searchable-wrap">
          <input
            type="text"
            className="auth-input"
            placeholder={step.placeholder || ''}
            value={searchableQuery !== '' ? searchableQuery : ((value as string) ?? '')}
            onChange={(e) => {
              setSearchableQuery(e.target.value)
              if (!e.target.value.trim()) setAnswers((a) => ({ ...a, [step.id]: '' }))
            }}
            onFocus={() => setSearchableQuery((value as string) || '')}
            disabled={saving}
            autoComplete="off"
          />
          {searchableQuery.length > 0 && (
            <ul className="onboarding-searchable-list" role="listbox">
              {(step.options as string[])
                .filter((opt) => opt.toLowerCase().includes(searchableQuery.toLowerCase()))
                .slice(0, 12)
                .map((opt) => (
                  <li key={opt} role="option">
                    <button
                      type="button"
                      className="onboarding-searchable-option"
                      onClick={() => {
                        setAnswers((a) => ({ ...a, [step.id]: opt }))
                        setSearchableQuery('')
                      }}
                      disabled={saving}
                    >
                      {opt}
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}

      {!showCombinedStudy && step?.type === 'multi_select' && step.options && (
        <div>
          {step.options.map((opt) => {
            const arr = (Array.isArray(value) ? value : []) as string[]
            const selected = arr.includes(opt)
            const isPreferNotToSay = opt === 'Prefer not to say'
            const isExclusiveOption =
              (step.id === 'q10_first_conversation_feel' && opt === 'A mix — see where it goes') ||
              (step.id === 'q6_who_excited_to_meet' && opt === "I'm open to anyone")
            const atMax =
              step.maxSelections != null && arr.length >= step.maxSelections && !selected
            const exclusiveOptionText =
              step.id === 'q10_first_conversation_feel'
                ? 'A mix — see where it goes'
: step.id === 'q6_who_excited_to_meet'
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

      {!showCombinedStudy && step?.type === 'slider' && (step.sliderRange || step.sliderSteps) && (
        <div className="onboarding-slider-wrap">
          <input
            type="range"
            className="onboarding-slider"
            min={step.sliderSteps ? 0 : step.sliderRange![0]}
            max={step.sliderSteps ? step.sliderSteps.length - 1 : step.sliderRange![1]}
            step={step.sliderSteps ? 1 : undefined}
            value={
              step.sliderSteps
                ? (() => {
                    const steps = step.sliderSteps!
                    const num = typeof value === 'number' ? value : step.sliderDefault ?? steps[0]
                    const idx = steps.indexOf(num)
                    return idx >= 0 ? idx : steps.indexOf(step.sliderDefault ?? steps[0]) || 0
                  })()
                : (typeof value === 'number' ? value : step.sliderDefault ?? step.sliderRange![0])
            }
            onChange={(e) => {
              const raw = Number(e.target.value)
              const next = step.sliderSteps ? step.sliderSteps![raw] : raw
              setAnswers((a) => ({ ...a, [step.id]: next }))
            }}
            disabled={saving}
          />
          {step.sliderLabel && (
            <p className="onboarding-slider-label">
              {step.sliderLabel(
                step.sliderSteps
                  ? (() => {
                      const steps = step.sliderSteps!
                      const num = typeof value === 'number' ? value : step.sliderDefault ?? steps[0]
                      return steps.includes(num) ? num : (step.sliderDefault ?? steps[0])
                    })()
                  : (typeof value === 'number' ? value : step.sliderDefault ?? step.sliderRange![0])
              )}
            </p>
          )}
        </div>
      )}

      {!showCombinedStudy && step?.type === 'open_ended' && (
        <textarea
          className="auth-input"
          placeholder={step.placeholder || ''}
          value={(value as string) ?? ''}
          onChange={(e) => setAnswers((a) => ({ ...a, [step.id]: e.target.value }))}
          disabled={saving}
          rows={4}
          style={{ resize: 'vertical' }}
        />
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
