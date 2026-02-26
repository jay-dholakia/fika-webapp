'use client'

import { useState, useEffect } from 'react'
import { getSupabase } from '@/lib/supabase'
import { useOnboardingStatus } from '@/lib/use-onboarding'
import {
  PROFILE_STEPS,
  INTAKE_STEPS,
  type ProfileStep,
} from '@/lib/onboarding-data'
import {
  getAnswersFromProfileAndIntake,
  type AnswersState,
} from '@/lib/profile-answers'
import type { IntakeResponseItem } from '@/lib/db-types'

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

export default function SettingsProfilePage() {
  const [userId, setUserId] = useState<string | null>(null)
  const { loading: statusLoading, profile, intake } = useOnboardingStatus(userId ?? undefined)
  const [answers, setAnswers] = useState<AnswersState>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [locationStatus, setLocationStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')

  useEffect(() => {
    getSupabase()?.auth.getSession().then(({ data: { session } }) => {
      setUserId(session?.user?.id ?? null)
    })
  }, [])

  useEffect(() => {
    if (statusLoading || !userId || (profile === null && intake === null)) return
    setAnswers(getAnswersFromProfileAndIntake(profile, intake))
    const loc = profile?.city != null ? { city: profile.city, lat: profile.lat ?? 0, lng: profile.lng ?? 0 } : null
    if (loc) setLocationStatus('done')
  }, [userId, statusLoading, profile, intake])

  async function saveProfileFromAnswers() {
    if (!userId) return
    const supabase = getSupabase()
    if (!supabase) throw new Error('Not configured')
    const firstName = (answers.first_name as string)?.trim() || ' '
    const updates: Record<string, unknown> = {
      id: userId,
      first_name: firstName,
      birthdate: typeof answers.birthdate === 'string' ? answers.birthdate || null : null,
      gender: typeof answers.gender === 'string' ? answers.gender || null : null,
      gender_preference: typeof answers.gender_preference === 'string' ? answers.gender_preference || null : null,
      pronouns: typeof answers.pronouns === 'string' ? answers.pronouns || null : null,
      relationship_status: typeof answers.relationship_status === 'string' ? answers.relationship_status || null : null,
      languages: Array.isArray(answers.languages) ? answers.languages : null,
      intent_confirmed_at: answers.confirm_intent === "I'm in" ? new Date().toISOString() : null,
    }
    const loc = answers.location
    if (typeof loc === 'object' && loc !== null && 'city' in loc) {
      updates.city = loc.city
      updates.lat = loc.lat
      updates.lng = loc.lng
    }
    const { error: e } = await supabase.from('profiles').upsert(updates, { onConflict: 'id' })
    if (e) throw new Error(e.message)
  }

  async function saveIntakeFromAnswers() {
    if (!userId) return
    const supabase = getSupabase()
    if (!supabase) return
    const { data: existing } = await supabase
      .from('intake_responses_v5')
      .select('responses, availability_times, completed_at, embed_vector')
      .eq('user_id', userId)
      .maybeSingle()

    const existingResponses: IntakeResponseItem[] = Array.isArray(existing?.responses) ? [...(existing.responses as IntakeResponseItem[])] : []
    const responses: IntakeResponseItem[] = []
    for (const step of INTAKE_STEPS) {
      const answer = answers[step.id]
      const newItem: IntakeResponseItem = {
        question_id: step.id,
        question_text: step.question,
        answer: (answer ?? '') as string | number | string[],
        type: step.type,
        answered_at: new Date().toISOString(),
      }
      const idx = existingResponses.findIndex((r) => r.question_id === step.id)
      if (idx >= 0) existingResponses[idx] = newItem
      else existingResponses.push(newItem)
    }
    const availabilityTimes = answers.q9_availability as string[] | undefined
    const payload: Record<string, unknown> = {
      user_id: userId,
      responses: existingResponses,
      updated_at: new Date().toISOString(),
    }
    if (existing?.completed_at != null) payload.completed_at = existing.completed_at
    if (existing?.embed_vector != null) payload.embed_vector = existing.embed_vector
    if (Array.isArray(availabilityTimes)) payload.availability_times = availabilityTimes
    const { error: e } = await supabase.from('intake_responses_v5').upsert(payload, { onConflict: 'user_id' })
    if (e) throw new Error(e.message)
  }

  async function handleSave() {
    setError(null)
    setSaved(false)
    if (!userId) return
    const firstName = (answers.first_name as string)?.trim()
    if (!firstName) {
      setError('First name is required.')
      return
    }
    if (typeof answers.birthdate === 'string' && answers.birthdate) {
      if (!parseDate(answers.birthdate)) {
        setError('Please enter a valid birth date.')
        return
      }
      if (!is18Plus(answers.birthdate)) {
        setError('You must be 18 or older to use Fika.')
        return
      }
    }
    const loc = answers.location
    if (!(typeof loc === 'object' && loc !== null && 'city' in loc)) {
      setError('Location is required. Use "Use My Location" to set it.')
      return
    }
    const availability = answers.q9_availability
    if (Array.isArray(availability) && availability.length === 0) {
      setError('Please choose at least one availability option (When are you usually up for a good conversation?).')
      return
    }
    setSaving(true)
    try {
      await saveProfileFromAnswers()
      await saveIntakeFromAnswers()
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setSaving(false)
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
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`
          )
          const data = await res.json()
          const city = data.address?.city || data.address?.town || data.address?.village || data.address?.county || 'Unknown'
          const region = data.address?.state || data.address?.region
          const cityStr = region ? `${city}, ${region}` : city
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
            : 'We couldn’t get your location. Try again in a moment, or move to a spot with better signal.'
        setError(message)
        setLocationStatus('error')
      },
      options
    )
  }

  if (statusLoading || (userId && profile === null && intake === null)) {
    return (
      <div className="app-card">
        <p>Loading your profile…</p>
      </div>
    )
  }

  if (!userId) {
    return (
      <div className="app-card">
        <p>Please log in to edit your profile.</p>
      </div>
    )
  }

  function renderStep(step: ProfileStep, value: unknown) {
    const set = (v: string | string[] | number | { city: string; lat: number; lng: number }) =>
      setAnswers((a) => ({ ...a, [step.id]: v }))

    if (step.type === 'text')
      return (
        <input
          id={`profile-${step.id}`}
          name={step.id}
          type="text"
          className="auth-input"
          placeholder={step.placeholder || ''}
          value={(value as string) ?? ''}
          onChange={(e) => set(e.target.value)}
          disabled={saving}
          autoComplete={step.id === 'first_name' ? 'given-name' : 'off'}
        />
      )
    if (step.type === 'date')
      return (
        <input
          id={`profile-${step.id}`}
          name={step.id}
          type="date"
          className="auth-input"
          value={(value as string) ?? ''}
          onChange={(e) => set(e.target.value)}
          disabled={saving}
          autoComplete={step.id === 'birthdate' ? 'bday' : 'off'}
        />
      )
    if (step.type === 'chips_single' && step.options)
      return (
        <div className="profile-chips">
          {step.options.map((opt) => (
            <button
              key={opt}
              type="button"
              className={`onboarding-chip ${value === opt ? 'selected' : ''}`}
              onClick={() => set(opt)}
              disabled={saving}
            >
              {opt}
            </button>
          ))}
        </div>
      )
    if (step.type === 'location_permission')
      return (
        <div>
          <button
            type="button"
            className="onboarding-location-btn"
            onClick={handleLocation}
            disabled={locationStatus === 'loading'}
          >
            {locationStatus === 'loading'
              ? 'Getting location…'
              : locationStatus === 'done'
                ? `✓ ${(value as { city: string })?.city ?? 'Location set'}`
                : 'Use My Location'}
          </button>
        </div>
      )
    if (step.type === 'multi_select' && step.options) {
      const arr = (Array.isArray(value) ? value : []) as string[]
      const atMax = step.maxSelections != null && arr.length >= step.maxSelections
      return (
        <div className="profile-chips">
          {step.options.map((opt) => {
            const selected = arr.includes(opt)
            const isExclusiveOption =
              (step.id === 'q10_first_conversation_feel' && opt === 'A mix — see where it goes') ||
              (step.id === 'q6_who_excited_to_meet' && opt === "I'm open — surprise me")
            const exclusiveOptionText =
              step.id === 'q10_first_conversation_feel'
                ? 'A mix — see where it goes'
                : step.id === 'q6_who_excited_to_meet'
                  ? "I'm open — surprise me"
                  : null
            const toggle = () => {
              if (selected) set(arr.filter((x) => x !== opt))
              else if (isExclusiveOption) set([opt])
              else if (exclusiveOptionText) {
                const withoutExclusive = arr.filter((x) => x !== exclusiveOptionText)
                const max = step.maxSelections ?? Infinity
                if (withoutExclusive.length < max) set([...withoutExclusive, opt])
              }
              else if (!atMax || selected) set([...arr, opt])
            }
            return (
              <button
                key={opt}
                type="button"
                className={`onboarding-chip ${selected ? 'multi-selected' : ''}`}
                onClick={toggle}
                disabled={saving || (!isExclusiveOption && atMax && !selected)}
              >
                {opt}
              </button>
            )
          })}
        </div>
      )
    }
    if (step.type === 'slider' && (step.sliderRange || step.sliderSteps))
      return (
        <div className="onboarding-slider-wrap">
          <input
            id={`profile-${step.id}`}
            name={step.id}
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
              set(step.sliderSteps ? step.sliderSteps[raw] : raw)
            }}
            disabled={saving}
            autoComplete="off"
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
      )
    if (step.type === 'open_ended')
      return (
        <textarea
          id={`profile-${step.id}`}
          name={step.id}
          className="auth-input"
          placeholder={step.placeholder || ''}
          value={(value as string) ?? ''}
          onChange={(e) => set(e.target.value)}
          disabled={saving}
          rows={3}
          style={{ resize: 'vertical' }}
          autoComplete="off"
        />
      )
    return null
  }

  return (
    <div className="profile-edit">
      <div className="app-card">
        <h2>Edit profile</h2>
        <p style={{ color: 'var(--color-textSecondary)', marginBottom: '1.5rem' }}>
          Edit your profile and questionnaire below. Changes are saved when you click Save.
        </p>

        <section className="profile-section">
          <h3 className="profile-section-title">Profile</h3>
          {PROFILE_STEPS.filter((step) => step.id !== 'confirm_intent').map((step) => (
            <div key={step.id} className="profile-field">
              <label htmlFor={`profile-${step.id}`} className="profile-label">
                {step.question}
                {step.required && <span className="profile-required"> *</span>}
              </label>
              {step.body && (
                <div className="onboarding-body">
                  {step.body.split(/\n\n+/).map((p, i) => (
                    <p key={i}>{p}</p>
                  ))}
                </div>
              )}
              <div className="profile-input">
                {renderStep(step, answers[step.id])}
              </div>
            </div>
          ))}
        </section>

        <section className="profile-section">
          <h3 className="profile-section-title">Questionnaire</h3>
          {INTAKE_STEPS.map((step) => (
            <div key={step.id} className="profile-field">
              <label htmlFor={`profile-${step.id}`} className="profile-label">
                {step.question}
                {step.minSelections != null && (
                  <span className="profile-hint"> (at least {step.minSelections})</span>
                )}
                {step.maxSelections != null && !step.minSelections && (
                  <span className="profile-hint"> (up to {step.maxSelections})</span>
                )}
              </label>
              <div className="profile-input">
                {renderStep(step, answers[step.id])}
              </div>
            </div>
          ))}
        </section>

        {error && <p className="onboarding-error" role="alert">{error}</p>}
        {saved && <p className="auth-message" role="status">Your changes have been saved.</p>}

        <div className="profile-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  )
}
