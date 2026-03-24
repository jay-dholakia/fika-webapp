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
import { toE164, isValidPhone } from '@/lib/phone'
import { getMarketFromCityOrLatLngWithDb } from '@/lib/markets'
import { SmsConciergeCta } from '@/app/app/components/SmsConciergeCta'

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
    if (typeof answers.phone === 'string' && answers.phone.trim() && !isValidPhone(answers.phone)) {
      throw new Error('Please enter a valid phone number (at least 10 digits).')
    }
    const firstName = (answers.first_name as string)?.trim() || ' '
    const updates: Record<string, unknown> = {
      id: userId,
      first_name: firstName,
      birthdate: typeof answers.birthdate === 'string' ? answers.birthdate || null : null,
      gender: typeof answers.gender === 'string' ? answers.gender || null : null,
      gender_preference: typeof answers.gender_preference === 'string' ? answers.gender_preference || null : null,
      age_preference: typeof answers.age_preference === 'string' ? answers.age_preference || null : null,
      pronouns: typeof answers.pronouns === 'string' ? answers.pronouns || null : null,
      relationship_status: typeof answers.relationship_status === 'string' ? answers.relationship_status || null : null,
      languages: Array.isArray(answers.languages) ? answers.languages : null,
    }
    const loc = answers.location
    if (typeof loc === 'object' && loc !== null && 'city' in loc) {
      updates.city = loc.city
      updates.lat = loc.lat
      updates.lng = loc.lng
      updates.market = (await getMarketFromCityOrLatLngWithDb(supabase, loc.city, loc.lat, loc.lng))?.slug ?? null
    }
    if (typeof answers.phone === 'string') {
      updates.phone = toE164(answers.phone.trim()) || null
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
      if (step.id === 'gender_preference' || step.id === 'age_preference') continue
      const answer = answers[step.id]
      const normalized =
        step.id === 'q12_first_conversation' &&
        (answer == null || (typeof answer === 'string' && !String(answer).trim()))
          ? 'N/A'
          : (answer ?? '')
      const newItem: IntakeResponseItem = {
        question_id: step.id,
        question_text: step.question,
        answer: normalized as string | number | string[],
        type: step.type,
        answered_at: new Date().toISOString(),
      }
      const idx = existingResponses.findIndex((r) => r.question_id === step.id)
      if (idx >= 0) existingResponses[idx] = newItem
      else existingResponses.push(newItem)
    }
    const filteredResponses = existingResponses.filter((r) => r.question_id !== 'gender_preference' && r.question_id !== 'age_preference')
    const availabilityTimes = answers.q9_availability as string[] | undefined
    const payload: Record<string, unknown> = {
      user_id: userId,
      responses: filteredResponses,
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
      setError('Location is required. Use "Change" to set your location.')
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
      // Recompute embedding after intake edits so match preview uses latest answers.
      const supabase = getSupabase()
      const { data: { session } } = await supabase?.auth.getSession() ?? { data: { session: null } }
      if (session?.access_token) {
        await fetch('/api/complete-intake', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ embedOnly: true }),
        })
      }
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
          className={`auth-input ${step.id === 'first_name' ? 'profile-field-locked' : ''}`}
          placeholder={step.placeholder || ''}
          value={(value as string) ?? ''}
          onChange={(e) => set(e.target.value)}
          disabled={saving}
          readOnly={step.id === 'first_name'}
          autoComplete={step.id === 'first_name' ? 'given-name' : 'off'}
          aria-readonly={step.id === 'first_name'}
        />
      )
    if (step.type === 'date')
      return (
        <input
          id={`profile-${step.id}`}
          name={step.id}
          type="date"
          className={`auth-input ${step.id === 'birthdate' ? 'profile-field-locked' : ''}`}
          value={(value as string) ?? ''}
          onChange={(e) => set(e.target.value)}
          disabled={saving}
          readOnly={step.id === 'birthdate'}
          autoComplete={step.id === 'birthdate' ? 'bday' : 'off'}
          aria-readonly={step.id === 'birthdate'}
        />
      )
    if (step.type === 'chips_single' && step.options)
      return (
        <div className="profile-chips">
          {step.options.map((opt) => {
            const isSelected = value === opt
            return (
              <button
                key={opt}
                type="button"
                className={`onboarding-chip ${isSelected ? 'selected' : ''}`}
                onClick={() => set(isSelected ? '' : opt)}
                disabled={saving}
              >
                {opt}
              </button>
            )
          })}
        </div>
      )
    if (step.type === 'location_permission')
      return (
        <div className="onboarding-location-wrap">
          {locationStatus === 'loading' ? (
            <div className="onboarding-location-set">
              <span className="onboarding-location-set-icon" aria-hidden>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
              </span>
              <span className="onboarding-location-set-city">Getting location…</span>
            </div>
          ) : (
            <div className="onboarding-location-set">
              <span className="onboarding-location-set-icon" aria-hidden>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
              </span>
              <span className="onboarding-location-set-city">
                {value && typeof value === 'object' && 'city' in (value as object) ? (value as { city: string })?.city ?? 'Location set' : 'Your Location'}
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
          )}
        </div>
      )
    if (step.type === 'multi_select' && step.options) {
      const arr = (Array.isArray(value) ? value : []) as string[]
      const atMax = step.maxSelections != null && arr.length >= step.maxSelections
      return (
        <div className="profile-chips">
          {step.options.map((opt) => {
            const selected = arr.includes(opt)
            const isPreferNotToSay = opt === 'Prefer not to say'
            const isExclusiveOption =
              (step.id === 'q10_first_conversation_feel' && opt === 'A mix — see where it goes') ||
              (step.id === 'q6_who_excited_to_meet' && opt === "I'm open to anyone")
            const exclusiveOptionText =
              step.id === 'q10_first_conversation_feel'
                ? 'A mix — see where it goes'
: step.id === 'q6_who_excited_to_meet'
                ? "I'm open to anyone"
                  : null
            const toggle = () => {
              if (selected) set(arr.filter((x) => x !== opt))
              else if (isPreferNotToSay) set([opt])
              else if (arr.includes('Prefer not to say')) set([...arr.filter((x) => x !== 'Prefer not to say'), opt])
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
                onPointerDown={(e) => { if (e.button === 0) toggle() }}
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
          {INTAKE_STEPS.filter((step) => step.id !== 'confirm_intent').map((step) => (
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
              {step.id === 'phone' && answers.phone && (
                <div className="onboarding-body" style={{ marginTop: '0.5rem' }}>
                  <SmsConciergeCta />
                </div>
              )}
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
