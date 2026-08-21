'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { getSupabase } from '@/lib/supabase'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { authLog } from '@/lib/auth-log'
import { getMarketBySlug, getMarketFromCity } from '@/lib/markets'
import { useOnboardingStatus } from '@/lib/use-onboarding'

const ACTIVE_INTRO_STATES = ['1v1_offered', '1v1_accepted', '1v1_awaiting_availability', '1v1_proposed', '1v1_confirmed', '1v1_morning_reminder']

function AppHomeContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [userId, setUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [marketLabel, setMarketLabel] = useState<string | null>(null)
  const [marketActive, setMarketActive] = useState<boolean | null>(null)
  const [shareCopied, setShareCopied] = useState(false)
  const [hasActiveIntro, setHasActiveIntro] = useState(false)
  const [hasUpcomingRsvp, setHasUpcomingRsvp] = useState(false)

  useEffect(() => {
    if (searchParams.get('justCompletedIntro') === '1') {
      router.replace('/app/yourfika')
    }
  }, [searchParams, router])

  const { loading: onboardingLoading, isComplete: onboardingComplete, intake, profile } = useOnboardingStatus(userId ?? undefined)
  const marketSlug = profile?.market ?? (profile?.city ? getMarketFromCity(profile.city)?.slug ?? null : null)

  const isInactiveMarket = marketSlug != null && marketActive === false
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

  function fetchMarketStatus(marketSlug: string | null) {
    const url = marketSlug ? `/api/profile-count?market=${encodeURIComponent(marketSlug)}` : '/api/profile-count'
    fetch(url)
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (data != null) {
          setMarketLabel(typeof data.label === 'string' ? data.label : null)
          if (marketSlug == null) setMarketActive(null)
          else if (typeof data.active === 'boolean') setMarketActive(data.active)
        }
      })
      .catch(() => {})
  }

  useEffect(() => {
    const supabase = getSupabase()
    let channel: RealtimeChannel | null = null

    fetchMarketStatus(marketSlug)

    if (supabase) {
      channel = supabase
        .channel('profile-count')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'profiles' }, () => {
          fetchMarketStatus(marketSlug)
        })
        .subscribe()
    }

    return () => {
      if (supabase && channel) supabase.removeChannel(channel)
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

  // Check for active 1v1 intro and upcoming event RSVP
  useEffect(() => {
    if (!userId) return
    const supabase = getSupabase()
    if (!supabase) return

    const now = new Date().toISOString()

    Promise.all([
      supabase
        .from('sms_conversation_states')
        .select('state')
        .eq('user_id', userId)
        .not('match_id', 'is', null)
        .in('state', ACTIVE_INTRO_STATES)
        .limit(1),
      supabase
        .from('weekly_rsvps')
        .select('event_id, weekly_fika_events(event_starts_at)')
        .eq('user_id', userId)
        .eq('decision', 'yes')
        .limit(5),
    ]).then(([introRes, rsvpRes]) => {
      setHasActiveIntro((introRes.data?.length ?? 0) > 0)

      const rsvps = (rsvpRes.data ?? []) as unknown as Array<{ event_id: string; weekly_fika_events: { event_starts_at: string | null } | null }>
      const hasUpcoming = rsvps.some(r => {
        const startsAt = r.weekly_fika_events?.event_starts_at
        return !startsAt || startsAt >= now
      })
      setHasUpcomingRsvp(hasUpcoming)
    }).catch(() => {})
  }, [userId])

  if (loading) {
    return <div className="app-empty">Loading…</div>
  }

  let statusLine: string
  if (isInactiveMarket) {
    statusLine = ''
  } else if (hasActiveIntro) {
    statusLine = 'You have an active intro — check your texts.'
  } else if (hasUpcomingRsvp) {
    statusLine = "You're confirmed for an upcoming Fika."
  } else {
    statusLine = "You're in. We'll text when there's an intro for you."
  }

  return (
    <>
      <div className="app-card">
        {isInactiveMarket ? (
          <>
            <p style={{ margin: '0 0 1rem', fontSize: '0.9375rem', color: 'var(--color-textSecondary)' }}>
              We&apos;re building Fika in your area. We&apos;ll text you when you&apos;re up.
            </p>
            <div className="app-how-it-works-invite-row">
              <button
                type="button"
                className="app-waitlist-share-btn"
                onClick={async () => {
                  if (typeof navigator !== 'undefined' && navigator.share) {
                    try {
                      await navigator.share({ title: 'Fika', text: SHARE_TEXT, url: SHARE_URL })
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
          <p style={{ margin: 0, fontSize: '0.9375rem', color: 'var(--color-textSecondary)' }}>
            {statusLine}
          </p>
        )}
      </div>

      {showQuestionnaireCard && (
        <div className="app-card">
          <p style={{ margin: '0 0 0.875rem', fontSize: '0.9375rem', color: 'var(--color-textSecondary)' }}>
            Finish your profile so we can find a good intro for you.
          </p>
          <Link href="/app/onboarding" className="btn btn-primary btn-block auth-submit" style={{ display: 'inline-block', textAlign: 'center' }}>
            Continue
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
