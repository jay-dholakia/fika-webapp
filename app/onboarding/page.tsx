'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { getSupabase } from '@/lib/supabase'
import { useOnboardingStatus } from '@/lib/use-onboarding'
import { authLog } from '@/lib/auth-log'
import {
  PROFILE_STEPS,
  INTAKE_STEPS,
  TOTAL_ONBOARDING_STEPS,
  type ProfileStep,
} from '@/lib/onboarding-data'
import type { IntakeResponseItem } from '@/lib/db-types'
import type { ProfileRow } from '@/lib/db-types'
import type { IntakeResponsesV5Row } from '@/lib/db-types'

const ALL_STEPS = [...PROFILE_STEPS, ...INTAKE_STEPS]

type AnswersState = Record<string, string | string[] | number | { city: string; lat: number; lng: number }>

function getFirstUnansweredStepAndAnswers(
  profile: ProfileRow | null,
  intake: IntakeResponsesV5Row | null
): { stepIndex: number; answers: AnswersState } {
  const answers: AnswersState = {}

  for (let i = 0; i < PROFILE_STEPS.length; i++) {
    const s = PROFILE_STEPS[i]
    if (s.id === 'first_name') {
      const v = profile?.first_name?.trim()
      if (!v || v === '') return { stepIndex: i, answers }
      answers.first_name = v
    } else if (s.id === 'birthdate') {
      if (!profile?.birthdate) return { stepIndex: i, answers }
      answers.birthdate = profile.birthdate
    } else if (s.id === 'gender') {
      if (profile?.gender) answers.gender = profile.gender
      if (!profile?.gender) return { stepIndex: i, answers }
    } else if (s.id === 'gender_preference') {
      if (profile?.gender_preference) answers.gender_preference = profile.gender_preference
      if (!profile?.gender_preference) return { stepIndex: i, answers }
    } else if (s.id === 'pronouns') {
      if (profile?.pronouns) answers.pronouns = profile.pronouns
      return { stepIndex: i, answers }
    } else if (s.id === 'languages') {
      if (Array.isArray(profile?.languages)) answers.languages = profile.languages
      return { stepIndex: i, answers }
    } else if (s.id === 'location') {
      if (!profile?.city) return { stepIndex: i, answers }
      answers.location = { city: profile.city, lat: profile.lat ?? 0, lng: profile.lng ?? 0 }
    } else if (s.id === 'confirm_intent') {
      if (!profile?.intent_confirmed_at) return { stepIndex: i, answers }
    }
  }

  const responses = intake?.responses ?? []
  for (let j = 0; j < INTAKE_STEPS.length; j++) {
    const s = INTAKE_STEPS[j]
    const r = responses.find((x: IntakeResponseItem) => x.question_id === s.id)
    if (!r) return { stepIndex: PROFILE_STEPS.length + j, answers }
    answers[s.id] = r.answer as string | string[] | number
  }

  return { stepIndex: ALL_STEPS.length - 1, answers }
}

function parseDate(s: string): string | null {
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}

function is18Plus(dateStr: string): boolean {
  const d = new Date(dateStr)
  const today = new Date()
  let age = today.getFullYear() - d.getFullYear()
  const m = today.getMonth() - d.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age--
  return age >= 18
}

export default function OnboardingPage() {
  const router = useRouter()
  const [sessionUserId, setSessionUserId] = useState<string | null>(null)
  const [sessionChecked, setSessionChecked] = useState(false)
  const { loading: statusLoading, isComplete, profile, intake } = useOnboardingStatus(sessionUserId ?? undefined)

  const [stepIndex, setStepIndex] = useState(0)
  const [displayStepIndex, setDisplayStepIndex] = useState(0)
  const [isExiting, setIsExiting] = useState(false)
  const [answers, setAnswers] = useState<AnswersState>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [locationStatus, setLocationStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')

  useEffect(() => {
    authLog('onboarding:mount')
    getSupabase()?.auth.getSession().then(({ data: { session } }) => {
      const id = session?.user?.id ?? null
      authLog('onboarding:getSession', { hasSession: !!session, userId: id?.slice(0, 8) })
      setSessionUserId(id)
      setSessionChecked(true)
    })
  }, [])

  useEffect(() => {
    if (sessionUserId == null) return
    if (!statusLoading && isComplete) {
      authLog('onboarding:redirect', { to: '/app', reason: 'isComplete' })
      router.replace('/app')
    }
  }, [sessionUserId, statusLoading, isComplete, router])

  useEffect(() => {
    if (statusLoading || isComplete || sessionUserId == null) return
    const { stepIndex: first, answers: prefilled } = getFirstUnansweredStepAndAnswers(profile ?? null, intake ?? null)
    setStepIndex(first)
    setDisplayStepIndex(first)
    setAnswers(prefilled)
    if (first < PROFILE_STEPS.length && PROFILE_STEPS[first].id === 'location' && prefilled.location) {
      setLocationStatus('done')
    }
  }, [statusLoading, isComplete, sessionUserId, profile, intake])

  useEffect(() => {
    if (!sessionUserId) return
    const supabase = getSupabase()
    if (!supabase) return
    supabase
      .from('profiles')
      .select('id')
      .eq('id', sessionUserId)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) {
          supabase.from('profiles').insert({ id: sessionUserId, first_name: ' ' }).then(() => {})
        }
      })
  }, [sessionUserId])

  const step = ALL_STEPS[stepIndex]
  const displayStep = ALL_STEPS[displayStepIndex] ?? step
  const isProfileStep = stepIndex < PROFILE_STEPS.length
  const isLastStep = stepIndex === ALL_STEPS.length - 1

  async function saveProfileField(
    id: string,
    value: string | number | { city: string; lat: number; lng: number } | null,
    currentAnswers?: Record<string, unknown>
  ) {
    if (!sessionUserId) return
    const supabase = getSupabase()
    if (!supabase) return
    const updates: Record<string, unknown> = { id: sessionUserId }
    // first_name is NOT NULL in DB: always set it (from this save, from previous answers, or placeholder)
    const firstName =
      id === 'first_name' && typeof value === 'string'
        ? value.trim() || ' '
        : (currentAnswers?.first_name as string)?.trim() || ' '
    updates.first_name = firstName
    if (id === 'birthdate' && (typeof value === 'string' || value === null)) updates.birthdate = value
    if (id === 'gender' && typeof value === 'string') updates.gender = value
    if (id === 'gender_preference' && typeof value === 'string') updates.gender_preference = value
    if (id === 'pronouns') updates.pronouns = (typeof value === 'string' && value ? value : null)
    if (id === 'languages') updates.languages = Array.isArray(value) ? value : null
    if (id === 'location' && typeof value === 'object' && value !== null && 'city' in value) {
      updates.city = value.city
      updates.lat = value.lat
      updates.lng = value.lng
    }
    if (id === 'confirm_intent') updates.intent_confirmed_at = new Date().toISOString()
    const { error: e } = await supabase.from('profiles').upsert(updates, { onConflict: 'id' })
    if (e) throw new Error(e.message)
  }

  async function saveIntakeAnswer(step: ProfileStep, answer: string | string[] | number) {
    if (!sessionUserId) return
    const supabase = getSupabase()
    if (!supabase) return
    const { data: existing } = await supabase
      .from('intake_responses_v5')
      .select('responses, availability_times')
      .eq('user_id', sessionUserId)
      .maybeSingle()

    const responses: IntakeResponseItem[] = Array.isArray(existing?.responses) ? [...(existing.responses as IntakeResponseItem[])] : []
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
      user_id: sessionUserId,
      responses,
      updated_at: new Date().toISOString(),
    }
    if (step.id === 'q9_availability' && Array.isArray(answer)) {
      payload.availability_times = answer
    }
    const { error: e } = await supabase.from('intake_responses_v5').upsert(payload, { onConflict: 'user_id' })
    if (e) throw new Error(e.message)
  }

  async function callCompleteIntake() {
    const supabase = getSupabase()
    if (!supabase) throw new Error('Not configured')
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) throw new Error('Not authenticated')
    const res = await fetch('/api/complete-intake', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: '{}',
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error((data as { error?: string }).error || `Complete intake failed: ${res.status}`)
    }
  }

  function handleNext() {
    if (!step) return
    setError(null)

    const raw = answers[step.id]
    if (step.required && (raw === undefined || raw === '' || (Array.isArray(raw) && raw.length === 0))) {
      setError('Please answer this question.')
      return
    }
    if (step.type === 'date' && typeof raw === 'string') {
      if (!parseDate(raw)) {
        setError('Please enter a valid date.')
        return
      }
      if (step.minAge && !is18Plus(raw)) {
        setError('You must be 18 or older to use Fika.')
        return
      }
    }
    if (step.type === 'multi_select' && step.minSelections) {
      const arr = Array.isArray(raw) ? raw : []
      if (arr.length < step.minSelections) {
        setError(`Please choose at least ${step.minSelections}.`)
        return
      }
    }

    setSaving(true)
    ;(async () => {
      try {
        if (isProfileStep) {
          if (step.id === 'location' && typeof raw === 'object' && raw !== null && 'city' in (raw as object)) {
            await saveProfileField(step.id, raw as { city: string; lat: number; lng: number }, answers)
          } else if (step.id === 'confirm_intent') {
            await saveProfileField(step.id, 'confirmed', answers)
          } else if (step.id === 'languages' && (Array.isArray(raw) || raw === undefined)) {
            await saveProfileField(step.id, Array.isArray(raw) ? raw : [], answers)
          } else if (typeof raw === 'string' || typeof raw === 'number') {
            await saveProfileField(step.id, raw, answers)
          }
        } else {
          await saveIntakeAnswer(step, raw as string | string[] | number)
        }

        if (isLastStep) {
          await callCompleteIntake()
          router.replace('/app')
          return
        }
        setAnswers((a) => ({ ...a, [step.id]: raw }))
        setIsExiting(true)
        setTimeout(() => {
          setStepIndex((i) => i + 1)
          setDisplayStepIndex((i) => i + 1)
          setIsExiting(false)
        }, 280)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong.')
      } finally {
        setSaving(false)
      }
    })()
  }

  function handleBack() {
    if (stepIndex > 0) {
      setStepIndex((i) => i - 1)
      setDisplayStepIndex((i) => i - 1)
    }
    setError(null)
  }

  async function reverseGeocodeWithGoogle(lat: number, lng: number): Promise<{ city: string; state: string } | null> {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
    if (!apiKey) return null
    try {
      const res = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${apiKey}`
      )
      const data = (await res.json()) as {
        results?: Array<{
          address_components?: Array<{ long_name: string; short_name: string; types: string[] }>
        }>
      }
      const comps = data.results?.[0]?.address_components
      if (!comps) return null
      let cityVal = ''
      let stateVal = ''
      for (const c of comps) {
        if (c.types?.includes('locality')) cityVal = c.long_name ?? ''
        if (c.types?.includes('administrative_area_level_1')) stateVal = c.short_name ?? ''
      }
      return { city: cityVal, state: stateVal }
    } catch {
      return null
    }
  }

  function handleLocation() {
    setLocationStatus('loading')
    setError(null)
    if (!navigator.geolocation) {
      setError('Geolocation is not supported.')
      setLocationStatus('error')
      return
    }
    // timeout 15s; don't require high accuracy so we can get a coarse fix faster (avoids kCLErrorLocationUnknown when GPS can't get a fix)
    const options: PositionOptions = {
      enableHighAccuracy: false,
      timeout: 15000,
      maximumAge: 60000,
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude
        const lng = pos.coords.longitude
        try {
          // Prefer Google Geocoding (same as Ready for Fika) when key is set; no CORS
          const googleResult = await reverseGeocodeWithGoogle(lat, lng)
          if (googleResult) {
            const cityStr = googleResult.state
              ? `${googleResult.city}, ${googleResult.state}`
              : googleResult.city || 'Unknown'
            setAnswers((a) => ({ ...a, location: { city: cityStr, lat, lng } }))
            setLocationStatus('done')
            return
          }
          // Fallback: our API proxy calls Nominatim server-side (avoids CORS/403)
          const res = await fetch(`/api/geocode?lat=${lat}&lng=${lng}`)
          const data = (await res.json()) as { city?: string; error?: string }
          if (!res.ok || data.error) throw new Error(data.error ?? 'Geocode failed')
          const cityStr = data.city ?? 'Unknown'
          setAnswers((a) => ({ ...a, location: { city: cityStr, lat, lng } }))
          setLocationStatus('done')
        } catch {
          setAnswers((a) => ({ ...a, location: { city: 'Unknown', lat, lng } }))
          setLocationStatus('done')
        }
      },
      (err) => {
        // err.code: 1 = PERMISSION_DENIED, 2 = POSITION_UNAVAILABLE (e.g. kCLErrorLocationUnknown), 3 = TIMEOUT
        const message =
          err.code === 1
            ? 'Location access was denied. Please allow location in your browser or device settings and try again.'
            : 'We couldn’t get your location. Try again in a moment, or move to a spot with better signal.'
        setError(message)
        setLocationStatus('error')
      },
      options
    )
  }

  if (!sessionChecked) {
    authLog('onboarding:render', { show: 'Loading', sessionChecked: false })
    return (
      <div className="onboarding-wrap">
        <div className="onboarding-progress">
          <div className="onboarding-progress-inner" style={{ width: '0%' }} />
        </div>
        <p className="onboarding-question">Loading…</p>
      </div>
    )
  }

  if (sessionUserId == null) {
    authLog('onboarding:render', { show: 'Please log in', sessionChecked: true })
    return (
      <div className="onboarding-wrap">
        <p>Please log in to continue.</p>
        <Link href="/login" className="btn btn-primary">
          Log in
        </Link>
      </div>
    )
  }

  if (statusLoading || !step) {
    authLog('onboarding:render', { show: 'Loading', statusLoading, stepId: step?.id })
    return (
      <div className="onboarding-wrap">
        <div className="onboarding-progress">
          <div className="onboarding-progress-inner" style={{ width: '0%' }} />
        </div>
        <p className="onboarding-question">Loading…</p>
      </div>
    )
  }

  authLog('onboarding:render', { show: 'form', stepId: step.id, stepIndex })
  const progress = ((stepIndex + 1) / TOTAL_ONBOARDING_STEPS) * 100
  const value = answers[displayStep.id]

  return (
    <div className="onboarding-wrap">
      <Link href="/" className="logo" style={{ marginBottom: '1rem', display: 'inline-block' }}>
        fika
      </Link>
      <div className="onboarding-progress">
        <div className="onboarding-progress-inner" style={{ width: `${progress}%` }} />
      </div>

      <div
        className={`onboarding-step ${isExiting ? 'onboarding-step-exit' : 'onboarding-step-enter'}`}
        key={displayStepIndex}
      >
        <h2 className="onboarding-question">{displayStep.question}</h2>

        {displayStep.body && (
          <div className="onboarding-body">
            {displayStep.body.split(/\n\n+/).map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        )}

        {displayStep.type === 'text' && (
          <input
            id={`onboarding-${displayStep.id}`}
            name={displayStep.id}
            type="text"
            className="auth-input"
            placeholder={displayStep.placeholder || ''}
            value={(value as string) ?? ''}
            onChange={(e) => setAnswers((a) => ({ ...a, [displayStep.id]: e.target.value }))}
            disabled={saving}
            autoFocus
            autoComplete={displayStep.id === 'first_name' ? 'given-name' : 'off'}
          />
        )}

        {displayStep.type === 'date' && (
          <input
            id={`onboarding-${displayStep.id}`}
            name={displayStep.id}
            type="date"
            className="auth-input"
            value={(value as string) ?? ''}
            onChange={(e) => setAnswers((a) => ({ ...a, [displayStep.id]: e.target.value }))}
            disabled={saving}
            autoFocus
            autoComplete={displayStep.id === 'birthdate' ? 'bday' : 'off'}
          />
        )}

        {displayStep.type === 'chips_single' && displayStep.options && (
          <div>
            {displayStep.options.map((opt) => (
              <button
                key={opt}
                type="button"
                className={`onboarding-chip ${value === opt ? 'selected' : ''}`}
                onClick={() => {
                  if (value === opt) {
                    setAnswers((a) => {
                      const next = { ...a }
                      delete next[displayStep.id]
                      return next
                    })
                  } else {
                    setAnswers((a) => ({ ...a, [displayStep.id]: opt }))
                  }
                }}
                disabled={saving}
              >
                {opt}
              </button>
            ))}
          </div>
        )}

        {displayStep.type === 'location_permission' && (
          <div>
            <button
              type="button"
              className="onboarding-location-btn"
              onClick={handleLocation}
              disabled={locationStatus === 'loading'}
            >
              {locationStatus === 'loading'
                ? 'Getting location…'
                : locationStatus === 'done' && value && typeof value === 'object' && 'city' in (value as object)
                  ? `✓ ${(value as { city: string }).city}`
                  : 'Use My Location'}
            </button>
          </div>
        )}

        {displayStep.type === 'multi_select' && displayStep.options && (
          <div>
            {displayStep.options.map((opt) => {
              const arr = (Array.isArray(value) ? value : []) as string[]
              const selected = arr.includes(opt)
              const isExclusiveOption =
                (displayStep.id === 'q10_first_conversation_feel' && opt === 'A mix — see where it goes') ||
                (displayStep.id === 'q6_who_excited_to_meet' && opt === "I'm open — surprise me")
              const atMax = displayStep.maxSelections != null && arr.length >= displayStep.maxSelections && !selected
              const exclusiveOptionText =
                displayStep.id === 'q10_first_conversation_feel'
                  ? 'A mix — see where it goes'
                  : displayStep.id === 'q6_who_excited_to_meet'
                    ? "I'm open — surprise me"
                    : null
              return (
                <button
                  key={opt}
                  type="button"
                  className={`onboarding-chip ${selected ? 'multi-selected' : ''}`}
                  onClick={() => {
                    if (selected) {
                      setAnswers((a) => ({ ...a, [displayStep.id]: arr.filter((x) => x !== opt) }))
                    } else if (isExclusiveOption) {
                      setAnswers((a) => ({ ...a, [displayStep.id]: [opt] }))
                    } else if (exclusiveOptionText) {
                      const withoutExclusive = arr.filter((x) => x !== exclusiveOptionText)
                      const max = displayStep.maxSelections ?? Infinity
                      if (withoutExclusive.length < max) setAnswers((a) => ({ ...a, [displayStep.id]: [...withoutExclusive, opt] }))
                    } else if (!atMax) {
                      setAnswers((a) => ({ ...a, [displayStep.id]: [...arr, opt] }))
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

        {displayStep.type === 'slider' && (displayStep.sliderRange || displayStep.sliderSteps) && (
          <div className="onboarding-slider-wrap">
            <input
              id={`onboarding-${displayStep.id}`}
              name={displayStep.id}
              type="range"
              className="onboarding-slider"
              min={displayStep.sliderSteps ? 0 : displayStep.sliderRange![0]}
              max={displayStep.sliderSteps ? displayStep.sliderSteps.length - 1 : displayStep.sliderRange![1]}
              step={displayStep.sliderSteps ? 1 : undefined}
              value={
                displayStep.sliderSteps
                  ? (() => {
                      const steps = displayStep.sliderSteps!
                      const num = typeof value === 'number' ? value : displayStep.sliderDefault ?? steps[0]
                      const idx = steps.indexOf(num)
                      return idx >= 0 ? idx : steps.indexOf(displayStep.sliderDefault ?? steps[0]) || 0
                    })()
                  : (typeof value === 'number' ? value : displayStep.sliderDefault ?? displayStep.sliderRange![0])
              }
              onChange={(e) => {
                const raw = Number(e.target.value)
                const next = displayStep.sliderSteps ? displayStep.sliderSteps![raw] : raw
                setAnswers((a) => ({ ...a, [displayStep.id]: next }))
              }}
              disabled={saving}
              autoComplete="off"
            />
            {displayStep.sliderLabel && (
              <p className="onboarding-slider-label">
                {displayStep.sliderLabel(
                  displayStep.sliderSteps
                    ? (() => {
                        const steps = displayStep.sliderSteps!
                        const num = typeof value === 'number' ? value : displayStep.sliderDefault ?? steps[0]
                        return steps.includes(num) ? num : (displayStep.sliderDefault ?? steps[0])
                      })()
                    : (typeof value === 'number' ? value : displayStep.sliderDefault ?? displayStep.sliderRange![0])
                )}
              </p>
            )}
          </div>
        )}

        {displayStep.type === 'open_ended' && (
          <textarea
            id={`onboarding-${displayStep.id}`}
            name={displayStep.id}
            className="auth-input"
            placeholder={displayStep.placeholder || ''}
            value={(value as string) ?? ''}
            onChange={(e) => setAnswers((a) => ({ ...a, [displayStep.id]: e.target.value }))}
            disabled={saving}
            rows={4}
            style={{ resize: 'vertical' }}
            autoComplete="off"
          />
        )}
      </div>

      {error && <p className="onboarding-error" role="alert">{error}</p>}

      <div className={`onboarding-actions ${isExiting ? 'onboarding-actions-disabled' : ''}`}>
        {stepIndex > 0 && (
          <button type="button" className="btn" onClick={handleBack} disabled={saving || isExiting}>
            Back
          </button>
        )}
        <button
          type="button"
          className={`btn btn-primary ${step.id === 'confirm_intent' && !value ? 'btn-primary-muted' : ''}`}
          onClick={handleNext}
          disabled={saving || isExiting || (step.type === 'location_permission' && locationStatus !== 'done' && !value) || (step.id === 'confirm_intent' && !value)}
        >
          {saving ? 'Saving…' : isLastStep ? 'Finish' : 'Continue'}
        </button>
      </div>

      <div className="onboarding-logout">
        <button
          type="button"
          className="onboarding-logout-btn"
          onClick={async () => {
            await getSupabase()?.auth.signOut()
            router.push('/')
            router.refresh()
          }}
          disabled={saving}
        >
          Log out
        </button>
      </div>
    </div>
  )
}
