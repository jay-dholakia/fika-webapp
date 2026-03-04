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
import { toE164, isValidPhone } from '@/lib/phone'
import { SmsConciergeCta } from '@/app/app/components/SmsConciergeCta'

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
    } else if (s.id === 'languages') {
      if (Array.isArray(profile?.languages)) answers.languages = profile.languages
      if (!Array.isArray(profile?.languages) || profile.languages.length === 0) return { stepIndex: i, answers }
    } else if (s.id === 'location') {
      if (!profile?.city) return { stepIndex: i, answers }
      answers.location = { city: profile.city, lat: profile.lat ?? 0, lng: profile.lng ?? 0 }
    } else if (s.id === 'phone') {
      if (profile?.phone) answers.phone = profile.phone
      if (!profile?.phone?.trim()) return { stepIndex: i, answers }
      answers.phone = profile.phone
    }
  }

  const responses = intake?.responses ?? []
  for (let j = 0; j < INTAKE_STEPS.length; j++) {
    const s = INTAKE_STEPS[j]
    const r = responses.find((x: IntakeResponseItem) => x.question_id === s.id)
    if (s.required !== false && !r) return { stepIndex: PROFILE_STEPS.length + j, answers }
    answers[s.id] = r ? (r.answer as string | string[] | number) : (s.type === 'multi_select' ? [] : '')
  }

  return { stepIndex: ALL_STEPS.length - 1, answers }
}

function getNextStepIndex(fromIndex: number): number {
  return Math.min(fromIndex + 1, ALL_STEPS.length - 1)
}

function getPrevStepIndex(fromIndex: number): number {
  return Math.max(fromIndex - 1, 0)
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

export default function AppOnboardingPage() {
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
  const [zipCode, setZipCode] = useState('')
  const [zipLoading, setZipLoading] = useState(false)

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

  // Scroll to top when step changes (onboarding flow only)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }, [displayStepIndex])

  const step = ALL_STEPS[stepIndex]
  const displayStep = ALL_STEPS[displayStepIndex] ?? step
  const isProfileStep = stepIndex < PROFILE_STEPS.length
  const isLastStep = stepIndex === ALL_STEPS.length - 1

  async function saveProfileField(
    id: string,
    value: string | number | string[] | { city: string; lat: number; lng: number } | null,
    currentAnswers?: Record<string, unknown>
  ) {
    if (!sessionUserId) return
    const supabase = getSupabase()
    if (!supabase) return
    const updates: Record<string, unknown> = { id: sessionUserId }
    const firstName =
      id === 'first_name' && typeof value === 'string'
        ? value.trim() || ' '
        : (currentAnswers?.first_name as string)?.trim() || ' '
    updates.first_name = firstName
    if (id === 'birthdate' && (typeof value === 'string' || value === null)) updates.birthdate = value
    if (id === 'gender' && typeof value === 'string') updates.gender = value
    if (id === 'gender_preference' && typeof value === 'string') updates.gender_preference = value
    if (id === 'languages') updates.languages = Array.isArray(value) ? value : null
    if (id === 'location' && typeof value === 'object' && value !== null && 'city' in value) {
      updates.city = value.city
      updates.lat = value.lat
      updates.lng = value.lng
    }
    if (id === 'phone' && typeof value === 'string') {
      updates.phone = toE164(value.trim()) || null
    }
    const { error: e } = await supabase.from('profiles').upsert(updates, { onConflict: 'id' })
    if (e) throw new Error(e.message)
  }

  async function saveIntakeAnswer(step: ProfileStep, answer: string | string[] | number) {
    if (!sessionUserId) return
    const supabase = getSupabase()
    if (!supabase) return
    const { data: existing } = await supabase
      .from('intake_responses_v5')
      .select('responses')
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
    if (step.type === 'multi_select' && step.maxSelections) {
      const arr = Array.isArray(raw) ? raw : []
      if (arr.length > step.maxSelections) {
        setError(`Please choose at most ${step.maxSelections}.`)
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
    if (step.id === 'phone' && typeof raw === 'string') {
      if (!isValidPhone(raw)) {
        setError('Please enter a valid phone number (at least 10 digits).')
        return
      }
    }

    setSaving(true)
    ;(async () => {
      try {
        if (isProfileStep) {
          if (step.id === 'location' && typeof raw === 'object' && raw !== null && 'city' in (raw as object)) {
            await saveProfileField(step.id, raw as { city: string; lat: number; lng: number }, answers)
          } else if (step.id === 'languages' && (Array.isArray(raw) || raw === undefined)) {
            await saveProfileField(step.id, Array.isArray(raw) ? raw : [], answers)
          } else if (step.id === 'phone' && typeof raw === 'string') {
            await saveProfileField(step.id, toE164(raw.trim()), answers)
          } else if (typeof raw === 'string' || typeof raw === 'number') {
            await saveProfileField(step.id, raw, answers)
          }
          setAnswers((a) => ({ ...a, [step.id]: raw }))
          setIsExiting(true)
          setTimeout(() => {
            setStepIndex((i) => i + 1)
            setDisplayStepIndex((i) => i + 1)
            setIsExiting(false)
          }, 280)
        } else {
          const intakeAnswer = raw as string | string[] | number
          await saveIntakeAnswer(step, intakeAnswer)
          if (step.id === 'confirm_intent' && sessionUserId) {
            const supabase = getSupabase()
            if (supabase) {
              await supabase.from('profiles').update({
                intent_confirmed_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              }).eq('id', sessionUserId)
            }
          }
          const updatedAnswers = { ...answers, [step.id]: intakeAnswer }
          if (isLastStep) {
            await callCompleteIntake()
            router.replace('/app?justCompletedIntro=1')
            return
          }
          setAnswers((a) => ({ ...a, [step.id]: intakeAnswer }))
          const nextIndex = stepIndex + 1
          setIsExiting(true)
          setTimeout(() => {
            setStepIndex(nextIndex)
            setDisplayStepIndex(nextIndex)
            setIsExiting(false)
          }, 280)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong.')
      } finally {
        setSaving(false)
      }
    })()
  }

  function handleBack() {
    if (stepIndex > 0) {
      const prevIndex = getPrevStepIndex(stepIndex)
      setStepIndex(prevIndex)
      setDisplayStepIndex(prevIndex)
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
          const googleResult = await reverseGeocodeWithGoogle(lat, lng)
          if (googleResult) {
            const cityStr = googleResult.state
              ? `${googleResult.city}, ${googleResult.state}`
              : googleResult.city || 'Unknown'
            setAnswers((a) => ({ ...a, location: { city: cityStr, lat, lng } }))
            setLocationStatus('done')
            return
          }
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
        const message =
          err.code === 1
            ? 'Location access was denied. Please allow location in your browser or device settings and try again.'
            : "We couldn't get your location. Try again in a moment, or move to a spot with better signal."
        setError(message)
        setLocationStatus('error')
      },
      options
    )
  }

  async function handleZipSubmit(e: React.FormEvent) {
    e.preventDefault()
    const zip = zipCode.trim().replace(/\s+/g, '')
    if (!zip) return
    setError(null)
    setZipLoading(true)
    try {
      const res = await fetch(`/api/geocode?zip=${encodeURIComponent(zip)}`)
      const data = (await res.json()) as { city?: string; lat?: number; lng?: number; error?: string }
      if (!res.ok || data.error) {
        setError(data.error ?? "We couldn't find that zip code. Try again.")
        return
      }
      if (data.lat != null && data.lng != null && data.city) {
        setAnswers((a) => ({ ...a, location: { city: data.city!, lat: data.lat!, lng: data.lng! } }))
        setLocationStatus('done')
      } else {
        setError("We couldn't find that zip code. Try again.")
      }
    } catch {
      setError("We couldn't look up that zip code. Try again.")
    } finally {
      setZipLoading(false)
    }
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
            {displayStep.id === 'confirm_intent' && (
              <p className="onboarding-body-links">
                By continuing, you agree to our{' '}
                <Link href="/terms" target="_blank" rel="noopener noreferrer">Terms of Service</Link>
                {' '}and{' '}
                <Link href="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</Link>.
              </p>
            )}
          </div>
        )}

        {displayStep.type === 'text' && (
          <>
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
            {displayStep.id === 'phone' && (
              <div className="onboarding-body" style={{ marginTop: '1rem' }}>
                <SmsConciergeCta />
              </div>
            )}
          </>
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
          <div className="onboarding-location-wrap">
            {locationStatus === 'loading' || zipLoading ? (
              <div className="onboarding-location-set">
                <span className="onboarding-location-set-icon" aria-hidden>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                    <circle cx="12" cy="10" r="3" />
                  </svg>
                </span>
                <span className="onboarding-location-set-city">
                  {zipLoading ? 'Looking up zip code…' : 'Getting location…'}
                </span>
              </div>
            ) : (
              <>
                <div className="onboarding-location-set">
                  <span className="onboarding-location-set-icon" aria-hidden>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                      <circle cx="12" cy="10" r="3" />
                    </svg>
                  </span>
                  <span className="onboarding-location-set-city">
                    {value && typeof value === 'object' && 'city' in (value as object) ? (value as { city: string }).city : 'Your Location'}
                  </span>
                  <button
                    type="button"
                    className="onboarding-location-change"
                    onClick={handleLocation}
                    disabled={saving}
                  >
                    {value && typeof value === 'object' && 'city' in (value as object) ? 'Change' : 'Use my location'}
                  </button>
                </div>
                <p className="onboarding-location-or">or</p>
                <form className="onboarding-location-zip" onSubmit={handleZipSubmit}>
                  <label htmlFor="onboarding-location-zip-input" className="onboarding-location-zip-label">
                    Enter your zip code
                  </label>
                  <div className="onboarding-location-zip-row">
                    <input
                      id="onboarding-location-zip-input"
                      type="text"
                      inputMode="numeric"
                      autoComplete="postal-code"
                      placeholder="e.g. 90210"
                      className="auth-input onboarding-location-zip-input"
                      value={zipCode}
                      onChange={(e) => setZipCode(e.target.value.replace(/\D/g, '').slice(0, 10))}
                      disabled={saving || zipLoading}
                    />
                    <button
                      type="submit"
                      className="btn onboarding-location-zip-btn"
                      disabled={saving || zipLoading || !zipCode.trim()}
                    >
                      Use this area
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        )}

        {displayStep.type === 'multi_select' && displayStep.options && (
          <div>
            {displayStep.options.map((opt) => {
              const arr = (Array.isArray(value) ? value : []) as string[]
              const selected = arr.includes(opt)
              const isPreferNotToSay = opt === 'Prefer not to say'
              const isExclusiveOption =
                (displayStep.id === 'q_convo_feel' && opt === 'A mix — see where it goes') ||
                (displayStep.id === 'q_openness' && opt === "I'm open to anyone")
              const atMax = displayStep.maxSelections != null && arr.length >= displayStep.maxSelections && !selected
              const exclusiveOptionText =
                displayStep.id === 'q_convo_feel'
                  ? 'A mix — see where it goes'
                  : displayStep.id === 'q_openness'
                    ? "I'm open to anyone"
                    : null
              return (
                <button
                  key={opt}
                  type="button"
                  className={`onboarding-chip ${selected ? 'multi-selected' : ''}`}
                  onClick={() => {
                    if (selected) {
                      setAnswers((a) => ({ ...a, [displayStep.id]: arr.filter((x) => x !== opt) }))
                    } else if (isPreferNotToSay) {
                      setAnswers((a) => ({ ...a, [displayStep.id]: [opt] }))
                    } else if (arr.includes('Prefer not to say')) {
                      setAnswers((a) => ({ ...a, [displayStep.id]: [...arr.filter((x) => x !== 'Prefer not to say'), opt] }))
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
    </div>
  )
}
