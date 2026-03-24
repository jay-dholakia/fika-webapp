'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useOnboardingStatus } from '@/lib/use-onboarding'
import { getSupabase } from '@/lib/supabase'
import { PersonaIdVerification } from '@/app/app/components/PersonaIdVerification'
import { getMarketBySlug, getMarketFromCity } from '@/lib/markets'

const SHARE_URL = 'https://letsfika.vercel.app'

const PERSONA_EMBED_CONFIGURED = Boolean(
  process.env.NEXT_PUBLIC_PERSONA_TEMPLATE_ID?.trim() &&
    process.env.NEXT_PUBLIC_PERSONA_ENVIRONMENT_ID?.trim()
)

export default function HowItWorksPage() {
  const [userId, setUserId] = useState<string | null>(null)
  const [shareCopied, setShareCopied] = useState(false)
  const [marketActive, setMarketActive] = useState<boolean | null>(null)
  const {
    loading: onboardingLoading,
    isComplete: questionnaireComplete,
    intake,
    profile,
    refetch,
  } = useOnboardingStatus(userId ?? undefined)

  useEffect(() => {
    getSupabase()?.auth.getSession().then(({ data: { session } }) => {
      setUserId(session?.user?.id ?? null)
    })
  }, [])

  const marketSlug = profile?.market ?? (profile?.city ? getMarketFromCity(profile.city)?.slug ?? null : null)

  useEffect(() => {
    if (!marketSlug) {
      setMarketActive(null)
      return
    }
    let cancelled = false
    fetch(`/api/profile-count?market=${encodeURIComponent(marketSlug)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { active?: boolean } | null) => {
        if (cancelled || !data || typeof data.active !== 'boolean') return
        setMarketActive(data.active)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [marketSlug])
  const cityLabel = marketSlug ? (getMarketBySlug(marketSlug)?.label ?? 'your area') : 'your area'
  const SHARE_TEXT = marketSlug
    ? `Join me on Fika in ${cityLabel} — real conversations over coffee with people nearby.`
    : `Join me on Fika — real conversations over coffee with people nearby.`

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
          {marketActive === false ? (
            <>
              You&apos;re in. We&apos;re not actively growing Fika in your area just yet, but we hope to be soon. When that
              changes, we&apos;ll reach out.
            </>
          ) : (
            <>
              You&apos;re in. We&apos;ll text you when we have a good Fika intro for you.
            </>
          )}
        </p>
      </div>

      <div className="app-card app-how-it-works-page">
        <h2 className="app-how-it-works-title">How it works</h2>
        <p style={{ color: 'var(--color-textSecondary)', fontSize: '1rem', marginBottom: '1.5rem' }}>
          From signup to your Fika—here&apos;s how it works end to end.
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
          <li className={`app-how-it-works-step ${questionnaireComplete ? 'app-how-it-works-step-done' : ''}`}>
            <span className="app-how-it-works-step-marker" aria-hidden>
              {questionnaireComplete ? (
                <span className="app-how-it-works-check" aria-label="Done">✓</span>
              ) : (
                <span className="app-how-it-works-num">2</span>
              )}
            </span>
            <div className="app-how-it-works-step-content">
              <span className="app-how-it-works-when">We text you when there&apos;s a good intro</span>
              <span className="app-how-it-works-what">
                {marketActive === false ? (
                  <>
                    We&apos;re not actively growing Fika in your area just yet, but we hope to be soon. When that changes,
                    we&apos;ll reach out. Know someone who&apos;d enjoy this? Invite them below.
                  </>
                ) : (
                  <>
                    We&apos;ll text you when we have a good Fika intro for you. We&apos;re matching in {cityLabel}. Know
                    someone who&apos;d enjoy this? Invite them below.
                  </>
                )}
              </span>
              <div className="app-how-it-works-250-block">
                <div className="app-how-it-works-invite-row">
                  <button
                    type="button"
                    className="app-waitlist-share-btn"
                    onClick={async () => {
                      if (typeof navigator !== 'undefined' && navigator.share) {
                        try {
                          await navigator.share({
                            title: 'Fika — Real people. Real conversation.',
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
              </div>
            </div>
          </li>
        </ol>
      </section>

      <section className="app-how-it-works-section" aria-labelledby="intro-flow-heading">
        <h2 id="intro-flow-heading" className="app-how-it-works-section-title">How intros work</h2>
        <p style={{ color: 'var(--color-textSecondary)', fontSize: '0.9375rem', marginBottom: '1rem' }}>
          We only text you when we have a good Fika intro for you—simple and intentional.
        </p>
        <ol className="app-how-it-works-timeline" aria-label="How intros work">
          <li className="app-how-it-works-step">
            <span className="app-how-it-works-step-marker" aria-hidden><span className="app-how-it-works-num">1</span></span>
            <div className="app-how-it-works-step-content">
              <span className="app-how-it-works-when">We find a good intro</span>
              <span className="app-how-it-works-what">We look for a good Fika intro for you based on compatibility and location.</span>
            </div>
          </li>
          <li className="app-how-it-works-step">
            <span className="app-how-it-works-step-marker" aria-hidden><span className="app-how-it-works-num">2</span></span>
            <div className="app-how-it-works-step-content">
              <span className="app-how-it-works-when">We text you</span>
              <span className="app-how-it-works-what">When we find a good Fika intro for you, we reach out by SMS and ask for your availability to schedule.</span>
            </div>
          </li>
          <li className="app-how-it-works-step">
            <span className="app-how-it-works-step-marker" aria-hidden><span className="app-how-it-works-num">3</span></span>
            <div className="app-how-it-works-step-content">
              <span className="app-how-it-works-when">We make the plan</span>
              <span className="app-how-it-works-what">Once both people are in, we propose a real time and place based on overlapping availability.</span>
            </div>
          </li>
          <li className="app-how-it-works-step">
            <span className="app-how-it-works-step-marker" aria-hidden><span className="app-how-it-works-num">4</span></span>
            <div className="app-how-it-works-step-content">
              <span className="app-how-it-works-when">Confirm</span>
              <span className="app-how-it-works-what">Both people confirm by text. If timing does not work, we look for the next good Fika intro for you.</span>
            </div>
          </li>
          <li className="app-how-it-works-step">
            <span className="app-how-it-works-step-marker" aria-hidden><span className="app-how-it-works-num">5</span></span>
            <div className="app-how-it-works-step-content">
              <span className="app-how-it-works-when">Meet up</span>
              <span className="app-how-it-works-what">Meet up for your Fika. No endless texting — just a real, face-to-face conversation over coffee.</span>
            </div>
          </li>
        </ol>
      </section>

      <p style={{ color: 'var(--color-textSecondary)', fontSize: '0.9rem', marginTop: '1.5rem', marginBottom: 0 }}>
        <Link href="/app/settings/how-it-works">FAQ &amp; more answers</Link>
      </p>

      {PERSONA_EMBED_CONFIGURED &&
        userId &&
        !onboardingLoading &&
        !profile?.id_verified_at && (
          <section
            className="app-card app-welcome-id-verify"
            style={{ marginTop: '1.25rem' }}
            aria-labelledby="welcome-id-verify-heading"
          >
            <h2 id="welcome-id-verify-heading" className="app-how-it-works-section-title" style={{ marginTop: 0 }}>
              Get ID verified
            </h2>
            <p style={{ color: 'var(--color-textSecondary)', fontSize: '0.95rem', marginBottom: '1rem' }}>
              Add a blue check next to your name so matches know you&apos;ve confirmed your identity. Takes about a minute.
            </p>
            <PersonaIdVerification
              userId={userId}
              idVerifiedAt={profile?.id_verified_at ?? null}
              onVerified={refetch}
            />
          </section>
        )}
    </div>
    </>
  )
}
