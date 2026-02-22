'use client'

import { useState, useEffect } from 'react'
import { getSupabase } from './supabase'
import { isOnboardingComplete as checkComplete } from './onboarding'
import { authLog } from './auth-log'
import type { ProfileRow, IntakeResponsesV5Row } from './db-types'

export function useOnboardingStatus(userId: string | undefined) {
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<ProfileRow | null>(null)
  const [intake, setIntake] = useState<IntakeResponsesV5Row | null>(null)

  useEffect(() => {
    if (!userId) {
      authLog('useOnboardingStatus:no-userId', { loading: false })
      setLoading(false)
      return
    }
    const supabase = getSupabase()
    if (!supabase) {
      authLog('useOnboardingStatus:no-supabase')
      setLoading(false)
      return
    }

    authLog('useOnboardingStatus:fetch-start', { userId: userId.slice(0, 8) })
    setLoading(true)
    let cancelled = false

    async function load() {
      const [profileRes, intakeRes] = await Promise.all([
        supabase!.from('profiles').select('id, first_name, birthdate, pronouns, relationship_status, city, lat, lng, intent_confirmed_at, in_match_bowl, intro_balance').eq('id', userId).maybeSingle(),
        supabase!.from('intake_responses_v5').select('user_id, responses, completed_at, availability_times').eq('user_id', userId).maybeSingle(),
      ])
      if (cancelled) return
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
  return { loading, profile, intake, isComplete }
}
