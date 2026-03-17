'use client'

import { useState, useEffect, Suspense, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { getSupabase } from '@/lib/supabase'
import { useOnboardingStatus } from '@/lib/use-onboarding'
import { authLog } from '@/lib/auth-log'
import {
  PROFILE_STEPS,
  INTAKE_STEPS,
  type ProfileStep,
} from '@/lib/onboarding-data'
import { buildOnboardingSessionPayload, payloadToAnswers } from '@/lib/onboarding-session-payload'
import { getMarketFromCityOrLatLngWithDb } from '@/lib/markets'
import type { IntakeResponseItem } from '@/lib/db-types'
import type { ProfileRow } from '@/lib/db-types'
import type { IntakeResponsesV5Row } from '@/lib/db-types'

const SECTION_2_IDS = ['q_life_chapter', 'q_everyday_anchor', 'q_work', 'q_interests', 'q_curiosity', 'q_movie_show_recommendation', 'q_book_recommendation', 'q_role_model']
const SECTION_3_IDS = ['q_topics', 'q_avoid_topics', 'q_openness', 'gender_preference', 'age_preference', 'q_hoping_for', 'q_what_makes_great_fika', 'q_radius', 'q_favorite_coffee_shop']
const SECTION_2_STEPS = INTAKE_STEPS.filter((s) => SECTION_2_IDS.includes(s.id))
const SECTION_3_STEPS = INTAKE_STEPS.filter((s) => SECTION_3_IDS.includes(s.id))
const CONFIRM_STEP = INTAKE_STEPS.find((s) => s.id === 'confirm_intent')!

type AnswersState = Record<string, string | string[] | number | { city: string; lat: number; lng: number }>

/** Prefill answers from existing profile + intake (logged-in flow). */
function getInitialAnswers(
  profile: ProfileRow | null,
  intake: IntakeResponsesV5Row | null
): AnswersState {
  const answers: AnswersState = {}
  for (const s of PROFILE_STEPS) {
    if (s.id === 'first_name') answers.first_name = profile?.first_name?.trim() ?? ''
    else if (s.id === 'birthdate') answers.birthdate = profile?.birthdate ?? ''
    else if (s.id === 'gender') answers.gender = profile?.gender ?? ''
    else if (s.id === 'languages') answers.languages = Array.isArray(profile?.languages) ? profile.languages : []
    else if (s.id === 'location' && profile?.city) answers.location = { city: profile.city, lat: profile.lat ?? 0, lng: profile.lng ?? 0 }
  }
  answers.gender_preference = profile?.gender_preference ?? ''
  answers.age_preference = profile?.age_preference ?? ''
  const responses = intake?.responses ?? []
  for (const s of INTAKE_STEPS) {
    const r = responses.find((x: IntakeResponseItem) => x.question_id === s.id)
    let val: string | string[] | number = r ? (r.answer as string | string[] | number) : (s.type === 'multi_select' ? [] : '')
    if (s.type === 'multi_select' && typeof val === 'string') val = [val]
    answers[s.id] = val
  }
  answers.gender_preference = profile?.gender_preference ?? ''
  answers.age_preference = profile?.age_preference ?? ''
  return answers
}

function parseDate(s: string): string | null {
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}

/** Format ISO date (YYYY-MM-DD) for display as MM/DD/YYYY. */
function birthdateToDisplay(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso
  const [, y, m, d] = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)!
  return `${m}/${d}/${y}`
}

/** Format raw input as MM/DD/YYYY with slashes inserted automatically (digits only, max 8). Shows trailing slash after each complete segment so the next keystroke goes after it. */
function formatBirthdateInput(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8)
  if (digits.length <= 1) return digits
  if (digits.length === 2) return `${digits}/`
  if (digits.length <= 3) return `${digits.slice(0, 2)}/${digits.slice(2)}`
  if (digits.length === 4) return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/`
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`
}

/** If pasted value looks like YYYYMMDD or YYYY-MM-DD, return MM/DD/YYYY; else return formatted digits. */
function normalizeBirthdatePaste(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8)
  if (digits.length === 8 && (digits.startsWith('19') || digits.startsWith('20'))) {
    const yyyy = digits.slice(0, 4)
    const mm = digits.slice(4, 6)
    const dd = digits.slice(6, 8)
    return `${mm}/${dd}/${yyyy}`
  }
  return formatBirthdateInput(raw)
}

function is18Plus(dateStr: string): boolean {
  const d = new Date(dateStr)
  const today = new Date()
  let age = today.getFullYear() - d.getFullYear()
  const m = today.getMonth() - d.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age--
  return age >= 18
}

function AppOnboardingContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams.get('token')
  const tokenMode = Boolean(token)

  const [sessionUserId, setSessionUserId] = useState<string | null>(null)
  const [sessionChecked, setSessionChecked] = useState(false)
  const [sessionLoadedForToken, setSessionLoadedForToken] = useState(false)
  const [showGoogleSignIn, setShowGoogleSignIn] = useState(false)
  const [tokenError, setTokenError] = useState<string | null>(null)
  const { loading: statusLoading, isComplete, profile, intake } = useOnboardingStatus(sessionUserId ?? undefined)

  const [answers, setAnswers] = useState<AnswersState>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [locationStatus, setLocationStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [zipCode, setZipCode] = useState('')
  const [zipLoading, setZipLoading] = useState(false)
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null)
  const submitRef = useRef<HTMLButtonElement>(null)
  const lastMultiSelectRef = useRef<{ stepId: string; opt: string; t: number }>({ stepId: '', opt: '', t: 0 })

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
      router.replace('/app/weeklyfika')
    }
  }, [sessionUserId, statusLoading, isComplete, router])

  // Token (SMS) flow: when no session, load onboarding session and set answers + step
  useEffect(() => {
    if (!tokenMode || !token || sessionUserId != null) return
    let cancelled = false
    fetch(`/api/onboarding-session?token=${encodeURIComponent(token)}`)
      .then((res) => {
        if (cancelled) return
        if (!res.ok) {
          if (res.status === 404) setTokenError('Invalid or expired link. Please text FIKA to get a new link.')
          else setTokenError('Something went wrong. Please try again.')
          setSessionLoadedForToken(true)
          return
        }
        return res.json() as Promise<{ payload?: Record<string, unknown> }>
      })
      .then((data) => {
        if (cancelled || !data?.payload) return
        setAnswers(payloadToAnswers(data.payload as Record<string, unknown>))
        const payload = data.payload as Record<string, unknown>
        if (payload?.city && typeof payload?.lat === 'number' && typeof payload?.lng === 'number') {
          setLocationStatus('done')
        }
        setSessionLoadedForToken(true)
      })
      .catch(() => { if (!cancelled) { setTokenError('Something went wrong. Please try again.'); setSessionLoadedForToken(true) } })
    return () => { cancelled = true }
  }, [tokenMode, token, sessionUserId])

  // Token mode: debounced auto-save so progress is persisted when they reopen the link
  useEffect(() => {
    if (!tokenMode || !token || !sessionLoadedForToken || showGoogleSignIn) return
    const t = setTimeout(() => {
      const payload = buildOnboardingSessionPayload(answers)
      fetch('/api/onboarding-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, payload }),
      }).catch(() => {})
    }, 1500)
    return () => clearTimeout(t)
  }, [answers, tokenMode, token, sessionLoadedForToken, showGoogleSignIn])

  useEffect(() => {
    if (tokenMode && sessionUserId != null) {
      router.replace('/app/weeklyfika')
      return
    }
  }, [tokenMode, sessionUserId, router])

  useEffect(() => {
    if (statusLoading || isComplete || sessionUserId == null || tokenMode) return
    setAnswers(getInitialAnswers(profile ?? null, intake ?? null))
    if (profile?.city) setLocationStatus('done')
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
          supabase.from('profiles').insert({ id: sessionUserId, first_name: ' ', updated_at: new Date().toISOString() }).then(() => {})
        }
      })
  }, [sessionUserId])

  function validateAll(): string | null {
    for (const s of PROFILE_STEPS) {
      const raw = answers[s.id]
      if (s.required !== false) {
        if (raw === undefined || raw === '' || (Array.isArray(raw) && raw.length === 0))
          return `Please answer: ${s.question}`
        if (s.id === 'location') {
          if (typeof raw !== 'object' || !raw || !('city' in raw)) return `Please set your location.`
          if (locationStatus !== 'done' && !(raw as { city?: string }).city) return `Please set your location.`
        }
        if (s.type === 'date' && typeof raw === 'string') {
          if (!parseDate(raw)) return 'Please enter a valid date.'
          if (s.minAge && !is18Plus(raw)) return 'You must be 18 or older to use Fika.'
        }
        if (s.type === 'multi_select' && s.maxSelections) {
          const arr = Array.isArray(raw) ? raw : []
          if (arr.length > s.maxSelections) return `Please choose at most ${s.maxSelections} for: ${s.question}`
        }
        if (s.type === 'multi_select' && s.minSelections) {
          const arr = Array.isArray(raw) ? raw : []
          if (arr.length < s.minSelections) return `Please choose at least ${s.minSelections} for: ${s.question}`
        }
      }
    }
    for (const s of [...SECTION_2_STEPS, ...SECTION_3_STEPS]) {
      const raw = answers[s.id]
      if (s.required !== false && (raw === undefined || raw === '' || (Array.isArray(raw) && raw.length === 0)))
        return `Please answer: ${s.question}`
      if (s.type === 'multi_select' && s.maxSelections) {
        const arr = Array.isArray(raw) ? raw : []
        if (arr.length > s.maxSelections) return `Please choose at most ${s.maxSelections}.`
      }
    }
    const confirmRaw = answers.confirm_intent
    if (!avatarFile) return 'Please upload a profile photo.'
    if (confirmRaw !== "I'm in") return "Please confirm you're in by selecting \"I'm in\"."
    return null
  }

  async function saveAllProfileFields() {
    if (!sessionUserId) return
    const supabase = getSupabase()
    if (!supabase) return
    const loc = answers.location as { city: string; lat: number; lng: number } | undefined
    const birthdateIso = typeof answers.birthdate === 'string' ? parseDate(answers.birthdate) : null
    const updates: Record<string, unknown> = {
      id: sessionUserId,
      first_name: (typeof answers.first_name === 'string' ? answers.first_name.trim() : '') || ' ',
      birthdate: birthdateIso ?? null,
      gender: (typeof answers.gender === 'string' ? answers.gender : null) ?? null,
      gender_preference: (typeof answers.gender_preference === 'string' ? answers.gender_preference : null) ?? null,
      age_preference: (typeof answers.age_preference === 'string' ? answers.age_preference : null) ?? null,
      languages: Array.isArray(answers.languages) ? answers.languages : null,
      city: loc?.city ?? null,
      lat: typeof loc?.lat === 'number' ? loc.lat : null,
      lng: typeof loc?.lng === 'number' ? loc.lng : null,
      market: (await getMarketFromCityOrLatLngWithDb(supabase, loc?.city, loc?.lat, loc?.lng))?.slug ?? null,
      intent_confirmed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    const { error: e } = await supabase.from('profiles').upsert(updates, { onConflict: 'id' })
    if (e) throw new Error(e.message)
  }

  async function saveAllIntakeResponses() {
    if (!sessionUserId) return
    const supabase = getSupabase()
    if (!supabase) return
    const responses: IntakeResponseItem[] = INTAKE_STEPS.filter((s) => s.id !== 'gender_preference' && s.id !== 'age_preference').map((s) => {
      const raw = answers[s.id]
      let value: string | string[] | number = raw === undefined || (typeof raw === 'object' && 'city' in (raw as object)) ? (s.type === 'multi_select' ? [] : '') : (raw as string | string[] | number)
      const isEmpty = value === '' || (Array.isArray(value) && value.length === 0)
      if (s.required !== true && isEmpty) value = 'N/A'
      return {
        question_id: s.id,
        question_text: s.question,
        answer: value,
        type: s.type,
        answered_at: new Date().toISOString(),
      }
    })
    const completedAt = new Date().toISOString()
    const { error: e } = await supabase.from('intake_responses_v5').upsert(
      { user_id: sessionUserId, responses, completed_at: completedAt, updated_at: completedAt },
      { onConflict: 'user_id' }
    )
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

  async function handleSubmit() {
    setError(null)
    const err = validateAll()
    if (err) {
      setError(err)
      submitRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
    setSaving(true)
    try {
      if (tokenMode && token) {
        if (!avatarFile) {
          setError('Please upload a profile photo.')
          setSaving(false)
          return
        }
        const form = new FormData()
        form.set('token', token)
        form.set('file', avatarFile)
        const avatarRes = await fetch('/api/onboarding-avatar', { method: 'POST', body: form })
        if (!avatarRes.ok) {
          const data = await avatarRes.json().catch(() => ({}))
          throw new Error((data as { error?: string }).error ?? 'Avatar upload failed')
        }
        const { url: avatarUrl, avatar_path: avatarPath } = (await avatarRes.json()) as { url?: string; avatar_path?: string }
        const payload = buildOnboardingSessionPayload({
          ...answers,
          avatar_url: avatarUrl ?? '',
          avatar_path: avatarPath ?? '',
        })
        const res = await fetch('/api/onboarding-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, payload }),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error((data as { error?: string }).error ?? 'Failed to save')
        }
        setShowGoogleSignIn(true)
        return
      }
      await saveAllProfileFields()
      await saveAllIntakeResponses()
      if (avatarFile) {
        const supabase = getSupabase()
        if (!supabase) throw new Error('Not configured')
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.access_token) throw new Error('Not authenticated')
        const form = new FormData()
        form.set('file', avatarFile)
        const avatarRes = await fetch('/api/avatar-upload', {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.access_token}` },
          body: form,
        })
        if (!avatarRes.ok) {
          const data = await avatarRes.json().catch(() => ({}))
          throw new Error((data as { error?: string }).error ?? 'Avatar upload failed')
        }
      }
      await callCompleteIntake()
      router.replace('/app/weeklyfika?justCompletedIntro=1')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setSaving(false)
    }
  }

  async function handleSignInWithGoogle(smsToken: string) {
    const supabase = getSupabase()
    if (!supabase) return
    try {
      window.scrollTo({ top: 0, left: 0, behavior: 'smooth' })
    } catch {
      // ignore
    }
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    const redirectTo = `${origin}/auth/callback?next=/app/how-it-works&sms_token=${encodeURIComponent(smsToken)}`
    await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } })
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
        <p className="onboarding-question">Loading…</p>
      </div>
    )
  }

  if (tokenMode && !sessionLoadedForToken && sessionUserId == null) {
    return (
      <div className="onboarding-wrap">
        <p className="onboarding-question">Loading…</p>
      </div>
    )
  }

  if (tokenMode && tokenError) {
    return (
      <div className="onboarding-wrap">
        <p className="onboarding-question">{tokenError}</p>
        <Link href="/" className="btn btn-primary" style={{ marginTop: '1rem' }}>
          Go to home
        </Link>
      </div>
    )
  }

  if (showGoogleSignIn && token) {
    return (
      <div className="onboarding-wrap">
        <h2 className="onboarding-question">You&apos;re all set</h2>
        <p className="onboarding-body" style={{ marginTop: '0.5rem' }}>
          Sign in with Google to finalize your account and start matching.
        </p>
        <button type="button" className="btn btn-primary" onClick={() => handleSignInWithGoogle(token)} style={{ marginTop: '1.5rem' }}>
          Sign in with Google
        </button>
      </div>
    )
  }

  if (sessionUserId == null && !tokenMode) {
    authLog('onboarding:render', { show: 'Please log in', sessionChecked: true })
    return (
      <div className="onboarding-wrap">
        <p>Please log in to continue.</p>
        <Link href="/" className="btn btn-primary">
          Go to home
        </Link>
      </div>
    )
  }

  if (!tokenMode && statusLoading) {
    authLog('onboarding:render', { show: 'Loading', statusLoading: true })
    return (
      <div className="onboarding-wrap">
        <p className="onboarding-question">Loading…</p>
      </div>
    )
  }

  authLog('onboarding:render', { show: 'single-page-form' })

  function renderField(step: ProfileStep) {
    const value = answers[step.id]
    return (
      <div key={step.id} className="onboarding-field-wrap">
        <h3 className="onboarding-question">{step.question}</h3>
        {step.body && (
          <div className="onboarding-body">
            {step.body.split(/\n\n+/).map((p, i) => (
              <p key={i}>{p}</p>
            ))}
            {step.id === 'confirm_intent' && (
              <p className="onboarding-body-links">
                By continuing, you agree to our{' '}
                <Link href="/terms" target="_blank" rel="noopener noreferrer">Terms of Service</Link>
                {' '}and{' '}
                <Link href="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</Link>.
              </p>
            )}
          </div>
        )}
        {step.type === 'text' && (
          <input
            id={`onboarding-${step.id}`}
            name={step.id}
            type="text"
            className="auth-input"
            placeholder={step.placeholder || ''}
            value={(value as string) ?? ''}
            onChange={(e) => setAnswers((a) => ({ ...a, [step.id]: e.target.value }))}
            disabled={saving}
            autoComplete={step.id === 'first_name' ? 'given-name' : 'off'}
          />
        )}
        {step.type === 'date' && (
          <input
            id={`onboarding-${step.id}`}
            name={step.id}
            type="text"
            className="auth-input"
            placeholder={step.placeholder ?? 'MM/DD/YYYY'}
            value={step.id === 'birthdate' && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
              ? birthdateToDisplay(value)
              : ((value as string) ?? '')}
            onChange={(e) => setAnswers((a) => ({
              ...a,
              [step.id]: step.id === 'birthdate' ? normalizeBirthdatePaste(e.target.value) : e.target.value,
            }))}
            disabled={saving}
            autoComplete={step.id === 'birthdate' ? 'bday' : 'off'}
          />
        )}
        {step.type === 'chips_single' && step.options && (
          <div>
            {step.options.map((opt) => (
              <button
                key={opt}
                type="button"
                className={`onboarding-chip ${value === opt ? 'selected' : ''}`}
                onPointerDown={(e) => {
                  if (e.button === 0) setAnswers((a) => ({ ...a, [step.id]: opt }))
                }}
                onClick={() => setAnswers((a) => ({ ...a, [step.id]: opt }))}
                disabled={saving}
              >
                {opt}
              </button>
            ))}
          </div>
        )}
        {step.type === 'location_permission' && (
          <div className="onboarding-location-wrap">
            {locationStatus === 'loading' || zipLoading ? (
              <div className="onboarding-location-set">
                <span className="onboarding-location-set-icon" aria-hidden>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
                  </svg>
                </span>
                <span className="onboarding-location-set-city">{zipLoading ? 'Looking up zip code…' : 'Getting location…'}</span>
              </div>
            ) : (
              <>
                <div className="onboarding-location-set">
                  <span className="onboarding-location-set-icon" aria-hidden>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
                    </svg>
                  </span>
                  <span className="onboarding-location-set-city">
                    {value && typeof value === 'object' && 'city' in (value as object) ? (value as { city: string }).city : 'Your Location'}
                  </span>
                  <button type="button" className="onboarding-location-change" onClick={handleLocation} disabled={saving}>
                    {value && typeof value === 'object' && 'city' in (value as object) ? 'Change' : 'Use my location'}
                  </button>
                </div>
                <p className="onboarding-location-or">or</p>
                <form className="onboarding-location-zip" onSubmit={handleZipSubmit}>
                  <label htmlFor="onboarding-location-zip-input" className="onboarding-location-zip-label">Enter your zip code</label>
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
                    <button type="submit" className="btn onboarding-location-zip-btn" disabled={saving || zipLoading || !zipCode.trim()}>
                      Use Zip Code
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        )}
        {step.type === 'multi_select' && step.options && (
          <div>
            {step.options.map((opt) => {
              const arr = (Array.isArray(value) ? value : []) as string[]
              const selected = arr.includes(opt)
              const isPreferNotToSay = opt === 'Prefer not to say'
              const isExclusiveOption =
                (step.id === 'q_openness' && opt === "I'm open to anyone")
              const atMax = step.maxSelections != null && arr.length >= step.maxSelections && !selected
              const exclusiveOptionText = step.id === 'q_openness' ? "I'm open to anyone" : null

              const handleMultiSelect = () => {
                const now = Date.now()
                if (
                  lastMultiSelectRef.current.stepId === step.id &&
                  lastMultiSelectRef.current.opt === opt &&
                  now - lastMultiSelectRef.current.t < 200
                ) {
                  return
                }
                lastMultiSelectRef.current = { stepId: step.id, opt, t: now }
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
                  if (withoutExclusive.length < (step.maxSelections ?? Infinity)) {
                    setAnswers((a) => ({ ...a, [step.id]: [...withoutExclusive, opt] }))
                  }
                } else if (!atMax) {
                  setAnswers((a) => ({ ...a, [step.id]: [...arr, opt] }))
                }
              }

              return (
                <button
                  key={opt}
                  type="button"
                  className={`onboarding-chip ${selected ? 'multi-selected' : ''}`}
                  onPointerDown={(e) => {
                    if (e.button === 0) {
                      e.preventDefault()
                      handleMultiSelect()
                    }
                  }}
                  onClick={(e) => {
                    e.preventDefault()
                    handleMultiSelect()
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
    )
  }

  return (
    <div className="onboarding-wrap">
      <div className="onboarding-single-page">
        <section className="onboarding-section onboarding-section-card onboarding-welcome-card" aria-label="Welcome">
          <h2 className="onboarding-section-title">Welcome to Fika ☕</h2>
          <p className="onboarding-welcome-body">
            We&apos;re excited you&apos;re here! Fika helps you meet people nearby for real conversations and connection. Answer a few questions below and we&apos;ll get you set up for your first Fika :)
          </p>
        </section>
        <section className="onboarding-section onboarding-section-card">
          <h2 className="onboarding-section-title">About you</h2>
          {PROFILE_STEPS.map(renderField)}
        </section>

        <section className="onboarding-section onboarding-section-card">
          <h2 className="onboarding-section-title">Life & context</h2>
          {SECTION_2_STEPS.map(renderField)}
        </section>

        <section className="onboarding-section onboarding-section-card">
          <h2 className="onboarding-section-title">Conversation & matching</h2>
          {SECTION_3_STEPS.map(renderField)}
        </section>

        <section className="onboarding-section onboarding-section-card onboarding-section-confirm">
          <h2 className="onboarding-section-title">Confirm & finish</h2>
          <div className="onboarding-field-wrap">
            <label className="onboarding-question" htmlFor="onboarding-avatar">Profile photo</label>
            <p className="onboarding-body">Upload a clear photo of your face. This helps others feel comfortable meeting you.</p>
            <div className={`onboarding-avatar-zone ${avatarFile || answers.avatar_url ? 'has-file' : ''}`}>
              {avatarPreviewUrl || (typeof answers.avatar_url === 'string' && answers.avatar_url) ? (
                <img
                  src={avatarPreviewUrl ?? (answers.avatar_url as string)}
                  alt="Preview"
                  className="onboarding-avatar-preview"
                />
              ) : null}
              <input
                id="onboarding-avatar"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="onboarding-avatar-input"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) {
                    setAvatarFile(f)
                    setAvatarPreviewUrl(URL.createObjectURL(f))
                    if (tokenMode) setAnswers((a) => ({ ...a, avatar_url: '' }))
                  }
                }}
              />
              <label htmlFor="onboarding-avatar" className="onboarding-avatar-label">
                {avatarFile || answers.avatar_url ? 'Change photo' : 'Choose photo'}
              </label>
            </div>
          </div>
          <div className="onboarding-field-wrap onboarding-consent-card">
            <h3 className="onboarding-question">{CONFIRM_STEP.question}</h3>
            {CONFIRM_STEP.body && (
              <div className="onboarding-body">
                {CONFIRM_STEP.body.split(/\n\n+/).map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
                <p className="onboarding-body-links">
                  By continuing, you agree to our{' '}
                  <Link href="/terms" target="_blank" rel="noopener noreferrer">Terms of Service</Link>
                  {' '}and{' '}
                  <Link href="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</Link>.
                </p>
              </div>
            )}
            <div className="onboarding-confirm-pill-wrap">
              <button
                type="button"
                className={`onboarding-chip ${answers.confirm_intent === "I'm in" ? 'selected' : ''}`}
                onClick={() => setAnswers((a) => ({ ...a, confirm_intent: "I'm in" }))}
                disabled={saving}
              >
                I&apos;m in
              </button>
            </div>
          </div>

          <button
            ref={submitRef}
            type="button"
            className="btn btn-primary"
            onClick={handleSubmit}
            disabled={saving}
          >
            {saving ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                <span className="spinner" aria-hidden="true" />
                Saving…
              </span>
            ) : (
              'Submit'
            )}
          </button>
        </section>
      </div>

      {error && <p className="onboarding-error" role="alert">{error}</p>}
    </div>
  )
}

export default function AppOnboardingPage() {
  return (
    <Suspense fallback={
      <div className="onboarding-wrap">
        <p className="onboarding-question">Loading…</p>
      </div>
    }>
      <AppOnboardingContent />
    </Suspense>
  )
}
