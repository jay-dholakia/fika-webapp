'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useOnboardingStatus } from '@/lib/use-onboarding'
import { getSupabase } from '@/lib/supabase'

const TARGET_USERS = 250
const LA_LABEL = 'Los Angeles, CA'
const SHARE_URL = 'https://letsfika.vercel.app'
const SHARE_TEXT = "Help me unlock Fika in Los Angeles, CA — create an account and get first access to your weekly intro when we hit 250 people in Los Angeles, CA!"

export default function HowItWorksPage() {
  const [userId, setUserId] = useState<string | null>(null)
  const [profileCount, setProfileCount] = useState<number | null>(null)
  const [shareCopied, setShareCopied] = useState(false)
  const { loading: onboardingLoading, isComplete: questionnaireComplete, intake } = useOnboardingStatus(userId ?? undefined)

  useEffect(() => {
    getSupabase()?.auth.getSession().then(({ data: { session } }) => {
      setUserId(session?.user?.id ?? null)
    })
  }, [])

  useEffect(() => {
    fetch('/api/profile-count')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data != null && typeof data.count === 'number') setProfileCount(data.count)
      })
      .catch(() => {})
  }, [])

  const communityUnlocked = profileCount !== null && profileCount >= TARGET_USERS

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
                {!questionnaireComplete && !onboardingLoading && (
                  <>
                    {' '}
                    <Link href="/app/onboarding" className="btn btn-primary" style={{ marginTop: '0.5rem', display: 'inline-block' }}>
                      {intake?.responses && Array.isArray(intake.responses) && intake.responses.length > 0 ? 'Continue' : 'Start'}
                    </Link>
                  </>
                )}
              </span>
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
              <span className="app-how-it-works-when">We hit {TARGET_USERS} people in {LA_LABEL}</span>
              <span className="app-how-it-works-what">
                Once {TARGET_USERS} people have signed up in {LA_LABEL}, we run our first intros. Opt-in opens on the Your Weekly Fika tab and you can set your availability.
                {!communityUnlocked && profileCount !== null && (
                  <span className="app-how-it-works-count"> ({profileCount} / {TARGET_USERS} so far)</span>
                )}
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
              <span className="app-how-it-works-when">Sunday 11:59pm</span>
              <span className="app-how-it-works-what">Opt-in and availability lock. Set when you&apos;re free Wed–Sun on <Link href="/app/availability">Your Availability</Link> and toggle opt-in on <Link href="/app">Your Weekly Fika</Link> before this deadline.</span>
            </div>
          </li>
          <li className="app-how-it-works-step">
            <span className="app-how-it-works-step-marker" aria-hidden><span className="app-how-it-works-num">2</span></span>
            <div className="app-how-it-works-step-content">
              <span className="app-how-it-works-when">Tuesday 8am</span>
              <span className="app-how-it-works-what">Matches run; your intro arrives with a suggested time (when you&apos;re both free). You can opt in for next week from Tuesday 8am too.</span>
            </div>
          </li>
          <li className="app-how-it-works-step">
            <span className="app-how-it-works-step-marker" aria-hidden><span className="app-how-it-works-num">3</span></span>
            <div className="app-how-it-works-step-content">
              <span className="app-how-it-works-when">Tuesday 11:59pm</span>
              <span className="app-how-it-works-what">Confirm the suggested time or request a different one (one round of back-and-forth) by this deadline—it doesn&apos;t extend when you request a change. Unconfirmed intros expire; you can opt in again for next week (from Tuesday 8am).</span>
            </div>
          </li>
          <li className="app-how-it-works-step">
            <span className="app-how-it-works-step-marker" aria-hidden><span className="app-how-it-works-num">4</span></span>
            <div className="app-how-it-works-step-content">
              <span className="app-how-it-works-when">Wed–Sun</span>
              <span className="app-how-it-works-what">Your Fika window. Show up at the time you confirmed—no in-app chat, just real life.</span>
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
