'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useOnboardingStatus } from '@/lib/use-onboarding'
import { getSupabase } from '@/lib/supabase'
import { PersonaIdVerification } from '@/app/app/components/PersonaIdVerification'
import { NewQuestionsSection } from '@/app/app/components/NewQuestionsSection'
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
    ? `Join me on Fika in ${cityLabel} — meet someone new; have a real conversation over coffee nearby.`
    : `Join me on Fika — meet someone new; have a real conversation over coffee nearby.`

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
      <div className="app-card app-how-it-works-page">
        {marketActive === false ? (
          <p className="app-welcome-card-text" style={{ marginTop: 0, marginBottom: '1rem' }}>
            You&apos;re in. We&apos;re not sending intros in your area yet—we&apos;ll let you know when we are.
          </p>
        ) : null}
        <h1 className="app-how-it-works-title">How it works</h1>

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
              <span className="app-how-it-works-when">Complete your intro (~5 min)</span>
              <span className="app-how-it-works-what">
                Short questionnaire so we can find you a good intro nearby—similar enough to click, different enough to keep it
                interesting.
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
              <span className="app-how-it-works-when">We text you when there&apos;s an intro for you</span>
              <span className="app-how-it-works-what">
                {marketActive === false ? (
                  <>We&apos;re not growing here yet; we&apos;ll reach out when we are. Know someone who&apos;d like this?</>
                ) : (
                  <>
                    No feed to browse—we text when there&apos;s someone for you in {cityLabel}. Know someone who&apos;d like
                    this?
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
              </div>
            </div>
          </li>
        </ol>
      </section>

      <section className="app-how-it-works-section" aria-labelledby="how-it-plays-out-heading">
        <h2 id="how-it-plays-out-heading" className="app-how-it-works-section-title">How it plays out</h2>
        <p style={{ color: 'var(--color-textSecondary)', fontSize: '0.9375rem', marginBottom: '0.75rem' }}>
          When we find someone for you:
        </p>
        <ol className="app-how-it-works-timeline" aria-label="How an intro plays out">
          <li className="app-how-it-works-step">
            <span className="app-how-it-works-step-marker" aria-hidden><span className="app-how-it-works-num">1</span></span>
            <div className="app-how-it-works-step-content">
              <span className="app-how-it-works-when">You get an intro</span>
              <span className="app-how-it-works-what">
                Text with a quick snapshot—who they are, where they&apos;re based, what you share. If you&apos;re both in, we
                move ahead.
              </span>
            </div>
          </li>
          <li className="app-how-it-works-step">
            <span className="app-how-it-works-step-marker" aria-hidden><span className="app-how-it-works-num">2</span></span>
            <div className="app-how-it-works-step-content">
              <span className="app-how-it-works-when">We line it up</span>
              <span className="app-how-it-works-what">
                We propose a time and a nearby spot from both your locations and availability—you confirm by text.
              </span>
            </div>
          </li>
          <li className="app-how-it-works-step">
            <span className="app-how-it-works-step-marker" aria-hidden><span className="app-how-it-works-num">3</span></span>
            <div className="app-how-it-works-step-content">
              <span className="app-how-it-works-when">You meet</span>
              <span className="app-how-it-works-what">
                Show up for coffee and meet someone new—have a real conversation, low pressure, no script.
              </span>
            </div>
          </li>
        </ol>
      </section>

      <p style={{ color: 'var(--color-textSecondary)', fontSize: '0.9rem', marginTop: '1rem', marginBottom: 0 }}>
        <Link href="/app/settings/how-it-works">FAQ &amp; more answers</Link>
      </p>

      {PERSONA_EMBED_CONFIGURED &&
        userId &&
        !onboardingLoading &&
        !profile?.id_verified_at && (
          <section
            className="app-card app-welcome-id-verify"
            style={{ marginTop: '1rem' }}
            aria-labelledby="welcome-id-verify-heading"
          >
            <h2 id="welcome-id-verify-heading" className="app-how-it-works-section-title" style={{ marginTop: 0 }}>
              Get ID verified
            </h2>
            <p style={{ color: 'var(--color-textSecondary)', fontSize: '0.9375rem', margin: '0 0 0.75rem 0' }}>
              A blue check helps people say yes with confidence. About a minute with Persona.
            </p>
            <PersonaIdVerification userId={userId} idVerifiedAt={profile?.id_verified_at ?? null} onVerified={refetch} />
          </section>
        )}
    </div>

      <NewQuestionsSection
        userId={userId}
        intake={intake}
        onboardingLoading={onboardingLoading}
        onboardingComplete={questionnaireComplete}
        refetch={refetch}
      />
    </>
  )
}
