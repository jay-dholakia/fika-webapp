'use client'

import { useState, useEffect } from 'react'
import { getSupabase } from '@/lib/supabase'
import {
  ageFromBirthdate,
  formatIntakeAnswer,
  filterSafeIntakeResponses,
} from '@/lib/intro-detail'
import {
  parseIntroCardSummary,
  buildIntroCardFallback,
  type IntroCardSummary,
} from '@/lib/intro-card-summary'
import { VerifiedBadge } from '@/app/app/components/VerifiedBadge'
import type { IntakeResponseItem } from '@/lib/db-types'

export type IntroMatch = {
  id: string
  otherUserId: string
  otherFirstName: string
  otherCity: string | null
  /** Age in years for card preview */
  otherAge?: number | null
  score: number | null
  reasons: {
    whyWeIntroducedYou?: string[]
    conversationHooks?: string[]
    sharedInterests?: string[]
    conversation_hooks?: string[]
    shared_interests?: string[]
    /** Shared `q_like_talking_about` chips from `reasons.raw` (set by admin sim / matchers). */
    fika_talk_overlap?: string[]
  } | null
  /** Preview for card: topics they enjoy (q5) */
  conversationTypesPreview?: string | null
  /** Preview for card: fika preference (q4) */
  fikaPreferencePreview?: string | null
  /** True when the other user completed Persona ID verification */
  otherIdVerified?: boolean
}

type ModalDetail = {
  profile: {
    birthdate: string | null
    bio_text: string | null
    pronouns: string | null
    avatar_url: string | null
    languages: string[] | null
    id_verified_at: string | null
  }
  intakeResponses: IntakeResponseItem[]
  introCardSummary: IntroCardSummary
}

type IntroDetailModalProps = {
  intro: IntroMatch
  onClose: () => void
  onOptIn?: (intro: IntroMatch) => void
  onPass?: (intro: IntroMatch) => void
  actionMatchId: string | null
  error: string | null
  currentUserId?: string | null
}

export function IntroDetailModal({
  intro,
  onClose,
  onOptIn,
  onPass,
  actionMatchId,
  error,
  currentUserId,
}: IntroDetailModalProps) {
  const [detail, setDetail] = useState<ModalDetail | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = getSupabase()
    if (!supabase) {
      setLoading(false)
      return
    }

    const log = (msg: string, data?: unknown) => {
      console.log('[IntroDetailModal]', msg, data ?? '')
    }

    let cancelled = false
    log('fetching profile + intake', { otherUserId: intro.otherUserId, otherFirstName: intro.otherFirstName })

    Promise.all([
      supabase
        .from('profiles')
        .select('birthdate, bio_text, pronouns, avatar_url, languages, id_verified_at')
        .eq('id', intro.otherUserId)
        .single()
        .then((r) => {
          if (cancelled) return null
          if (r.error) {
            log('profile fetch error', { error: r.error.message, code: r.error.code })
            return null
          }
          if (!r.data) {
            log('profile fetch: no data')
            return null
          }
          const d = r.data as {
            birthdate?: string | null
            bio_text?: string | null
            pronouns?: string | null
            avatar_url?: string | null
            languages?: string[] | null
            id_verified_at?: string | null
          }
          const profile = {
            birthdate: d.birthdate ?? null,
            bio_text: d.bio_text ?? null,
            pronouns: d.pronouns ?? null,
            avatar_url: d.avatar_url ?? null,
            languages: Array.isArray(d.languages) ? d.languages : null,
            id_verified_at: d.id_verified_at ?? null,
          }
          log('profile loaded', { hasAvatar: !!profile.avatar_url, hasBio: !!profile.bio_text?.trim(), hasLanguages: !!profile.languages?.length })
          return profile
        }),
      supabase
        .from('intake_responses_v5')
        .select('responses, intro_card_summary')
        .eq('user_id', intro.otherUserId)
        .maybeSingle()
        .then((r) => {
          if (cancelled) return { responses: [] as IntakeResponseItem[], introRaw: null as unknown }
          if (r.error) {
            log('intake fetch error', { error: r.error.message, code: r.error.code })
            return { responses: [] as IntakeResponseItem[], introRaw: null }
          }
          if (r.data == null) {
            log('intake fetch: no row (user may have no intake, or RLS blocking matched-user read)')
            return { responses: [] as IntakeResponseItem[], introRaw: null }
          }
          const responses = r.data?.responses
          if (!Array.isArray(responses)) {
            log('intake fetch: responses not array', { raw: responses == null ? 'null/undefined' : typeof responses })
            return { responses: [] as IntakeResponseItem[], introRaw: null }
          }
          const filtered = filterSafeIntakeResponses(responses as IntakeResponseItem[])
          log('intake loaded', { rawCount: responses.length, safeCount: filtered.length, questionIds: filtered.map((x) => x.question_id) })
          return { responses: filtered, introRaw: r.data.intro_card_summary }
        }),
    ])
      .then(([profile, intakeBundle]) => {
        if (cancelled) return
        const intakeResponses = intakeBundle.responses
        const stored = parseIntroCardSummary(intakeBundle.introRaw)
        const introCardSummary = stored ?? buildIntroCardFallback(intakeResponses)
        log('detail set', {
          hasProfile: !!profile,
          intakeCount: intakeResponses?.length ?? 0,
        })
        setDetail({
          profile: profile ?? {
            birthdate: null,
            bio_text: null,
            pronouns: null,
            avatar_url: null,
            languages: null,
            id_verified_at: null,
          },
          intakeResponses: intakeResponses ?? [],
          introCardSummary,
        })
      })
      .catch((err) => {
        if (!cancelled) {
          log('fetch failed', err)
          setDetail({
            profile: {
              birthdate: null,
              bio_text: null,
              pronouns: null,
              avatar_url: null,
              languages: null,
              id_verified_at: null,
            },
            intakeResponses: [],
            introCardSummary: buildIntroCardFallback([]),
          })
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [intro.id, intro.otherUserId])

  // Log which sections will render when detail is set (dev debugging)
  useEffect(() => {
    if (!detail || loading) return
    console.log('[IntroDetailModal] sections', {
      profile: { avatar: !!detail.profile.avatar_url, languages: !!detail.profile.languages?.length, bio: !!detail.profile.bio_text?.trim() },
    })
  }, [detail, loading])

  const age = detail ? ageFromBirthdate(detail.profile.birthdate) : null

  // Normalize reasons (backend may send snake_case)
  const rawReasons = ((intro.reasons as { raw?: Record<string, unknown> } | null)?.raw ?? intro.reasons ?? null) as Record<string, unknown> | null
  const copyReasons = ((intro.reasons as { copy?: Record<string, unknown> } | null)?.copy ?? intro.reasons ?? null) as Record<string, unknown> | null
  const conversationHooks = intro.reasons?.conversationHooks?.length
    ? intro.reasons.conversationHooks
    : ((rawReasons?.conversation_hooks as string[] | undefined) ?? intro.reasons?.conversation_hooks ?? [])
  const sharedInterestsFromReasons =
    intro.reasons?.sharedInterests?.length
      ? intro.reasons.sharedInterests
      : ((copyReasons?.shared_interests as string[] | undefined) ?? intro.reasons?.shared_interests ?? [])

  // If no shared_interests array, try to parse "You both enjoy X and Y" from hooks
  const parsedInterests: string[] = []
  if (sharedInterestsFromReasons.length === 0 && conversationHooks.length > 0) {
    for (const hook of conversationHooks) {
      const match = hook.match(/you both enjoy ([^.]+)/i)
      if (match) {
        const part = match[1].trim()
        const list = part.split(/\s*,?\s+and\s+,?\s*|\s*,\s*/i).map((s) => s.trim()).filter(Boolean)
        parsedInterests.push(...list)
      }
    }
  }
  const displayInterests = sharedInterestsFromReasons.length > 0 ? sharedInterestsFromReasons : Array.from(new Set(parsedInterests))

  const displayFikaTalkOverlap = (
    (rawReasons?.fika_talk_overlap as string[] | undefined) ??
    intro.reasons?.fika_talk_overlap ??
    []
  )
    .map((s) => String(s).trim())
    .filter(Boolean)

  return (
    <div className="app-modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="intro-modal-title">
      <div className="app-modal" onClick={(e) => e.stopPropagation()}>
        <header className="app-modal-header app-modal-header--intro">
          <button type="button" className="app-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
          <div className="app-modal-header-intro-column">
            {detail?.profile?.avatar_url ? (
              <img
                src={detail.profile.avatar_url}
                alt=""
                className="app-modal-header-avatar app-modal-header-avatar--intro"
              />
            ) : (
              <span
                className="app-modal-header-avatar app-modal-header-avatar-fallback app-modal-header-avatar--intro"
                aria-hidden
              >
                {intro.otherFirstName?.charAt(0)?.toUpperCase() || '?'}
              </span>
            )}
            <h2 id="intro-modal-title" className="app-modal-title app-modal-title--intro app-intro-name-with-badge">
              <span>{intro.otherFirstName}</span>
              {(intro.otherIdVerified || detail?.profile?.id_verified_at) ? <VerifiedBadge /> : null}
            </h2>
          </div>
        </header>

        <div className="app-modal-body">
          {loading ? (
            <p className="app-empty">Loading…</p>
          ) : (
            <>
              <div className="app-intro-detail-profile">
                <div className="app-intro-detail-profile-text">
                  <div className="app-intro-detail-meta">
                    {age != null && <span>{age} years old</span>}
                    {detail?.profile?.pronouns && (
                      <span>{age != null ? ' · ' : ''}{detail.profile.pronouns}</span>
                    )}
                  </div>
                  {detail?.introCardSummary &&
                    (detail.introCardSummary.paragraph.trim() || detail.introCardSummary.bullets.length > 0) ? (
                    <section className="app-intro-detail-section app-intro-at-a-glance">
                      <h3 className="app-intro-detail-section-title">At a glance</h3>
                      {detail.introCardSummary.paragraph.trim() ? (
                        <p className="app-intro-at-a-glance-lede">{detail.introCardSummary.paragraph}</p>
                      ) : null}
                      {detail.introCardSummary.bullets.length > 0 ? (
                        <ul className="app-intro-detail-hooks app-intro-at-a-glance-bullets">
                          {detail.introCardSummary.bullets.map((line, i) => (
                            <li key={i}>{line}</li>
                          ))}
                        </ul>
                      ) : null}
                    </section>
                  ) : null}
                  {detail?.profile?.languages?.length ? (
                    <p className="app-intro-detail-languages">
                      Speaks {detail.profile.languages.join(', ')}
                    </p>
                  ) : null}
                  {detail?.profile?.bio_text?.trim() ? (
                    <p className="app-intro-detail-bio">{detail.profile.bio_text.trim()}</p>
                  ) : null}
                </div>
              </div>

              {(() => {
                const getAnswer = (questionId: string) => {
                  const r = detail?.intakeResponses?.find((x) => x.question_id === questionId)
                  if (!r?.answer) return null
                  const s = formatIntakeAnswer(r.answer).trim()
                  return s || null
                }
                const book = getAnswer('q_book_recommendation')
                const movieShow = getAnswer('q_movie_show_recommendation')
                const roleModel = getAnswer('q_role_model')
                if (!book && !movieShow && !roleModel) return null
                return (
                  <section className="app-intro-detail-section">
                    <h3 className="app-intro-detail-section-title">More about them</h3>
                    <dl className="app-intro-detail-more">
                      {book ? (
                        <>
                          <dt>Book they&apos;d recommend</dt>
                          <dd>{book}</dd>
                        </>
                      ) : null}
                      {movieShow ? (
                        <>
                          <dt>Movie or show they&apos;d recommend</dt>
                          <dd>{movieShow}</dd>
                        </>
                      ) : null}
                      {roleModel ? (
                        <>
                          <dt>Role model</dt>
                          <dd>{roleModel}</dd>
                        </>
                      ) : null}
                    </dl>
                  </section>
                )
              })()}

              {(intro.reasons?.whyWeIntroducedYou?.length ?? 0) > 0 ? (
                <section className="app-intro-detail-section">
                  <h3 className="app-intro-detail-section-title">Why we introduced you</h3>
                  <ul className="app-intro-detail-hooks">
                    {(intro.reasons?.whyWeIntroducedYou ?? []).map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {displayInterests.length > 0 ? (
                <section className="app-intro-detail-section">
                  <h3 className="app-intro-detail-section-title">Interests</h3>
                  <div className="app-intro-pills">
                    {displayInterests.map((interest, i) => (
                      <span key={i} className="app-intro-pill">{interest.trim()}</span>
                    ))}
                  </div>
                </section>
              ) : null}

              {displayFikaTalkOverlap.length > 0 ? (
                <section className="app-intro-detail-section">
                  <h3 className="app-intro-detail-section-title">Like talking about</h3>
                  <div className="app-intro-pills">
                    {displayFikaTalkOverlap.map((topic, i) => (
                      <span key={i} className="app-intro-pill">{topic}</span>
                    ))}
                  </div>
                </section>
              ) : null}

            </>
          )}
        </div>

        <footer className="app-modal-footer">
          <p className="app-intro-sms-cta" style={{ margin: 0, fontSize: '0.95rem', color: 'var(--color-textSecondary)' }}>
            You&apos;ll get intro details by text about 30 minutes before your Fika.
          </p>
          {error && <p className="onboarding-error" style={{ marginTop: '0.5rem' }}>{error}</p>}
        </footer>
      </div>
    </div>
  )
}
