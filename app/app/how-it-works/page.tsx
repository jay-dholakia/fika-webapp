'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useOnboardingStatus } from '@/lib/use-onboarding'
import { getSupabase } from '@/lib/supabase'
import { TARGET_COUNT_PER_MARKET, getMarketFromCity } from '@/lib/markets'

const TARGET_USERS = TARGET_COUNT_PER_MARKET
const SHARE_URL = 'https://letsfika.vercel.app'

export default function HowItWorksPage() {
  const [userId, setUserId] = useState<string | null>(null)
  const [profileCount, setProfileCount] = useState<number | null>(null)
  const [marketLabel, setMarketLabel] = useState<string | null>(null)
  const [shareCopied, setShareCopied] = useState(false)
  const { loading: onboardingLoading, isComplete: questionnaireComplete, intake, profile } = useOnboardingStatus(userId ?? undefined)

  useEffect(() => {
    getSupabase()?.auth.getSession().then(({ data: { session } }) => {
      setUserId(session?.user?.id ?? null)
    })
  }, [])

  const marketSlug = profile?.market ?? (profile?.city ? getMarketFromCity(profile.city)?.slug ?? null : null)
  useEffect(() => {
    const url = marketSlug ? `/api/profile-count?market=${encodeURIComponent(marketSlug)}` : '/api/profile-count'
    fetch(url)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data != null && typeof data.count === 'number') {
          setProfileCount(data.count)
          setMarketLabel(typeof data.label === 'string' ? data.label : null)
        }
      })
      .catch(() => {})
  }, [marketSlug])

  const communityUnlocked = profileCount !== null && profileCount >= TARGET_USERS
  const cityLabel = marketLabel ?? 'your city'
  const SHARE_TEXT = marketLabel
    ? `Help me unlock Fika in ${marketLabel} — create an account and get first access to your weekly intro when we hit ${TARGET_USERS} people.`
    : `Help me unlock Fika in our city — create an account and get first access to your weekly intro when we hit ${TARGET_USERS} people.`

  function copyShareToClipboard(url: string, text: string) {
    const combined = `${text}\n\n${url}`
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(combined).then(() => {
        setShareCopied(true)
        setTimeout(() => setShareCopied(false), 2000)
      })
    }
  }

  return (
    <>
      <div className="app-card app-welcome-card">
        <h1 className="app-welcome-card-title">Welcome to Fika!</h1>
        <p className="app-welcome-card-text">
          We&apos;re building real connection—one thoughtful intro per week, in person. No swiping, no endless chats. Just a simple rhythm: set when you&apos;re free, get matched, confirm your time, and show up.
        </p>
      </div>

      <div className="app-card app-how-it-works-page">
        <h2 className="app-how-it-works-title">How it works</h2>
        <p style={{ color: 'var(--color-textSecondary)', fontSize: '1rem', marginBottom: '1.5rem' }}>
          From signup to your weekly Fika—here&apos;s the full timeline and cadence.
        </p>

      <section className="app-how-it-works-section" aria-labelledby="getting-started-heading">
        <h2 id="getting-started-heading" className="app-how-it-works-section-title">Getting started</h2>
        <ol className="app-how-it-works-timeline" aria-label="Getting started steps">
          <li className={`app-how-it-works-step ${questionnaireComplete ? 'app-how-it-works-step-done' : ''}`}>
            <span className="app-how-it-works-step-marker" aria-hidden>
              {questionnaireComplete ? (
                <span className="app-how-it-works-check" aria-label="Done">✓</span>
              ) : (
                <span className="app-how-it-works-num">1</span>
              )}
            </span>
            <div className="app-how-it-works-step-content">
              <span className="app-how-it-works-when">Complete the intro questionnaire</span>
              <span className="app-how-it-works-what">
                Answer a few questions so we can match you with the right people. Takes about 5 minutes.
              </span>
              {!questionnaireComplete && !onboardingLoading && (
                <p style={{ margin: '0.5rem 0 0 0' }}>
                  <Link href="/app/onboarding" className="app-how-it-works-start-btn">
                    {intake?.responses && Array.isArray(intake.responses) && intake.responses.length > 0 ? 'Continue' : 'Start'}
                  </Link>
                </p>
              )}
            </div>
          </li>
          <li className={`app-how-it-works-step ${communityUnlocked ? 'app-how-it-works-step-done' : ''}`}>
            <span className="app-how-it-works-step-marker" aria-hidden>
              {communityUnlocked ? (
                <span className="app-how-it-works-check" aria-label="Done">✓</span>
              ) : (
                <span className="app-how-it-works-num">2</span>
              )}
            </span>
            <div className="app-how-it-works-step-content">
              <span className="app-how-it-works-when">We hit {TARGET_USERS} people in {cityLabel}</span>
              <span className="app-how-it-works-what">
                Once {TARGET_USERS} people have signed up in your area, we run our first intros. Opt-in opens on the Your Weekly Fika tab and you can set your availability.
              </span>
              {!communityUnlocked && (
                <div className="app-how-it-works-250-block">
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
                  <div className="app-how-it-works-invite-row">
                    <button
                      type="button"
                      className="app-waitlist-share-btn"
                      onClick={async () => {
                        if (typeof navigator !== 'undefined' && navigator.share) {
                          try {
                            await navigator.share({
                              title: 'Fika – Weekly introduction',
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
                  <p style={{ marginTop: '0.5rem', marginBottom: 0 }}>
                    <a href="#" role="button" className="app-how-it-works-invite-link" onClick={(e) => { e.preventDefault(); copyShareToClipboard(SHARE_URL, SHARE_TEXT); }}>Copy invite link</a>
                  </p>
                </div>
              )}
            </div>
          </li>
        </ol>
      </section>

      <section className="app-how-it-works-section" aria-labelledby="weekly-cadence-heading">
        <h2 id="weekly-cadence-heading" className="app-how-it-works-section-title">Every week after that</h2>
        <p style={{ color: 'var(--color-textSecondary)', fontSize: '0.9375rem', marginBottom: '1rem' }}>
          One intro per week. Same rhythm every time:
        </p>
        <ol className="app-how-it-works-timeline" aria-label="Weekly cadence">
          <li className="app-how-it-works-step">
            <span className="app-how-it-works-step-marker" aria-hidden><span className="app-how-it-works-num">1</span></span>
            <div className="app-how-it-works-step-content">
              <span className="app-how-it-works-when">Sunday</span>
              <span className="app-how-it-works-what">Opt in + share when you&apos;re available (Wed–Sun). Choose a few times you&apos;re genuinely free for a 30–45 minute meetup. The more flexibility, the easier it is to make a great match.</span>
            </div>
          </li>
          <li className="app-how-it-works-step">
            <span className="app-how-it-works-step-marker" aria-hidden><span className="app-how-it-works-num">2</span></span>
            <div className="app-how-it-works-step-content">
              <span className="app-how-it-works-when">Monday</span>
              <span className="app-how-it-works-what">We look at what you&apos;ve shared and when you&apos;re free, then thoughtfully prepare your intro for the week.</span>
            </div>
          </li>
          <li className="app-how-it-works-step">
            <span className="app-how-it-works-step-marker" aria-hidden><span className="app-how-it-works-num">3</span></span>
            <div className="app-how-it-works-step-content">
              <span className="app-how-it-works-when">Tuesday morning</span>
              <span className="app-how-it-works-what">You&apos;ll receive your intro with a suggested time (based on when you&apos;re both available) and a few conversation starters based on what we think could spark a great chat.</span>
            </div>
          </li>
          <li className="app-how-it-works-step">
            <span className="app-how-it-works-step-marker" aria-hidden><span className="app-how-it-works-num">4</span></span>
            <div className="app-how-it-works-step-content">
              <span className="app-how-it-works-when">By Tuesday night</span>
              <span className="app-how-it-works-what">Confirm your Fika—or request to reschedule if your availability has changed. Unconfirmed intros expire.</span>
            </div>
          </li>
          <li className="app-how-it-works-step">
            <span className="app-how-it-works-step-marker" aria-hidden><span className="app-how-it-works-num">5</span></span>
            <div className="app-how-it-works-step-content">
              <span className="app-how-it-works-when">Wednesday–Sunday</span>
              <span className="app-how-it-works-what">Meet up for your Fika. No endless texting. Just a real, face-to-face conversation.</span>
            </div>
          </li>
        </ol>
      </section>

      <p style={{ color: 'var(--color-textSecondary)', fontSize: '0.9rem', marginTop: '1.5rem', marginBottom: 0 }}>
        <Link href="/app/settings/how-it-works">FAQ &amp; more answers</Link>
      </p>
    </div>
    </>
  )
}
