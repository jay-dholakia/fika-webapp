'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { getSupabase } from '@/lib/supabase'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { authLog } from '@/lib/auth-log'
import { getCurrentBatchWeek, getMissingIntakeStepIds, getOrderedMissingIntakeSteps } from '@/lib/onboarding'
import { useOnboardingStatus } from '@/lib/use-onboarding'
import { formatIntakeAnswer, ageFromBirthdate } from '@/lib/intro-detail'
import { IntroDetailModal, type IntroMatch } from '@/app/app/components/IntroDetailModal'
import { NewQuestionsFlow } from '@/app/app/components/NewQuestionsFlow'
import type { IntakeResponseItem } from '@/lib/db-types'

export default function AppHomePage() {
  const router = useRouter()
  const [userId, setUserId] = useState<string | null>(null)
  const [optedIn, setOptedIn] = useState<boolean | null>(null)
  const [intros, setIntros] = useState<IntroMatch[]>([])
  const [introsLoading, setIntrosLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [toggling, setToggling] = useState(false)
  const [actionMatchId, setActionMatchId] = useState<string | null>(null)
  const [modalIntro, setModalIntro] = useState<IntroMatch | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [profileCount, setProfileCount] = useState<number | null>(null)
  const [shareCopied, setShareCopied] = useState(false)
  const [fillingMissingMode, setFillingMissingMode] = useState(false)
  const [showJustCompletedThankYou, setShowJustCompletedThankYou] = useState(false)

  const searchParams = useSearchParams()
  useEffect(() => {
    if (searchParams.get('justCompletedIntro') === '1') {
      setShowJustCompletedThankYou(true)
      router.replace('/app')
    }
  }, [searchParams, router])

  const TARGET_USERS = 250
  const showOptIn = profileCount !== null && profileCount >= TARGET_USERS
  const { loading: onboardingLoading, isComplete: onboardingComplete, intake, refetch } = useOnboardingStatus(userId ?? undefined)
  const showQuestionnaireCard = !onboardingLoading && !onboardingComplete
  const missingIntakeSteps = onboardingComplete && intake ? getMissingIntakeStepIds(intake) : []
  const showNewQuestionsCard = !onboardingLoading && onboardingComplete && missingIntakeSteps.length > 0 && !fillingMissingMode
  const orderedMissingSteps = intake ? getOrderedMissingIntakeSteps(intake) : []

  function copyShareToClipboard(url: string, text: string) {
    const combined = `${text}\n\n${url}`
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(combined).then(() => {
        setShareCopied(true)
        setTimeout(() => setShareCopied(false), 2000)
      })
    }
  }

  function fetchProfileCount(reason: 'initial' | 'realtime' | 'polling' | 'accuracy') {
    authLog('profile-count:fetch', { reason })
    fetch('/api/profile-count')
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (data != null && typeof data.count === 'number') {
          setProfileCount(data.count)
          authLog('profile-count:done', { reason, count: data.count })
        }
      })
      .catch((err) => authLog('profile-count:error', { reason, error: String(err) }))
  }

  // Single effect: initial fetch, realtime subscription, and polling. Runs once per mount.
  useEffect(() => {
    const supabase = getSupabase()
    let channel: RealtimeChannel | null = null
    let intervalId: ReturnType<typeof setInterval> | null = null
    let accuracyTimeoutId: ReturnType<typeof setTimeout> | null = null

    // Initial fetch
    fetchProfileCount('initial')

    if (supabase) {
      authLog('profile-count:realtime', { status: 'subscribing', table: 'profiles' })
      channel = supabase
        .channel('profile-count')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'profiles' },
          () => {
            authLog('profile-count:realtime', { event: 'INSERT', refetch: true })
            fetchProfileCount('realtime')
          }
        )
        .subscribe((status) => {
          authLog('profile-count:realtime', { subscriptionStatus: status })
          // One-time refetch after subscription is live so count is accurate (e.g. after Strict Mode remount)
          if (status === 'SUBSCRIBED') {
            accuracyTimeoutId = setTimeout(() => {
              fetchProfileCount('accuracy')
            }, 1500)
          }
        })
      intervalId = setInterval(() => {
        authLog('profile-count:poll', {})
        fetchProfileCount('polling')
      }, 30_000)
    } else {
      authLog('profile-count:realtime', { status: 'no-supabase' })
    }

    return () => {
      if (accuracyTimeoutId != null) clearTimeout(accuracyTimeoutId)
      if (intervalId != null) clearInterval(intervalId)
      if (supabase && channel) supabase.removeChannel(channel)
      authLog('profile-count:realtime', { status: 'unsubscribed' })
    }
  }, [])

  useEffect(() => {
    getSupabase()?.auth.getSession().then(({ data: { session } }) => {
      setUserId(session?.user?.id ?? null)
    })
  }, [])

  useEffect(() => {
    if (!userId) {
      setLoading(false)
      return
    }
    const supabase = getSupabase()
    if (!supabase) {
      setLoading(false)
      return
    }

    const batchWeek = getCurrentBatchWeek()
    supabase
      .from('weekly_match_opt_ins')
      .select('user_id')
      .eq('user_id', userId)
      .eq('batch_week', batchWeek)
      .maybeSingle()
      .then(({ data }) => {
        setOptedIn(!!data)
        setLoading(false)
      })
  }, [userId])

  // Load all match_candidates (intros) for this user; show only unopted or passed (exclude opted-in)
  useEffect(() => {
    if (!userId) {
      setIntros([])
      return
    }
    const supabase = getSupabase()
    if (!supabase) {
      setIntros([])
      return
    }
    setIntrosLoading(true)
    supabase
      .from('match_candidates')
      .select('id, user_a, user_b, score, reasons')
      .or(`user_a.eq.${userId},user_b.eq.${userId}`)
      .eq('status', 'active')
      .then(({ data: matches, error: matchError }) => {
        if (matchError || !matches?.length) {
          setIntros([])
          setIntrosLoading(false)
          return
        }
        const matchIds = matches.map((m: { id: string }) => m.id)
        const otherIds = Array.from(new Set(
          matches.map((m: { user_a: string; user_b: string }) => m.user_a === userId ? m.user_b : m.user_a)
        ))
        Promise.allSettled([
          supabase.from('profiles').select('id, first_name, city, birthdate').in('id', otherIds),
          supabase.from('opt_ins').select('match_id, decision').eq('user_id', userId).in('match_id', matchIds),
          supabase.from('conversations').select('id, match_id').or(`user_a.eq.${userId},user_b.eq.${userId}`).eq('conversation_type', 'match').in('match_id', matchIds),
          supabase.from('intake_responses_v5').select('user_id, responses').in('user_id', otherIds),
        ]).then(([profilesSettled, optInsSettled, convosSettled, intakeSettled]) => {
          const profilesRes = profilesSettled.status === 'fulfilled' ? profilesSettled.value : { data: null, error: { message: 'Profiles request failed' } }
          const optInsRes = optInsSettled.status === 'fulfilled' ? optInsSettled.value : { data: null, error: null }
          const convosRes = convosSettled.status === 'fulfilled' ? convosSettled.value : { data: null, error: null }
          const intakeRes = intakeSettled.status === 'fulfilled' ? intakeSettled.value : { data: null, error: null }
          // Build list even when profiles fail (e.g. RLS) so we don't hide matches – use empty profile data
          const profiles = (profilesRes?.data ?? []) as { id: string; first_name: string | null; city: string | null; birthdate: string | null }[]
          const byId = profiles.reduce<Record<string, { first_name: string; city: string | null; birthdate: string | null }>>((acc, p) => {
            acc[p.id] = { first_name: p.first_name?.trim() || 'Someone', city: p.city ?? null, birthdate: p.birthdate ?? null }
            return acc
          }, {})
          const myOptIns = ((optInsRes?.data ?? []) as { match_id: string; decision: string }[]).reduce<Record<string, 'yes' | 'no'>>((acc, o) => {
            acc[o.match_id] = o.decision === 'yes' ? 'yes' : 'no'
            return acc
          }, {})
          const convoByMatch = ((convosRes?.data ?? []) as { id: string; match_id: string | null }[]).reduce<Record<string, string>>((acc, c) => {
            if (c.match_id) acc[c.match_id] = c.id
            return acc
          }, {})
          const intakeByUserId: Record<string, { topicsPreview: string | null; fikaPreference: string | null }> = {}
          ;((intakeRes?.data ?? []) as { user_id: string; responses: unknown }[]).forEach((row) => {
            const responses = Array.isArray(row.responses) ? (row.responses as IntakeResponseItem[]) : []
            const q5 = responses.find((r: IntakeResponseItem) => r.question_id === 'q5_talk_about')
            const q4 = responses.find((r: IntakeResponseItem) => r.question_id === 'q4_where_most_yourself')
            intakeByUserId[row.user_id] = {
              topicsPreview: q5 ? formatIntakeAnswer(q5.answer) || null : null,
              fikaPreference: q4 ? formatIntakeAnswer(q4.answer) || null : null,
            }
          })
          const list: IntroMatch[] = matches.map((m: { id: string; user_a: string; user_b: string; score: number | null; reasons: unknown }) => {
            const otherId = m.user_a === userId ? m.user_b : m.user_a
            const profile = byId[otherId]
            const intake = intakeByUserId[otherId]
            return {
              id: m.id,
              otherUserId: otherId,
              otherFirstName: profile?.first_name ?? 'Someone',
              otherCity: profile?.city ?? null,
              otherAge: profile?.birthdate != null ? ageFromBirthdate(profile.birthdate) : null,
              score: m.score ?? null,
              reasons: (m.reasons as IntroMatch['reasons']) ?? null,
              myDecision: myOptIns[m.id],
              conversationId: convoByMatch[m.id] ?? null,
              conversationTypesPreview: intake?.topicsPreview ?? null,
              fikaPreferencePreview: intake?.fikaPreference ?? null,
            }
          })
          setIntros(list.filter((i) => i.myDecision !== 'yes' && i.myDecision !== 'no'))
          setIntrosLoading(false)
        }).catch(() => {
          setIntros([])
          setIntrosLoading(false)
        })
      })
  }, [userId])

  async function toggleOptIn() {
    if (!userId) return
    const supabase = getSupabase()
    if (!supabase) return
    setError(null)
    const previousOptedIn = optedIn
    setOptedIn(!optedIn)
    setToggling(true)
    const batchWeek = getCurrentBatchWeek()
    try {
      if (previousOptedIn) {
        const { error: e } = await supabase
          .from('weekly_match_opt_ins')
          .delete()
          .eq('user_id', userId)
          .eq('batch_week', batchWeek)
        if (e) throw e
      } else {
        const { error: e } = await supabase
          .from('weekly_match_opt_ins')
          .insert({ user_id: userId, batch_week: batchWeek, opted_in_at: new Date().toISOString() })
        if (e) throw e
      }
    } catch (err) {
      setOptedIn(previousOptedIn)
      setError(err instanceof Error ? err.message : 'Could not update opt-in.')
    } finally {
      setToggling(false)
    }
  }

  async function optInToIntro(intro: IntroMatch) {
    if (!userId) return
    const supabase = getSupabase()
    if (!supabase) return
    setError(null)
    setActionMatchId(intro.id)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('Not signed in.')
      const res = await fetch('/api/opt-in-to-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ match_id: intro.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'Opt-in failed.')
      setIntros((prev) => prev.map((i) => i.id === intro.id ? { ...i, myDecision: 'yes' as const, conversationId: data?.conversation_id ?? null } : i))
      setModalIntro((prev) => (prev?.id === intro.id ? { ...prev, myDecision: 'yes' as const, conversationId: data?.conversation_id ?? null } : prev))
      if (data?.conversation_id) {
        router.push(`/app/chats/${data.conversation_id}`)
        return
      }
      setModalIntro(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not opt in.')
    } finally {
      setActionMatchId(null)
    }
  }

  async function passOnIntro(intro: IntroMatch) {
    if (!userId) return
    const supabase = getSupabase()
    if (!supabase) return
    setError(null)
    setActionMatchId(intro.id)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('Not signed in.')
      const res = await fetch('/api/pass-on-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ match_id: intro.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'Pass failed.')
      setIntros((prev) => prev.map((i) => i.id === intro.id ? { ...i, myDecision: 'no' as const } : i))
      setModalIntro(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not pass.')
    } finally {
      setActionMatchId(null)
    }
  }

  if (loading) {
    return (
      <div className="app-empty">
        Loading…
      </div>
    )
  }

  return (
    <>
      {showOptIn ? (
        <div className="app-card">
          <h2>Weekly introductions</h2>
          <p style={{ color: 'var(--color-textSecondary)', fontSize: '0.95rem', marginBottom: '1rem' }}>
            Opt in to be included in this week&apos;s match run. New intros appear here after the run.
          </p>
          <div className="app-opt-in-toggle">
            <label className="app-toggle-label">
              <input
                type="checkbox"
                role="switch"
                checked={optedIn ?? false}
                onChange={() => toggleOptIn()}
                disabled={toggling}
                aria-label="Opt in to this week's introductions"
                className="app-toggle-input"
              />
              <span className="app-toggle-track" aria-hidden>
                <span className="app-toggle-thumb" />
              </span>
              <span className="app-toggle-text">
                {optedIn ? "I'm opted in this week" : "Opt in to this week's introductions"}
              </span>
            </label>
          </div>
          {error && <p className="onboarding-error" style={{ marginTop: '0.75rem' }}>{error}</p>}
        </div>
      ) : (
        <div className="app-card app-waitlist-counter">
          <h2>Weekly introductions</h2>
          <p style={{ color: 'var(--color-textSecondary)', fontSize: '0.95rem', marginBottom: '1rem' }}>
            We&apos;re building community in Los Angeles. Once {TARGET_USERS} people have signed up we&apos;ll run our first intros and reach out so you can opt in for week one!
          </p>
          <p className="app-counter-text">
            <span className="app-counter-value">{profileCount !== null ? profileCount : '—'}</span>
            <span className="app-counter-sep"> / </span>
            <span className="app-counter-target">{TARGET_USERS}</span>
            <span className="app-counter-label"> people</span>
          </p>
          <div className="app-counter-bar" role="progressbar" aria-valuenow={profileCount ?? 0} aria-valuemin={0} aria-valuemax={TARGET_USERS}>
            <div
              className="app-counter-bar-fill"
              style={{ width: `${profileCount !== null ? Math.min(100, (profileCount / TARGET_USERS) * 100) : 0}%` }}
            />
          </div>
          <p className="app-waitlist-share-copy">
            Help me unlock Fika in our city — create an account and get first access to intros when we hit 250 people!
          </p>
          <button
            type="button"
            className="app-waitlist-share-btn"
            onClick={async () => {
              const url = 'https://letsfika.vercel.app'
              const text = "Help me unlock Fika in our city — create an account and get first access to intros when we hit 250 people!"
              if (typeof navigator !== 'undefined' && navigator.share) {
                try {
                  await navigator.share({
                    title: 'Fika – Weekly introductions',
                    text,
                    url,
                  })
                } catch (e) {
                  if ((e as Error)?.name !== 'AbortError') copyShareToClipboard(url, text)
                }
              } else {
                copyShareToClipboard(url, text)
              }
            }}
            aria-label="Invite friends"
          >
            <span className="app-waitlist-share-icon" aria-hidden>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
            </span>
            <span>Invite friends</span>
          </button>
          {shareCopied && <p className="app-waitlist-share-feedback">Link copied!</p>}
        </div>
      )}

      {showJustCompletedThankYou && (
        <div className="app-card">
          <p style={{ color: 'var(--color-textSecondary)', fontSize: '0.95rem', margin: 0 }}>
            Thank you for completing the intro questions! We&apos;ll be in touch when we&apos;re ready for you to opt in to the next round of intros.
          </p>
        </div>
      )}

      {showQuestionnaireCard && (
        <div className="app-card app-questionnaire-card">
          <h2>Complete intro questionnaire</h2>
          <p style={{ color: 'var(--color-textSecondary)', fontSize: '0.95rem', marginBottom: '1rem' }}>
            Answer a few questions so we can intro you to people for your Fika. Takes about 5 minutes.
          </p>
          <Link href="/app/onboarding" className="btn btn-primary btn-block auth-submit" style={{ display: 'inline-block', textAlign: 'center' }}>
            Start questionnaire
          </Link>
        </div>
      )}

      {showNewQuestionsCard && (
        <div className="app-card app-new-questions-card">
          <h2>New intro questions added</h2>
          <p style={{ color: 'var(--color-textSecondary)', fontSize: '0.95rem', marginBottom: '1rem' }}>
            We&apos;ve added a few new questions to help match you better. Complete them so your intros stay up to date.
          </p>
          <button
            type="button"
            className="btn btn-primary btn-block auth-submit"
            style={{ display: 'block', textAlign: 'center' }}
            onClick={() => setFillingMissingMode(true)}
          >
            Complete new questions
          </button>
        </div>
      )}

      {fillingMissingMode && userId && intake && orderedMissingSteps.length > 0 && (
        <NewQuestionsFlow
          orderedSteps={orderedMissingSteps}
          intake={intake}
          userId={userId}
          onComplete={() => {
            setFillingMissingMode(false)
            refetch()
          }}
        />
      )}

      <div className="app-card">
        <h2>Your introductions</h2>
        {introsLoading ? (
          <p className="app-empty" style={{ padding: '1rem 0' }}>Loading introductions…</p>
        ) : intros.length === 0 ? (
          <p className="app-empty" style={{ padding: '1rem 0' }}>
            Introductions will appear here after the next weekly run. Make sure you&apos;re opted in above.
          </p>
        ) : (
          <ul className="app-intro-list" aria-label="Your introductions">
            {intros.map((intro) => (
              <li key={intro.id} className="app-intro-card">
                <button
                  type="button"
                  className="app-intro-card-trigger"
                  onClick={() => setModalIntro(intro)}
                >
                  <div className="app-intro-card-body">
                    <strong className="app-intro-name">{intro.otherFirstName}</strong>
                    {intro.otherCity && <span className="app-intro-meta"> · {intro.otherCity}</span>}
                    {intro.otherAge != null && <span className="app-intro-meta"> · {intro.otherAge} years old</span>}
                    {(intro.reasons?.conversationHooks?.length || intro.reasons?.conversation_hooks?.length || intro.fikaPreferencePreview) ? (
                      <p className="app-intro-preview">
                        {(() => {
                          const hooks = intro.reasons?.conversationHooks?.length ? intro.reasons.conversationHooks : intro.reasons?.conversation_hooks ?? []
                          const firstHook = hooks[0]
                          return firstHook ? (
                            <span className="app-intro-preview-line">{firstHook}</span>
                          ) : null
                        })()}
                        {((intro.reasons?.conversationHooks?.length || intro.reasons?.conversation_hooks?.length) && intro.fikaPreferencePreview) ? (
                          <span className="app-intro-preview-sep"> · </span>
                        ) : null}
                        {intro.fikaPreferencePreview ? (
                          <span className="app-intro-preview-line">
                            <strong className="app-intro-preview-label">Fika:</strong> {intro.fikaPreferencePreview}
                          </span>
                        ) : null}
                      </p>
                    ) : null}
                  </div>
                  {intro.myDecision === 'yes' && intro.conversationId ? (
                    <span className="app-intro-card-cta">Open chat →</span>
                  ) : intro.myDecision === 'yes' ? (
                    <span className="app-intro-card-status">You opted in</span>
                  ) : intro.myDecision === 'no' ? (
                    <span className="app-intro-card-status">Passed</span>
                  ) : (
                    <span className="app-intro-card-cta">View details →</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {modalIntro != null && (
        <IntroDetailModal
          intro={modalIntro}
          onClose={() => setModalIntro(null)}
          onOptIn={optInToIntro}
          onPass={passOnIntro}
          actionMatchId={actionMatchId}
          error={error}
        />
      )}
    </>
  )
}
