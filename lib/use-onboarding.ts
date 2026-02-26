'use client'

import { useState, useEffect, useRef } from 'react'
import { getSupabase } from './supabase'
import { isOnboardingComplete as checkComplete } from './onboarding'
import { authLog } from './auth-log'
import type { ProfileRow, IntakeResponsesV5Row } from './db-types'

export function useOnboardingStatus(userId: string | undefined) {
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<ProfileRow | null>(null)
  const [intake, setIntake] = useState<IntakeResponsesV5Row | null>(null)
  const fetchedForUserIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!userId) {
      authLog('useOnboardingStatus:no-userId', { loading: false })
      setLoading(false)
      fetchedForUserIdRef.current = null
      return
    }
    const supabase = getSupabase()
    if (!supabase) {
      authLog('useOnboardingStatus:no-supabase')
      setLoading(false)
      return
    }

    fetchedForUserIdRef.current = null
    authLog('useOnboardingStatus:fetch-start', { userId: userId.slice(0, 8) })
    setLoading(true)
    let cancelled = false

    async function load() {
      const [profileRes, intakeRes] = await Promise.all([
        supabase!.from('profiles').select('id, first_name, birthdate, gender, gender_preference, pronouns, relationship_status, languages, city, lat, lng, intent_confirmed_at, in_match_bowl, intro_balance').eq('id', userId).maybeSingle(),
        supabase!.from('intake_responses_v5').select('user_id, responses, completed_at, availability_times').eq('user_id', userId).maybeSingle(),
      ])
      if (cancelled) return
      fetchedForUserIdRef.current = userId
      const profileData = profileRes.data as ProfileRow | null
      const intakeData = intakeRes.data as IntakeResponsesV5Row | null
      const complete = checkComplete(profileData, intakeData)
      authLog('useOnboardingStatus:fetch-done', {
        hasProfile: !!profileData,
        hasIntake: !!intakeData,
        intakeCompletedAt: intakeData?.completed_at ?? null,
        isComplete: complete,
      })
      setProfile(profileData)
      setIntake(intakeData)
      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [userId])

  const isComplete = checkComplete(profile, intake)
  // Stay in loading until we've received a fetch result for this userId (avoids redirect race when landing on /app after onboarding).
  // For new users, fetch returns null/null and we set fetchedForUserIdRef, so effectiveLoading becomes false and we redirect to onboarding.
  const pendingNoData = !!userId && profile === null && intake === null && fetchedForUserIdRef.current !== userId
  const effectiveLoading = loading || pendingNoData
  return { loading: effectiveLoading, profile, intake, isComplete }
}
