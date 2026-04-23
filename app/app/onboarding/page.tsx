'use client'

import { useState, useEffect, Suspense, useRef, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { GoogleIcon } from '@/app/app/components/GoogleIcon'
import { getSupabase } from '@/lib/supabase'
import { useOnboardingStatus } from '@/lib/use-onboarding'
import { authLog } from '@/lib/auth-log'
import { HOME_COUNTRY_UNITED_STATES } from '@/lib/countries-list'
import {
  PROFILE_STEPS,
  INTAKE_STEPS,
  MARKET_TENURE_OPTIONS,
  type ProfileStep,
} from '@/lib/onboarding-data'
import { buildOnboardingSessionPayload, payloadToAnswers } from '@/lib/onboarding-session-payload'
import { getMarketFromCityOrLatLngWithDb } from '@/lib/markets'
import { checkProfilePhotoSingleFace } from '@/lib/avatar-face-check'
import { SearchableMultiPicker } from '@/app/app/components/SearchableMultiPicker'
import { SearchableSinglePicker } from '@/app/app/components/SearchableSinglePicker'
import { MarketTenureSlider } from '@/app/app/components/MarketTenureSlider'
import type { IntakeResponseItem } from '@/lib/db-types'
import type { ProfileRow } from '@/lib/db-types'
import type { IntakeResponsesV5Row } from '@/lib/db-types'

const BACKGROUND_STEP_IDS = ['q_market_tenure', 'q_ethnicity', 'q_relationship_status'] as const
const SECTION_2_IDS = [...BACKGROUND_STEP_IDS, 'q_work', 'q_interests'] as const
const SECTION_3_IDS = ['q_like_talking_about', 'q_radius', 'q_typical_fika_times'] as const
const SECTION_2_STEPS = INTAKE_STEPS.filter((s) => SECTION_2_IDS.includes(s.id as (typeof SECTION_2_IDS)[number]))
const BACKGROUND_STEPS = SECTION_2_STEPS.filter((s) => BACKGROUND_STEP_IDS.includes(s.id as (typeof BACKGROUND_STEP_IDS)[number]))
const LIFE_CONTEXT_STEPS = SECTION_2_STEPS.filter((s) => !BACKGROUND_STEP_IDS.includes(s.id as (typeof BACKGROUND_STEP_IDS)[number]))
const SECTION_3_STEPS = INTAKE_STEPS.filter((s) => SECTION_3_IDS.includes(s.id as (typeof SECTION_3_IDS)[number]))
const CONFIRM_STEP = INTAKE_STEPS.find((s) => s.id === 'confirm_intent')!
const LOCATION_STEP = PROFILE_STEPS.find((s) => s.id === 'location')!
const MARKET_TENURE_STEP = INTAKE_STEPS.find((s) => s.id === 'q_market_tenure')!
const INTAKE_STEPS_AFTER_TENURE = INTAKE_STEPS.filter((s) => s.id !== 'q_market_tenure' && s.id !== 'confirm_intent')
const PROFILE_STEPS_BEFORE_LOCATION = PROFILE_STEPS.filter((s) => s.id !== 'location')
const AVATAR_STEP = {
  id: 'avatar_upload',
  question: 'Profile photo',
  body:
    'Upload a clear photo of your face. This helps others feel comfortable meeting you. We check that the image shows one clear face before accepting it.',
  type: 'avatar_upload',
  required: true,
} as const
const ONBOARDING_STEPS = [
  ...PROFILE_STEPS_BEFORE_LOCATION,
  LOCATION_STEP,
  MARKET_TENURE_STEP,
  ...INTAKE_STEPS_AFTER_TENURE,
  AVATAR_STEP,
  CONFIRM_STEP,
] as const

type OnboardingRenderableStep = ProfileStep | typeof AVATAR_STEP

function getStepSectionLabel(stepId: string): string {
  if (
    PROFILE_STEPS_BEFORE_LOCATION.some((step) => step.id === stepId) ||
    stepId === LOCATION_STEP.id ||
    stepId === MARKET_TENURE_STEP.id
  ) {
    return 'About you'
  }
  if (BACKGROUND_STEPS.some((step) => step.id === stepId) || LIFE_CONTEXT_STEPS.some((step) => step.id === stepId)) {
    return 'Life & context'
  }
  if (SECTION_3_STEPS.some((step) => step.id === stepId)) {
    return 'Conversation & intros'
  }
  if (stepId === AVATAR_STEP.id || stepId === CONFIRM_STEP.id) {
    return 'Confirm & finish'
  }
  return 'Onboarding'
}

function getVisibleStepsForAnswers(_answers: AnswersState): OnboardingRenderableStep[] {
  return [...ONBOARDING_STEPS]
}

function hasStepAnswer(step: OnboardingRenderableStep, answers: AnswersState): boolean {
  if (step.id === 'avatar_upload') {
    return typeof answers.avatar_url === 'string' && answers.avatar_url.trim() !== ''
  }
  const raw = answers[step.id]
  if (step.id === 'location') {
    return (
      typeof raw === 'object' &&
      raw !== null &&
      'city' in raw &&
      typeof (raw as { city?: string }).city === 'string' &&
      ((raw as { city?: string }).city?.trim() ?? '') !== ''
    )
  }
  if (step.type === 'multi_select' || step.type === 'searchable_multi') {
    return Array.isArray(raw) && raw.length > 0
  }
  if (step.type === 'searchable_single') {
    return typeof raw === 'string' && raw.trim() !== ''
  }
  if (step.type === 'slider_snap') {
    return typeof raw === 'string' && raw.trim() !== ''
  }
  return typeof raw === 'string' ? raw.trim() !== '' : raw != null
}

function getResumeStepId(answers: AnswersState): string {
  const visibleSteps = getVisibleStepsForAnswers(answers)
  const firstUnanswered = visibleSteps.find((step) => {
    if (step.required === false) return false
    return !hasStepAnswer(step, answers)
  })
  return firstUnanswered?.id ?? visibleSteps[visibleSteps.length - 1]?.id ?? ONBOARDING_STEPS[0].id
}

/** Outline the avatar zone when the message is about the photo / upload (not e.g. zip lookup). */
function isAvatarZoneErrorMessage(msg: string | null | undefined): boolean {
  if (!msg) return false
  return /profile photo|photo didn't|face|avatar|upload|only one face|verify this|couldn't read|couldn't verify/i.test(
    msg
  )
}

/** Zip / geolocation errors stay at the page bottom near the location controls. */
function isLocationErrorMessage(msg: string | null | undefined): boolean {
  if (!msg) return false
  return /zip code|look up that zip|geolocation|location access|couldn't get your location/i.test(msg)
}

type AnswersState = Record<string, string | string[] | number | { city: string; lat: number; lng: number }>

type ResolvedLocation = { city: string; lat: number; lng: number }

/** Prefill answers from existing profile + intake (logged-in flow). */
function getInitialAnswers(
  profile: ProfileRow | null,
  intake: IntakeResponsesV5Row | null
): AnswersState {
  const answers: AnswersState = {}
  for (const s of PROFILE_STEPS) {
    if (s.id === 'first_name') answers.first_name = profile?.first_name?.trim() ?? ''
    else if (s.id === 'birthdate') answers.birthdate = profile?.birthdate ?? ''
    else if (s.id === 'pronouns') {
      let pr = profile?.pronouns?.trim() ?? ''
      if (!pr && profile?.gender?.trim()) {
        const g = profile.gender.trim().toLowerCase()
        if (g === 'female' || g === 'woman' || g === 'women') pr = 'She/her'
        else if (g === 'male' || g === 'man' || g === 'men') pr = 'He/him'
        else if (g === 'non-binary' || g === 'nonbinary') pr = 'They/them'
        else pr = 'They/them'
      }
      answers.pronouns = pr
    }
    else if (s.id === 'languages') answers.languages = Array.isArray(profile?.languages) ? profile.languages : []
    else if (s.id === 'location' && profile?.city) answers.location = { city: profile.city, lat: profile.lat ?? 0, lng: profile.lng ?? 0 }
  }
  answers.gender_preference = profile?.gender_preference ?? ''
  answers.age_preference = profile?.age_preference ?? ''
  const responses = intake?.responses ?? []
  for (const s of INTAKE_STEPS) {
    const r = responses.find((x: IntakeResponseItem) => x.question_id === s.id)
    const emptyMulti = s.type === 'multi_select' || s.type === 'searchable_multi'
    let val: string | string[] | number = r ? (r.answer as string | string[] | number) : emptyMulti ? [] : ''
    if (emptyMulti && typeof val === 'string') val = [val]
    answers[s.id] = val
  }
  answers.gender_preference = profile?.gender_preference ?? ''
  answers.age_preference = profile?.age_preference ?? ''
  const relQ = answers.q_relationship_status
  const relEmpty =
    relQ === undefined || relQ === '' || (typeof relQ === 'string' && (relQ === 'N/A' || !relQ.trim()))
  if (relEmpty && profile?.relationship_status?.trim()) {
    answers.q_relationship_status = profile.relationship_status
  }
  return answers
}

/** Normalize to YYYY-MM-DD; rejects impossible calendar dates. */
function parseDate(s: string): string | null {
  const t = (s ?? '').trim()
  if (!t) return null
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (iso) {
    const y = Number(iso[1])
    const mo = Number(iso[2])
    const d = Number(iso[3])
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
    const dt = new Date(y, mo - 1, d)
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null
    return `${iso[1]}-${iso[2]}-${iso[3]}`
  }
  const us = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (us) {
    const mo = Number(us[1])
    const d = Number(us[2])
    const y = Number(us[3])
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1000) return null
    const dt = new Date(y, mo - 1, d)
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  }
  const d = new Date(t)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}

/** Format ISO date (YYYY-MM-DD) for display as MM/DD/YYYY. */
function birthdateToDisplay(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso
  const [, y, m, d] = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)!
  return `${m}/${d}/${y}`
}

type BirthParts = { mm: string; dd: string; yyyy: string }

function birthPartsEqual(a: BirthParts, b: BirthParts): boolean {
  return a.mm === b.mm && a.dd === b.dd && a.yyyy === b.yyyy
}

function birthPartsFromRaw(raw: string): BirthParts {
  const s = (raw ?? '').trim()
  // ISO (YYYY-MM-DD)
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (iso) return { yyyy: iso[1], mm: iso[2], dd: iso[3] }

  // Pasted digit run (up to 8); pad so <select> values match 01–12 / 01–31
  const digits = s.replace(/\D/g, '').slice(0, 8)
  let mm = digits.slice(0, 2)
  let dd = digits.slice(2, 4)
  if (mm.length === 1) mm = `0${mm}`
  if (dd.length === 1) dd = `0${dd}`
  const yyyy = digits.slice(4, 8)
  return { mm, dd, yyyy }
}

function birthPartsToRawDisplay(p: BirthParts): string {
  const mm = p.mm
  const dd = p.dd
  const yyyy = p.yyyy
  if (!mm && !dd && !yyyy) return ''
  // Keep the familiar MM/DD/YYYY shape for autosave + existing parsing.
  return `${mm}${mm ? '/' : ''}${dd}${dd ? '/' : ''}${yyyy}`.replace(/\/{2,}/g, '/')
}

const BIRTH_MONTH_OPTIONS: { value: string; label: string }[] = [
  { value: '01', label: 'January' },
  { value: '02', label: 'February' },
  { value: '03', label: 'March' },
  { value: '04', label: 'April' },
  { value: '05', label: 'May' },
  { value: '06', label: 'June' },
  { value: '07', label: 'July' },
  { value: '08', label: 'August' },
  { value: '09', label: 'September' },
  { value: '10', label: 'October' },
  { value: '11', label: 'November' },
  { value: '12', label: 'December' },
]

const BIRTH_DAY_OPTIONS = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0'))

function birthYearSelectOptions(): string[] {
  const maxY = new Date().getFullYear() - 18
  const minY = 1900
  const ys: string[] = []
  for (let y = maxY; y >= minY; y--) ys.push(String(y))
  return ys
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

/** `isoYmd` must be YYYY-MM-DD from parseDate. */
function marketTenureHeadline(answers: AnswersState): string {
  const loc = answers.location as { city?: string } | undefined
  const city = loc && typeof loc.city === 'string' && loc.city.trim() ? loc.city.trim() : ''
  if (!city || city === 'Unknown') return 'How long have you lived in this area?'
  return `How long have you lived in ${city}?`
}

function is18Plus(isoYmd: string): boolean {
  const m = isoYmd.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return false
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  const birth = new Date(y, mo - 1, d)
  const today = new Date()
  let age = today.getFullYear() - birth.getFullYear()
  const monthDiff = today.getMonth() - birth.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) age--
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
  const [birthParts, setBirthParts] = useState<BirthParts>({ mm: '', dd: '', yyyy: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [locationStatus, setLocationStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [zipCode, setZipCode] = useState('')
  const [geoLoading, setGeoLoading] = useState(false)
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null)
  const [avatarFaceChecking, setAvatarFaceChecking] = useState(false)
  const [avatarPhotoError, setAvatarPhotoError] = useState<string | null>(null)
  const [languageQuery, setLanguageQuery] = useState('')
  const [currentStepId, setCurrentStepId] = useState<string | null>(null)
  const submitRef = useRef<HTMLDivElement>(null)
  const lastMultiSelectRef = useRef<{ stepId: string; opt: string; t: number }>({ stepId: '', opt: '', t: 0 })

  const visibleSteps = useMemo(() => getVisibleStepsForAnswers(answers), [answers])

  useEffect(() => {
    if (currentStepId !== 'q_market_tenure') return
    const raw = answers.q_market_tenure
    if (typeof raw === 'string' && raw.trim()) return
    setAnswers((a) => ({ ...a, q_market_tenure: MARKET_TENURE_OPTIONS[0] }))
  }, [currentStepId, answers.q_market_tenure])

  const currentStepIndex = Math.max(0, visibleSteps.findIndex((step) => step.id === currentStepId))
  const currentStep = visibleSteps[currentStepIndex] ?? visibleSteps[0]
  const totalSteps = visibleSteps.length
  /** SMS token flow: Google sign-in is the final onboarding step and counts toward 0–100%. */
  const includesFinalGoogleAuthStep = tokenMode && Boolean(token)
  const isOnGoogleAuthStep = includesFinalGoogleAuthStep && showGoogleSignIn
  const totalProgressSteps = includesFinalGoogleAuthStep ? visibleSteps.length + 1 : visibleSteps.length
  const progressPercent =
    totalProgressSteps <= 0
      ? 0
      : isOnGoogleAuthStep
        ? 100
        : includesFinalGoogleAuthStep
          ? ((currentStepIndex + 1) / totalProgressSteps) * 100
          : totalSteps > 0
            ? ((currentStepIndex + 1) / totalSteps) * 100
            : 0
  const isFirstStep = currentStepIndex === 0 && !isOnGoogleAuthStep

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
      router.replace('/app/yourfika')
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
          if (res.status === 404) setTokenError('Invalid or expired link. Text us at the concierge number for a new link.')
          else setTokenError('Something went wrong. Please try again.')
          setSessionLoadedForToken(true)
          return
        }
        return res.json() as Promise<{ payload?: Record<string, unknown> }>
      })
      .then((data) => {
        if (cancelled || !data?.payload) return
        const nextAnswers = payloadToAnswers(data.payload as Record<string, unknown>)
        setAnswers(nextAnswers)
        setCurrentStepId(getResumeStepId(nextAnswers))
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
      router.replace('/app/yourfika')
      return
    }
  }, [tokenMode, sessionUserId, router])

  useEffect(() => {
    if (!showGoogleSignIn) return
    try {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
    } catch {
      window.scrollTo(0, 0)
    }
  }, [showGoogleSignIn])

  useEffect(() => {
    if (statusLoading || isComplete || sessionUserId == null || tokenMode) return
    const nextAnswers = getInitialAnswers(profile ?? null, intake ?? null)
    setAnswers(nextAnswers)
    setCurrentStepId(getResumeStepId(nextAnswers))
    if (profile?.city) setLocationStatus('done')
  }, [statusLoading, isComplete, sessionUserId, profile, intake])

  // Keep the Month/Day/Year inputs in sync with the underlying birthdate answer (supports token autosave reloads).
  useEffect(() => {
    const raw = typeof answers.birthdate === 'string' ? answers.birthdate : ''
    const next = birthPartsFromRaw(raw)
    setBirthParts((prev) => (birthPartsEqual(prev, next) ? prev : next))
  }, [answers.birthdate])

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

  useEffect(() => {
    if (visibleSteps.length === 0) return
    if (!currentStepId || !visibleSteps.some((step) => step.id === currentStepId)) {
      setCurrentStepId(visibleSteps[0].id)
    }
  }, [currentStepId, visibleSteps])

  function getStepError(step: OnboardingRenderableStep): string | null {
    if (step.id === 'avatar_upload') {
      if (!avatarFile && !(typeof answers.avatar_url === 'string' && answers.avatar_url)) {
        return 'Please upload a profile photo.'
      }
      return null
    }

    const raw = answers[step.id]
    const isEmpty = raw === undefined || raw === '' || (Array.isArray(raw) && raw.length === 0)
    if (step.required !== false && isEmpty) {
      return `Please answer: ${step.question}`
    }
    if (step.required === false && isEmpty) {
      return null
    }
    if (step.id === 'location') {
      const loc = raw as { city?: string } | undefined
      const hasResolved =
        typeof raw === 'object' &&
        raw !== null &&
        'city' in raw &&
        typeof loc?.city === 'string' &&
        loc.city.trim() !== ''
      const zipDigits = zipCode.replace(/\D/g, '')
      const zipOk = zipDigits.length === 5 || zipDigits.length === 9
      if (!hasResolved) {
        if (zipDigits.length > 0 && !zipOk) return 'Enter a valid US zip code (5 or 9 digits).'
        if (!zipOk) return 'Please set your location. Enter your zip code or use your current location.'
      }
    }
    if (step.type === 'date' && typeof raw === 'string') {
      const iso = parseDate(raw)
      if (!iso) return 'Please enter a valid date.'
      if (step.minAge && !is18Plus(iso)) return 'You must be 18 or older to use Fika.'
    }
    if ((step.type === 'multi_select' || step.type === 'searchable_multi') && step.maxSelections) {
      const arr = Array.isArray(raw) ? raw : []
      if (arr.length > step.maxSelections) return `Please choose at most ${step.maxSelections} for: ${step.question}`
    }
    if ((step.type === 'multi_select' || step.type === 'searchable_multi') && step.minSelections) {
      const arr = Array.isArray(raw) ? raw : []
      if (arr.length < step.minSelections) return `Please choose at least ${step.minSelections} for: ${step.question}`
    }
    if (step.id === 'confirm_intent' && raw !== "I'm in") {
      return "Please confirm you're in by selecting \"I'm in\"."
    }
    return null
  }

  function validateAll(): string | null {
    for (const s of PROFILE_STEPS) {
      const raw = answers[s.id]
      if (s.required !== false) {
        if (raw === undefined || raw === '' || (Array.isArray(raw) && raw.length === 0))
          return `Please answer: ${s.question}`
        if (s.id === 'location') {
          const loc = raw as { city?: string } | undefined
          const hasResolved =
            typeof raw === 'object' &&
            raw !== null &&
            'city' in raw &&
            typeof loc?.city === 'string' &&
            loc.city.trim() !== ''
          const zipDigits = zipCode.replace(/\D/g, '')
          const zipOk = zipDigits.length === 5 || zipDigits.length === 9
          if (!hasResolved) {
            if (zipDigits.length > 0 && !zipOk) return 'Enter a valid US zip code (5 or 9 digits).'
            if (!zipOk) return 'Please set your location. Enter your zip code or use your current location.'
          }
        }
        if (s.type === 'date' && typeof raw === 'string') {
          const iso = parseDate(raw)
          if (!iso) return 'Please enter a valid date.'
          if (s.minAge && !is18Plus(iso)) return 'You must be 18 or older to use Fika.'
        }
        if ((s.type === 'multi_select' || s.type === 'searchable_multi') && s.maxSelections) {
          const arr = Array.isArray(raw) ? raw : []
          if (arr.length > s.maxSelections) return `Please choose at most ${s.maxSelections} for: ${s.question}`
        }
        if ((s.type === 'multi_select' || s.type === 'searchable_multi') && s.minSelections) {
          const arr = Array.isArray(raw) ? raw : []
          if (arr.length < s.minSelections) return `Please choose at least ${s.minSelections} for: ${s.question}`
        }
      }
    }
    for (const s of [...SECTION_2_STEPS, ...SECTION_3_STEPS]) {
      const raw = answers[s.id]
      if (s.required !== false && (raw === undefined || raw === '' || (Array.isArray(raw) && raw.length === 0)))
        return `Please answer: ${s.question}`
      if ((s.type === 'multi_select' || s.type === 'searchable_multi') && s.maxSelections) {
        const arr = Array.isArray(raw) ? raw : []
        if (arr.length > s.maxSelections) return `Please choose at most ${s.maxSelections}.`
      }
      if ((s.type === 'multi_select' || s.type === 'searchable_multi') && s.minSelections) {
        const arr = Array.isArray(raw) ? raw : []
        if (arr.length < s.minSelections) return `Please choose at least ${s.minSelections} for: ${s.question}`
      }
    }
    const confirmRaw = answers.confirm_intent
    if (!avatarFile) return 'Please upload a profile photo.'
    if (confirmRaw !== "I'm in") return "Please confirm you're in by selecting \"I'm in\"."
    return null
  }

  async function handleNextStep() {
    if (!currentStep) return
    setError(null)
    setAvatarPhotoError(null)

    const stepError = getStepError(currentStep)
    if (stepError) {
      setError(stepError)
      submitRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }

    if (currentStep.id === 'location') {
      const locRes = await resolveLocationIfNeeded()
      if (!locRes.ok) {
        setError(locRes.error)
        submitRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        return
      }
      setAnswers((a) => ({
        ...a,
        location: locRes.location,
        q_market_tenure:
          typeof a.q_market_tenure === 'string' && a.q_market_tenure.trim() ? a.q_market_tenure : MARKET_TENURE_OPTIONS[0],
      }))
    }

    const nextStep = visibleSteps[currentStepIndex + 1]
    if (nextStep) {
      setCurrentStepId(nextStep.id)
      try {
        window.scrollTo({ top: 0, behavior: 'smooth' })
      } catch {}
    }
  }

  function handleBackStep() {
    setError(null)
    setAvatarPhotoError(null)
    if (isOnGoogleAuthStep) {
      setShowGoogleSignIn(false)
      try {
        window.scrollTo({ top: 0, behavior: 'smooth' })
      } catch {}
      return
    }
    const prevStep = visibleSteps[currentStepIndex - 1]
    if (!prevStep) return
    setCurrentStepId(prevStep.id)
    try {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch {}
  }

  async function saveAllProfileFields(locationOverride?: { city: string; lat: number; lng: number }) {
    if (!sessionUserId) return
    const supabase = getSupabase()
    if (!supabase) return
    const loc =
      locationOverride ?? (answers.location as { city: string; lat: number; lng: number } | undefined)
    const birthdateIso = typeof answers.birthdate === 'string' ? parseDate(answers.birthdate) : null
    const updates: Record<string, unknown> = {
      id: sessionUserId,
      first_name: (typeof answers.first_name === 'string' ? answers.first_name.trim() : '') || ' ',
      birthdate: birthdateIso ?? null,
      gender: null,
      pronouns: (typeof answers.pronouns === 'string' ? answers.pronouns.trim() : null) || null,
      gender_preference: (typeof answers.gender_preference === 'string' ? answers.gender_preference : null) ?? null,
      age_preference: (typeof answers.age_preference === 'string' ? answers.age_preference : null) ?? null,
      languages: Array.isArray(answers.languages) ? answers.languages : null,
      city: loc?.city ?? null,
      lat: typeof loc?.lat === 'number' ? loc.lat : null,
      lng: typeof loc?.lng === 'number' ? loc.lng : null,
      market: (await getMarketFromCityOrLatLngWithDb(supabase, loc?.city, loc?.lat, loc?.lng))?.slug ?? null,
      intent_confirmed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      relationship_status:
        typeof answers.q_relationship_status === 'string' && answers.q_relationship_status.trim() && answers.q_relationship_status !== 'N/A'
          ? answers.q_relationship_status.trim()
          : null,
    }
    const { error: e } = await supabase.from('profiles').upsert(updates, { onConflict: 'id' })
    if (e) throw new Error(e.message)
  }

  async function saveAllIntakeResponses() {
    if (!sessionUserId) return
    const supabase = getSupabase()
    if (!supabase) return
    const responses: IntakeResponseItem[] = INTAKE_STEPS.filter((s) => s.id !== 'gender_preference' && s.id !== 'age_preference').map((s) => {
      let raw = answers[s.id]
      if (s.id === 'q_home_state' && answers.q_home_country !== HOME_COUNTRY_UNITED_STATES) {
        raw = ''
      }
      const emptyMultiSave = s.type === 'multi_select' || s.type === 'searchable_multi'
      let value: string | string[] | number =
        raw === undefined || (typeof raw === 'object' && 'city' in (raw as object)) ? (emptyMultiSave ? [] : '') : (raw as string | string[] | number)
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

  /** Use existing `answers.location` or geocode `zipCode` (call after client-side validation). */
  async function resolveLocationIfNeeded(): Promise<{ ok: true; location: ResolvedLocation } | { ok: false; error: string }> {
    const raw = answers.location as ResolvedLocation | undefined
    if (
      raw &&
      typeof raw.city === 'string' &&
      raw.city.trim() &&
      typeof raw.lat === 'number' &&
      typeof raw.lng === 'number'
    ) {
      return { ok: true, location: { city: raw.city.trim(), lat: raw.lat, lng: raw.lng } }
    }

    const zip = zipCode.trim().replace(/\D/g, '')
    if (zip.length !== 5 && zip.length !== 9) {
      if (zip.length > 0) return { ok: false, error: 'Enter a valid US zip code (5 or 9 digits).' }
      return { ok: false, error: 'Please set your location. Enter your zip code or use your current location.' }
    }

    try {
      const res = await fetch(`/api/geocode?zip=${encodeURIComponent(zip)}`)
      const data = (await res.json()) as { city?: string; lat?: number; lng?: number; error?: string }
      if (!res.ok || data.error) {
        return { ok: false, error: data.error ?? "We couldn't find that zip code. Try again." }
      }
      if (data.lat != null && data.lng != null && data.city) {
        const location: ResolvedLocation = { city: data.city, lat: data.lat, lng: data.lng }
        setLocationStatus('done')
        setZipCode(zip)
        return { ok: true, location }
      }
      return { ok: false, error: "We couldn't find that zip code. Try again." }
    } catch {
      return { ok: false, error: "We couldn't look up that zip code. Try again." }
    }
  }

  async function handleSubmit() {
    setError(null)
    setAvatarPhotoError(null)
    const err = validateAll()
    if (err) {
      setError(err)
      submitRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
    setSaving(true)
    try {
      const locRes = await resolveLocationIfNeeded()
      if (!locRes.ok) {
        setError(locRes.error)
        submitRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        return
      }
      setAnswers((a) => ({
        ...a,
        location: locRes.location,
        q_market_tenure:
          typeof a.q_market_tenure === 'string' && a.q_market_tenure.trim() ? a.q_market_tenure : MARKET_TENURE_OPTIONS[0],
      }))

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
          location: locRes.location,
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
      await saveAllProfileFields(locRes.location)
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
      router.replace('/app/yourfika?justCompletedIntro=1')
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
    // After Google + merge, auth callback opens the concierge SMS thread (no draft text).
    const redirectTo = `${origin}/auth/exchange?next=/app/how-it-works&sms_token=${encodeURIComponent(smsToken)}`
    await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } })
  }

  function handleUseCurrentLocation() {
    setError(null)
    if (!navigator.geolocation) {
      setError('Geolocation is not supported.')
      return
    }
    setGeoLoading(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude
        const lng = pos.coords.longitude
        void (async () => {
          try {
            const res = await fetch(
              `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`
            )
            const data = await res.json()
            const city =
              data.address?.city ||
              data.address?.town ||
              data.address?.village ||
              data.address?.county ||
              'Unknown'
            const region = data.address?.state || data.address?.region
            const postalCode = typeof data.address?.postcode === 'string' ? data.address.postcode.replace(/\D/g, '').slice(0, 10) : ''
            const cityStr = region ? `${city}, ${region}` : city
            setAnswers((a) => ({ ...a, location: { city: cityStr, lat, lng } }))
            setLocationStatus('done')
            if (postalCode) setZipCode(postalCode)
          } catch {
            setAnswers((a) => ({ ...a, location: { city: 'Unknown', lat, lng } }))
            setLocationStatus('done')
          } finally {
            setGeoLoading(false)
          }
        })()
      },
      (err) => {
        setGeoLoading(false)
        const message =
          err.code === 1
            ? 'Location access was denied. Please allow location in your browser or device settings and try again.'
            : 'We couldn’t get your location. Try again in a moment, or move to a spot with better signal.'
        setError(message)
      },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 }
    )
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

  authLog('onboarding:render', { show: 'step-form', currentStepId: currentStep?.id ?? null })

  function renderField(step: OnboardingRenderableStep) {
    const value = answers[step.id]
    return (
      <div key={step.id} className="onboarding-field-wrap">
        <h3 className="onboarding-question">
          {step.id === 'q_market_tenure' ? marketTenureHeadline(answers) : step.question}
        </h3>
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
        {step.type === 'avatar_upload' && (
          <>
            {avatarFaceChecking ? (
              <p className="onboarding-body" style={{ fontSize: '0.9rem', marginTop: '-0.25rem' }}>
                Verifying photo…
              </p>
            ) : null}
            <div
              className={`onboarding-avatar-zone ${avatarFile || answers.avatar_url ? 'has-file' : ''} ${avatarPhotoError || isAvatarZoneErrorMessage(error) ? 'onboarding-avatar-zone--error' : ''}`}
            >
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
                disabled={saving || avatarFaceChecking}
                onChange={async (e) => {
                  const f = e.target.files?.[0]
                  const input = e.currentTarget
                  if (!f) return
                  setError(null)
                  setAvatarPhotoError(null)
                  setAvatarFaceChecking(true)
                  try {
                    const result = await checkProfilePhotoSingleFace(f)
                    if (!result.ok) {
                      setAvatarPhotoError(result.message)
                      input.value = ''
                      return
                    }
                    setAvatarPreviewUrl((prev) => {
                      if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev)
                      return URL.createObjectURL(f)
                    })
                    setAvatarFile(f)
                    if (tokenMode) setAnswers((a) => ({ ...a, avatar_url: '' }))
                  } finally {
                    setAvatarFaceChecking(false)
                  }
                }}
              />
              <label htmlFor="onboarding-avatar" className="onboarding-avatar-label">
                {avatarFaceChecking ? 'Checking…' : avatarFile || answers.avatar_url ? 'Change photo' : 'Choose photo'}
              </label>
            </div>
          </>
        )}
        {step.type === 'select' && step.options && (
          <select
            id={`onboarding-${step.id}`}
            name={step.id}
            className="auth-input"
            value={(value as string) ?? ''}
            onChange={(e) => {
              const v = e.target.value
              const nextAnswers: AnswersState = { ...answers, [step.id]: v }
              if (step.id === 'q_home_country' && v !== HOME_COUNTRY_UNITED_STATES) {
                nextAnswers.q_home_state = ''
              }
              setAnswers(nextAnswers)
              setError(null)
              setAvatarPhotoError(null)
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
        {step.type === 'date' && step.id === 'birthdate' && (
          <div
            className="onboarding-birthdate-grid"
            style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.25fr) minmax(0, 0.9fr) minmax(0, 1fr)', gap: '0.75rem' }}
          >
            <select
              id="onboarding-birthdate-mm"
              name="birthdate-mm"
              className="auth-input"
              value={birthParts.mm}
              onChange={(e) => {
                const mm = e.target.value
                setBirthParts((p) => {
                  const next = { ...p, mm }
                  setAnswers((a) => ({ ...a, birthdate: birthPartsToRawDisplay(next) }))
                  return next
                })
              }}
              disabled={saving}
              autoComplete="bday-month"
              aria-label="Birth month"
            >
              <option value="">Month</option>
              {BIRTH_MONTH_OPTIONS.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <select
              id="onboarding-birthdate-dd"
              name="birthdate-dd"
              className="auth-input"
              value={birthParts.dd}
              onChange={(e) => {
                const dd = e.target.value
                setBirthParts((p) => {
                  const next = { ...p, dd }
                  setAnswers((a) => ({ ...a, birthdate: birthPartsToRawDisplay(next) }))
                  return next
                })
              }}
              disabled={saving}
              autoComplete="bday-day"
              aria-label="Birth day"
            >
              <option value="">Day</option>
              {BIRTH_DAY_OPTIONS.map((d) => (
                <option key={d} value={d}>
                  {Number(d)}
                </option>
              ))}
            </select>
            <select
              id="onboarding-birthdate-yyyy"
              name="birthdate-yyyy"
              className="auth-input"
              value={birthParts.yyyy}
              onChange={(e) => {
                const yyyy = e.target.value
                setBirthParts((p) => {
                  const next = { ...p, yyyy }
                  setAnswers((a) => ({ ...a, birthdate: birthPartsToRawDisplay(next) }))
                  return next
                })
              }}
              disabled={saving}
              autoComplete="bday-year"
              aria-label="Birth year"
            >
              <option value="">Year</option>
              {birthYearSelectOptions().map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
        )}
        {step.type === 'date' && step.id !== 'birthdate' && (
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
                onClick={() => {
                  const nextAnswers: AnswersState = { ...answers, [step.id]: opt }
                  setAnswers(nextAnswers)
                  setError(null)
                  setAvatarPhotoError(null)
                }}
                disabled={saving}
              >
                {opt}
              </button>
            ))}
          </div>
        )}
        {step.type === 'slider_snap' && step.options && step.id === 'q_market_tenure' && (
          <MarketTenureSlider
            id={`onboarding-${step.id}`}
            options={step.options}
            value={typeof value === 'string' ? value : undefined}
            disabled={saving}
            onChange={(next) => {
              setAnswers((a) => ({ ...a, [step.id]: next }))
              setError(null)
              setAvatarPhotoError(null)
            }}
          />
        )}
        {step.type === 'location_permission' && (
          <div className="onboarding-location-wrap">
            {value && typeof value === 'object' && 'city' in (value as object) ? (
              <div className="onboarding-location-set" style={{ marginBottom: '0.75rem' }}>
                <span className="onboarding-location-set-icon" aria-hidden>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
                  </svg>
                </span>
                <span className="onboarding-location-set-city">{(value as { city: string }).city}</span>
              </div>
            ) : null}
            <div className="onboarding-location-zip">
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
                  disabled={saving || geoLoading}
                />
                <button
                  type="button"
                  className="onboarding-location-gps-btn"
                  onClick={handleUseCurrentLocation}
                  disabled={saving || geoLoading}
                  aria-label="Use current location"
                  title="Use current location"
                >
                  {geoLoading ? (
                    <span className="spinner onboarding-location-gps-spinner" aria-hidden />
                  ) : (
                    <span className="onboarding-location-gps-btn-icon" aria-hidden>
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                        <circle cx="12" cy="10" r="3" />
                      </svg>
                    </span>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
        {step.type === 'multi_select' && step.options && (
          <div>
            {(() => {
              const arr = (Array.isArray(value) ? value : []) as string[]
              const exclusiveOptionText = step.id === 'q_openness' ? "I'm open to anyone" : null
              const isSearchableTypeahead = step.id === 'languages'
              const normalizedQuery = languageQuery.trim().toLowerCase()
              const visibleOptions = isSearchableTypeahead
                ? (normalizedQuery ? step.options.filter((opt) => opt.toLowerCase().includes(normalizedQuery)) : [])
                : step.options

              const handleMultiSelect = (opt: string) => {
                const selected = arr.includes(opt)
                const isPreferNotToSay = opt === 'Prefer not to say'
                const isExclusiveOption = step.id === 'q_openness' && opt === "I'm open to anyone"
                const atMax = step.maxSelections != null && arr.length >= step.maxSelections && !selected
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
                <>
                  {isSearchableTypeahead && (
                    <input
                      type="text"
                      className="auth-input"
                      placeholder="Type a language"
                      value={languageQuery}
                      onChange={(e) => setLanguageQuery(e.target.value)}
                      disabled={saving}
                      autoComplete="off"
                      style={{ marginBottom: '0.75rem' }}
                    />
                  )}
                  {isSearchableTypeahead && arr.length > 0 && (
                    <div style={{ marginBottom: '0.75rem' }}>
                      {arr.map((opt) => (
                        <button
                          key={`selected-${opt}`}
                          type="button"
                          className="onboarding-chip multi-selected"
                          onClick={(e) => {
                            e.preventDefault()
                            handleMultiSelect(opt)
                          }}
                          disabled={saving}
                        >
                          {opt} ×
                        </button>
                      ))}
                    </div>
                  )}
                  {visibleOptions.map((opt) => {
                    const selected = arr.includes(opt)
                    const isExclusiveOption = step.id === 'q_openness' && opt === "I'm open to anyone"
                    const atMax = step.maxSelections != null && arr.length >= step.maxSelections && !selected
                    return (
                      <button
                        key={opt}
                        type="button"
                        className={`onboarding-chip ${selected ? 'multi-selected' : ''}`}
                        onClick={(e) => {
                          e.preventDefault()
                          handleMultiSelect(opt)
                          if (isSearchableTypeahead && !selected) setLanguageQuery('')
                        }}
                        disabled={saving || (!isExclusiveOption && atMax)}
                      >
                        {opt}
                      </button>
                    )
                  })}
                </>
              )
            })()}
          </div>
        )}
        {step.type === 'searchable_multi' && step.options && (
          <SearchableMultiPicker
            key={step.id}
            step={step as ProfileStep & { type: 'searchable_multi'; options: string[] }}
            value={value}
            disabled={saving}
            onChange={(next) => setAnswers((a) => ({ ...a, [step.id]: next }))}
          />
        )}
        {step.type === 'searchable_single' && step.options && (
          <SearchableSinglePicker
            key={step.id}
            step={step as ProfileStep & { type: 'searchable_single'; options: string[] }}
            value={value}
            disabled={saving}
            onChange={(next) => setAnswers((a) => ({ ...a, [step.id]: next }))}
          />
        )}
      </div>
    )
  }

  return (
    <div className="onboarding-wrap">
      <div className="onboarding-progress" aria-hidden>
        <div className="onboarding-progress-inner" style={{ width: `${progressPercent}%` }} />
      </div>
      <p className="onboarding-progress-copy">{Math.round(progressPercent)}% complete</p>
      {isFirstStep ? (
        <section className="onboarding-section onboarding-section-card onboarding-welcome-card" aria-label="Welcome">
          <h2 className="onboarding-section-title">Welcome to Fika ☕️</h2>
          <p className="onboarding-welcome-body">
            We&apos;ll ask a few quick questions so we can introduce you to someone nearby. Takes ~5 minutes.
          </p>
        </section>
      ) : null}
      <div className="onboarding-single-page">
        <section className="onboarding-section onboarding-section-card onboarding-step onboarding-step-enter">
          <div className="onboarding-step-meta">
            <p className="onboarding-step-label">
              {isOnGoogleAuthStep ? 'Sign in' : currentStep ? getStepSectionLabel(currentStep.id) : 'Onboarding'}
            </p>
          </div>

          {isOnGoogleAuthStep && token ? (
            <div className="onboarding-field-wrap">
              <h3 className="onboarding-question">Last step: sign in with Google</h3>
              <p className="onboarding-body" style={{ marginTop: '0.5rem' }}>
                Your answers are saved. Sign in with the Google account you want to use for Fika — then we&apos;ll take you
                into the app.
              </p>
              <button
                type="button"
                className="btn-google"
                onClick={() => void handleSignInWithGoogle(token)}
                style={{ marginTop: '1.5rem', maxWidth: '22rem' }}
              >
                <GoogleIcon className="auth-google-icon" />
                <span>Sign in with Google</span>
              </button>
            </div>
          ) : (
            currentStep ? renderField(currentStep) : null
          )}

          {error ? (
            <div className="onboarding-confirm-errors" role="alert">
              <p className="onboarding-avatar-photo-error">{error}</p>
            </div>
          ) : null}

          <div ref={submitRef} className="onboarding-actions">
            {currentStepIndex > 0 || isOnGoogleAuthStep ? (
              <button type="button" className="onboarding-nav-link" onClick={handleBackStep} disabled={saving || avatarFaceChecking}>
                Back
              </button>
            ) : null}
            {!isOnGoogleAuthStep && currentStepIndex < totalSteps - 1 ? (
              <button type="button" className="onboarding-nav-link onboarding-nav-link-primary" onClick={() => void handleNextStep()} disabled={saving || avatarFaceChecking}>
                Next
              </button>
            ) : null}
            {!isOnGoogleAuthStep && currentStepIndex >= totalSteps - 1 ? (
              <button
                type="button"
                className="onboarding-nav-link onboarding-nav-link-primary"
                onClick={handleSubmit}
                disabled={saving || avatarFaceChecking}
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
            ) : null}
          </div>
        </section>
      </div>
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
