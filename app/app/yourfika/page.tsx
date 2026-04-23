'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { getSupabase } from '@/lib/supabase'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { authLog } from '@/lib/auth-log'
import { getAvailabilitySlotLabel } from '@/lib/availability-slots'
import { getMarketBySlug, getMarketFromCity } from '@/lib/markets'
import { useOnboardingStatus } from '@/lib/use-onboarding'
import { formatIntakeAnswer, ageFromBirthdate } from '@/lib/intro-detail'
import { IntroDetailModal, type IntroMatch } from '@/app/app/components/IntroDetailModal'
import { VerifiedBadge } from '@/app/app/components/VerifiedBadge'
import type { IntakeResponseItem } from '@/lib/db-types'

function AppHomeContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [userId, setUserId] = useState<string | null>(null)
  const [intros, setIntros] = useState<IntroMatch[]>([])
  const [introsLoading, setIntrosLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [modalIntro, setModalIntro] = useState<IntroMatch | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [profileCount, setProfileCount] = useState<number | null>(null)
  const [marketLabel, setMarketLabel] = useState<string | null>(null)
  const [marketActive, setMarketActive] = useState<boolean | null>(null)
  const [shareCopied, setShareCopied] = useState(false)
  const [showJustCompletedThankYou, setShowJustCompletedThankYou] = useState(false)

  useEffect(() => {
    if (searchParams.get('justCompletedIntro') === '1') {
      setShowJustCompletedThankYou(true)
      router.replace('/app/yourfika')
    }
  }, [searchParams, router])

  const { loading: onboardingLoading, isComplete: onboardingComplete, intake, refetch, profile } = useOnboardingStatus(userId ?? undefined)
  const marketSlug = profile?.market ?? (profile?.city ? getMarketFromCity(profile.city)?.slug ?? null : null)

  const marketNotActive = marketSlug != null && marketActive === false
  const isInactiveMarket = marketNotActive
  const SHARE_URL = 'https://letsfika.vercel.app'
  const cityLabelForShare = marketSlug ? (getMarketBySlug(marketSlug)?.label ?? marketLabel ?? 'your area') : null
  const SHARE_TEXT = cityLabelForShare
    ? `Join me on Fika in ${cityLabelForShare} — meet someone new; have a real conversation over coffee nearby.`
    : `Join me on Fika — meet someone new; have a real conversation over coffee nearby.`
  const showQuestionnaireCard = !onboardingLoading && !onboardingComplete

  function copyShareToClipboard(url: string, text: string) {
    const combined = `${text}\n\n${url}`
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(combined).then(() => {
        setShareCopied(true)
        setTimeout(() => setShareCopied(false), 2000)
      })
    }
  }

  function fetchProfileCount(reason: 'initial' | 'realtime' | 'polling' | 'accuracy', marketSlug: string | null) {
    const url = marketSlug ? `/api/profile-count?market=${encodeURIComponent(marketSlug)}` : '/api/profile-count'
    authLog('profile-count:fetch', { reason, market: marketSlug })
    fetch(url)
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (data != null && typeof data.count === 'number') {
          setProfileCount(data.count)
          setMarketLabel(typeof data.label === 'string' ? data.label : null)
          if (marketSlug == null) setMarketActive(null)
          else if (typeof data.active === 'boolean') setMarketActive(data.active)
          authLog('profile-count:done', { reason, count: data.count, market: marketSlug })
        }
      })
      .catch((err) => authLog('profile-count:error', { reason, error: String(err) }))
  }

  // Single effect: initial fetch, realtime subscription, and polling. Runs when userId or profile (for market) changes.
  useEffect(() => {
    const supabase = getSupabase()
    let channel: RealtimeChannel | null = null
    let intervalId: ReturnType<typeof setInterval> | null = null
    let accuracyTimeoutId: ReturnType<typeof setTimeout> | null = null

    // Initial fetch (by user's market when available)
    fetchProfileCount('initial', marketSlug)

    if (supabase) {
      authLog('profile-count:realtime', { status: 'subscribing', table: 'profiles' })
      channel = supabase
        .channel('profile-count')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'profiles' },
          () => {
            authLog('profile-count:realtime', { event: 'INSERT', refetch: true })
            fetchProfileCount('realtime', marketSlug)
          }
        )
        .subscribe((status) => {
          authLog('profile-count:realtime', { subscriptionStatus: status })
          if (status === 'SUBSCRIBED') {
            accuracyTimeoutId = setTimeout(() => {
              fetchProfileCount('accuracy', marketSlug)
            }, 1500)
          }
        })
      intervalId = setInterval(() => {
        authLog('profile-count:poll', {})
        fetchProfileCount('polling', marketSlug)
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
  }, [userId, marketSlug])

  useEffect(() => {
    getSupabase()?.auth.getSession().then(({ data: { session } }) => {
      setUserId(session?.user?.id ?? null)
    })
  }, [])

  useEffect(() => {
    setLoading(false)
  }, [userId])

  // Load this week's match (one intro per week)
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
      .select('id, user_a, user_b, score, reasons, scheduling_status, default_slot_id, overlapping_slot_ids, counter_slot_id, counter_proposed_by_user_id, final_slot_id, confirmed_slot_id, confirmed_venue_id')
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
          supabase.from('profiles').select('id, first_name, city, birthdate, id_verified_at').in('id', otherIds),
          supabase.from('opt_ins').select('match_id, decision').eq('user_id', userId).in('match_id', matchIds),
          supabase.from('intake_responses_v5').select('user_id, responses').in('user_id', otherIds),
          supabase
            .from('sms_conversation_states')
            .select('match_id, state')
            .eq('user_id', userId)
            .in('match_id', matchIds),
        ]).then(([profilesSettled, optInsSettled, intakeSettled, statesSettled]) => {
          const profilesRes = profilesSettled.status === 'fulfilled' ? profilesSettled.value : { data: null, error: { message: 'Profiles request failed' } }
          const optInsRes = optInsSettled.status === 'fulfilled' ? optInsSettled.value : { data: null, error: null }
          const intakeRes = intakeSettled.status === 'fulfilled' ? intakeSettled.value : { data: null, error: null }
          const statesRes = statesSettled.status === 'fulfilled' ? statesSettled.value : { data: null, error: null }
          // Build list even when profiles fail (e.g. RLS) so we don't hide matches – use empty profile data
          const profiles = (profilesRes?.data ?? []) as {
            id: string
            first_name: string | null
            city: string | null
            birthdate: string | null
            id_verified_at: string | null
          }[]
          const byId = profiles.reduce<
            Record<
              string,
              {
                first_name: string
                city: string | null
                birthdate: string | null
                id_verified_at: string | null
              }
            >
          >((acc, p) => {
            acc[p.id] = {
              first_name: p.first_name?.trim() || 'Someone',
              city: p.city ?? null,
              birthdate: p.birthdate ?? null,
              id_verified_at: p.id_verified_at ?? null,
            }
            return acc
          }, {})
          const myOptIns = ((optInsRes?.data ?? []) as { match_id: string; decision: string }[]).reduce<Record<string, 'yes' | 'no'>>((acc, o) => {
            acc[o.match_id] = (o.decision === 'opt_in' || o.decision === 'yes') ? 'yes' : 'no'
            return acc
          }, {})
          const myStates = ((statesRes?.data ?? []) as { match_id: string; state: string }[]).reduce<Record<string, string>>((acc, s) => {
            if (s.match_id) acc[s.match_id] = s.state
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
          const list: IntroMatch[] = matches.map((m: {
            id: string
            user_a: string
            user_b: string
            score: number | null
            reasons: unknown
            scheduling_status?: string | null
            default_slot_id?: string | null
            overlapping_slot_ids?: string[] | null
            counter_slot_id?: string | null
            counter_proposed_by_user_id?: string | null
            final_slot_id?: string | null
            confirmed_slot_id?: string | null
            confirmed_venue_id?: string | null
          }) => {
            const otherId = m.user_a === userId ? m.user_b : m.user_a
            const profile = byId[otherId]
            const intake = intakeByUserId[otherId]
            return {
              id: m.id,
              otherUserId: otherId,
              otherFirstName: profile?.first_name ?? 'Someone',
              otherCity: profile?.city ?? null,
              otherIdVerified: Boolean(profile?.id_verified_at),
              otherAge: profile?.birthdate != null ? ageFromBirthdate(profile.birthdate) : null,
              score: m.score ?? null,
              reasons: (m.reasons as IntroMatch['reasons']) ?? null,
              myDecision: myOptIns[m.id],
              matchState: myStates[m.id] ?? null,
              conversationTypesPreview: intake?.topicsPreview ?? null,
              fikaPreferencePreview: intake?.fikaPreference ?? null,
              schedulingStatus: m.scheduling_status ?? null,
              defaultSlotId: m.default_slot_id ?? null,
              overlappingSlotIds: m.overlapping_slot_ids ?? null,
              counterSlotId: m.counter_slot_id ?? null,
              counterProposedByUserId: m.counter_proposed_by_user_id ?? null,
              finalSlotId: m.final_slot_id ?? null,
              confirmedSlotId: m.confirmed_slot_id ?? null,
              confirmedVenueId: m.confirmed_venue_id ?? null,
            }
          })
          const filtered = list.filter(
            (i) =>
              i.myDecision !== 'no' &&
              i.schedulingStatus !== 'expired' &&
              i.schedulingStatus !== 'cancelled_pending_retry'
          )
          setIntros(filtered)
          setIntrosLoading(false)
          const venueIds = Array.from(new Set(filtered.map((i) => i.confirmedVenueId).filter(Boolean) as string[]))
          if (venueIds.length > 0) {
            supabase.from('venues').select('id, name, neighborhood, city').in('id', venueIds).then(({ data: venues }) => {
              const byId = (venues ?? []).reduce<Record<string, { name: string; neighborhood: string }>>((acc, v: { id: string; name?: string | null; neighborhood?: string | null; city?: string | null }) => {
                acc[v.id] = { name: v.name ?? 'Meetup spot', neighborhood: v.neighborhood ?? v.city ?? '' }
                return acc
              }, {} as Record<string, { name: string; neighborhood: string }>)
              setIntros((prev) => prev.map((i) => ({
                ...i,
                confirmedVenueName: i.confirmedVenueId ? byId[i.confirmedVenueId]?.name ?? null : null,
                confirmedVenueNeighborhood: i.confirmedVenueId ? byId[i.confirmedVenueId]?.neighborhood ?? null : null,
              })))
            })
          }
        }).catch(() => {
          setIntros([])
          setIntrosLoading(false)
        })
      })
  }, [userId])

  if (loading) {
    return (
      <div className="app-empty">
        Loading…
      </div>
    )
  }

  return (
    <>
      <div className="app-card">
        <h2>Your Fika</h2>
        {profileCount === null || (marketSlug != null && marketActive === null) ? (
          <p style={{ color: 'var(--color-textSecondary)', fontSize: '0.95rem', marginBottom: 0 }}>
            Loading your status…
          </p>
        ) : isInactiveMarket ? (
          <>
            <div style={{ color: 'var(--color-textSecondary)', fontSize: '0.95rem' }}>
              <p style={{ margin: '0 0 0.75rem 0' }}>We&apos;re getting Fika going in your area.</p>
              <p style={{ margin: 0 }}>
                It unlocks once enough people nearby join—inviting a few friends helps get it there faster.
              </p>
            </div>
            <div className="app-how-it-works-invite-row" style={{ marginTop: '1rem' }}>
              <button
                type="button"
                className="app-waitlist-share-btn"
                onClick={async () => {
                  if (typeof navigator !== 'undefined' && navigator.share) {
                    try {
                      await navigator.share({
                        title: 'Fika — Meet someone new. Have a real conversation.',
                        text: SHARE_TEXT,
                        url: SHARE_URL,
                      })
                    } catch (e) {
                      if ((e as Error)?.name !== 'AbortError') copyShareToClipboard(SHARE_URL, SHARE_TEXT)
                    }
                  } else {
                    copyShareToClipboard(SHARE_URL, SHARE_TEXT)
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
          </>
        ) : (
          <>
            <div style={{ color: 'var(--color-textSecondary)', fontSize: '0.95rem' }}>
              <p style={{ margin: '0 0 0.5rem 0' }}>You&apos;re in.</p>
              <p style={{ margin: '0 0 0.75rem 0' }}>
                We&apos;ll reach out when there&apos;s a strong Fika intro for you.
              </p>
              <p style={{ margin: 0 }}>
                We&apos;re actively looking—nothing you need to do in the meantime.
              </p>
            </div>
            {error && <p className="onboarding-error" style={{ marginTop: '0.75rem' }}>{error}</p>}
          </>
        )}

        <div style={{ marginTop: '1.75rem', paddingTop: '1.25rem', borderTop: '1px solid var(--color-border, rgba(0,0,0,0.08))' }}>
          <h3 className="app-subsection-title" style={{ fontSize: '1.1rem', margin: '0 0 0.75rem', fontWeight: 600 }}>
            {isInactiveMarket ? 'Your Fika Intro' : 'Your Fika intro'}
          </h3>
          {introsLoading ? (
            <p className="app-empty" style={{ padding: '0.5rem 0' }}>Loading…</p>
          ) : intros.length === 0 ? (
            isInactiveMarket ? (
              <p className="app-empty" style={{ padding: '0.5rem 0', margin: 0, color: 'var(--color-textSecondary)', fontSize: '0.95rem' }}>
                Your intro will show up here once your area is live.
              </p>
            ) : (
              <div className="app-empty" style={{ padding: '0.5rem 0', margin: 0, color: 'var(--color-textSecondary)', fontSize: '0.95rem' }}>
                <p style={{ margin: '0 0 0.5rem 0' }}>No intro yet.</p>
                <p style={{ margin: 0 }}>When we find the right person, their details will show up here.</p>
              </div>
            )
          ) : (
            <div className="app-intro-list" aria-label={isInactiveMarket ? 'Your Fika Intro' : 'Your Fika intro'}>
              {intros.map((intro) => (
                <div key={intro.id} className="app-intro-card">
                  <button
                    type="button"
                    className="app-intro-card-trigger"
                    onClick={() => setModalIntro(intro)}
                  >
                    <div className="app-intro-card-body">
                      <span className="app-intro-name app-intro-name-with-badge">
                        <strong className="app-intro-name-text">{intro.otherFirstName}</strong>
                        {intro.otherIdVerified ? <VerifiedBadge /> : null}
                      </span>
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
                      {intro.myDecision === 'yes' && intro.schedulingStatus === 'confirmed' && (intro.confirmedSlotId || intro.confirmedVenueName) ? (
                        <p className="app-intro-card-confirmed" style={{ marginTop: '0.5rem', fontSize: '0.9rem', fontWeight: 500, color: 'var(--color-textSecondary)' }}>
                          Confirmed Fika · {intro.confirmedSlotId ? getAvailabilitySlotLabel(intro.confirmedSlotId) : 'Time TBD'}
                          {intro.confirmedVenueName ? ` · ${intro.confirmedVenueName}${intro.confirmedVenueNeighborhood ? ` (${intro.confirmedVenueNeighborhood})` : ''}` : ''}
                        </p>
                      ) : null}
                    </div>
                    {intro.matchState === 'awaiting_availability' ? (
                      <span className="app-intro-card-status">Scheduling</span>
                    ) : intro.myDecision === 'yes' ? (
                      <span className="app-intro-card-status">In progress</span>
                    ) : intro.myDecision === 'no' ? (
                      <span className="app-intro-card-status">Passed</span>
                    ) : (
                      <span className="app-intro-card-cta">View details →</span>
                    )}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showJustCompletedThankYou && (
        <div className="app-card">
          <p style={{ color: 'var(--color-textSecondary)', fontSize: '0.95rem', margin: 0 }}>
            Thank you for completing the intro questions! We&apos;ll reach out when we find a good Fika intro for you.
          </p>
        </div>
      )}

      {showQuestionnaireCard && (
        <div className="app-card app-questionnaire-card">
          <h2>Complete intro questionnaire</h2>
          <p style={{ color: 'var(--color-textSecondary)', fontSize: '0.95rem', marginBottom: '1rem' }}>
            Answer a few questions so we can match you with someone for your Fika. Takes about 5 minutes.
          </p>
          <Link href="/app/onboarding" className="btn btn-primary btn-block auth-submit" style={{ display: 'inline-block', textAlign: 'center' }}>
            Start questionnaire
          </Link>
        </div>
      )}

      {modalIntro != null && (
        <IntroDetailModal
          intro={modalIntro}
          onClose={() => setModalIntro(null)}
          actionMatchId={null}
          error={error}
          currentUserId={userId}
        />
      )}
    </>
  )
}

export default function YourFikaPage() {
  return (
    <Suspense fallback={<div style={{ padding: '2rem', textAlign: 'center' }}>Loading…</div>}>
      <AppHomeContent />
    </Suspense>
  )
}
