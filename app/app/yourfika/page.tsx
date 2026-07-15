'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { getSupabase } from '@/lib/supabase'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { authLog } from '@/lib/auth-log'
import { getMarketBySlug, getMarketFromCity } from '@/lib/markets'
import { useOnboardingStatus } from '@/lib/use-onboarding'

type UpcomingRsvp = {
  eventId: string
  eventStartsAt: string | null
  venueName: string | null
  venueNeighborhood: string | null
}

function formatEventDate(iso: string): string {
  const d = new Date(iso)
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(d).replace(/:00\s/, ' ')
}

function UpcomingFikaCard({ rsvp }: { rsvp: UpcomingRsvp }) {
  const venue = rsvp.venueName
  const location = rsvp.venueNeighborhood ? `${venue} · ${rsvp.venueNeighborhood}` : (venue ?? null)
  const dateStr = rsvp.eventStartsAt ? formatEventDate(rsvp.eventStartsAt) : null

  return (
    <div style={{ fontSize: '0.95rem' }}>
      <p style={{ margin: '0 0 0.35rem', fontWeight: 600, fontSize: '1rem' }}>You&apos;re confirmed ✓</p>
      {dateStr && <p style={{ margin: '0 0 0.2rem', color: 'var(--color-textSecondary)' }}>{dateStr}</p>}
      {location && <p style={{ margin: 0, color: 'var(--color-textSecondary)' }}>{location}</p>}
    </div>
  )
}

function AppHomeContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [userId, setUserId] = useState<string | null>(null)
  const [upcomingRsvp, setUpcomingRsvp] = useState<UpcomingRsvp | null | 'loading'>('loading')
  const [loading, setLoading] = useState(true)
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

  // Load upcoming yes-RSVP with event + venue, and match reveal if available
  useEffect(() => {
    if (!userId) {
      setUpcomingRsvp(null)
      return
    }
    const supabase = getSupabase()
    if (!supabase) {
      setUpcomingRsvp(null)
      return
    }
    setUpcomingRsvp('loading')

    const now = new Date().toISOString()
    void Promise.resolve(
    supabase
      .from('weekly_rsvps')
      .select('event_id, weekly_fika_events(id, event_starts_at, venue_id, venues(name, neighborhood))')
      .eq('user_id', userId)
      .eq('decision', 'yes')
      .order('decided_at', { ascending: false })
      .limit(5)
    ).then(({ data: rsvps }) => {
        if (!rsvps?.length) { setUpcomingRsvp(null); return }

        type EventRow = { id: string; event_starts_at: string | null; venue_id: string | null; venues: { name: string | null; neighborhood: string | null } | null }
        const withEvent = (rsvps as unknown as { event_id: string; weekly_fika_events: EventRow | null }[])
          .filter(r => r.weekly_fika_events)
          .map(r => ({ rsvp: r, event: r.weekly_fika_events! }))

        const upcoming = withEvent.filter(x => !x.event.event_starts_at || x.event.event_starts_at >= now)
        const chosen = upcoming[0] ?? withEvent[0]
        if (!chosen) { setUpcomingRsvp(null); return }

        const event = chosen.event
        const venue = event.venues

        setUpcomingRsvp({
          eventId: event.id,
          eventStartsAt: event.event_starts_at,
          venueName: venue?.name ?? null,
          venueNeighborhood: venue?.neighborhood ?? null,
        })
      })
      .catch(() => setUpcomingRsvp(null))
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
          <div style={{ color: 'var(--color-textSecondary)', fontSize: '0.95rem' }}>
            <p style={{ margin: '0 0 0.5rem 0' }}>You&apos;re in.</p>
            <p style={{ margin: 0 }}>
              When there&apos;s a Fika in your area, you&apos;ll get a text invite. Reply Yes to grab a spot — we&apos;ll match you with someone interesting. You&apos;ll find out who 30 minutes before.
            </p>
          </div>
        )}

        <div style={{ marginTop: '1.75rem', paddingTop: '1.25rem', borderTop: '1px solid var(--color-border, rgba(0,0,0,0.08))' }}>
          <h3 className="app-subsection-title" style={{ fontSize: '1.1rem', margin: '0 0 0.75rem', fontWeight: 600 }}>
            Your next Fika
          </h3>
          {upcomingRsvp === 'loading' ? (
            <p className="app-empty" style={{ padding: '0.5rem 0' }}>Loading…</p>
          ) : upcomingRsvp === null ? (
            isInactiveMarket ? (
              <p style={{ padding: '0.5rem 0', margin: 0, color: 'var(--color-textSecondary)', fontSize: '0.95rem' }}>
                Your first invite will arrive once Fika launches in your area.
              </p>
            ) : (
              <p style={{ padding: '0.5rem 0', margin: 0, color: 'var(--color-textSecondary)', fontSize: '0.95rem' }}>
                No upcoming Fika yet. When you get a text invite and reply Yes, it&apos;ll show up here.
              </p>
            )
          ) : (
            <UpcomingFikaCard rsvp={upcomingRsvp} />
          )}
        </div>
      </div>

      {showJustCompletedThankYou && (
        <div className="app-card">
          <p style={{ color: 'var(--color-textSecondary)', fontSize: '0.95rem', margin: 0 }}>
            Profile complete! You&apos;ll get a text invite when there&apos;s a Fika in your area.
          </p>
        </div>
      )}

      {showQuestionnaireCard && (
        <div className="app-card app-questionnaire-card">
          <h2>Complete your profile</h2>
          <p style={{ color: 'var(--color-textSecondary)', fontSize: '0.95rem', marginBottom: '1rem' }}>
            Answer a few questions so we can match you well at your first Fika. Takes about 5 minutes.
          </p>
          <Link href="/app/onboarding" className="btn btn-primary btn-block auth-submit" style={{ display: 'inline-block', textAlign: 'center' }}>
            Set up profile
          </Link>
        </div>
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
