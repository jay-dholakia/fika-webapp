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
import { summarizeAvailabilitySlots, getAvailabilitySlotLabel } from '@/lib/availability-slots'
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
    /** Shared `q_like_talking_about` chips from `reasons.raw` (set by replenish / admin sim). */
    fika_talk_overlap?: string[]
    /** Overlapping 30-min slot IDs for intro card; summarize with summarizeAvailabilitySlots() */
    overlappingAvailabilitySlots?: string[]
  } | null
  myDecision?: 'yes' | 'no'
  /** Preview for card: topics they enjoy (q5) */
  conversationTypesPreview?: string | null
  /** Preview for card: fika preference (q4) */
  fikaPreferencePreview?: string | null
  /** Scheduling: proposed_default | counter_proposed | final_proposed | confirmed | expired */
  schedulingStatus?: string | null
  /** SMS state for this user + match (e.g. match_offered, awaiting_availability) */
  matchState?: string | null
  defaultSlotId?: string | null
  overlappingSlotIds?: string[] | null
  counterSlotId?: string | null
  counterProposedByUserId?: string | null
  finalSlotId?: string | null
  confirmedSlotId?: string | null
  confirmedVenueId?: string | null
  /** When confirmed: venue name and neighborhood for card/modal display */
  confirmedVenueName?: string | null
  confirmedVenueNeighborhood?: string | null
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
  onSchedulingAction?: (intro: IntroMatch, action: string, slotId?: string) => Promise<void>
  actionMatchId: string | null
  error: string | null
  currentUserId?: string | null
}

const CONCIERGE_NUMBER = process.env.NEXT_PUBLIC_SENDBLUE_CONCIERGE_NUMBER?.trim() || null

export function IntroDetailModal({
  intro,
  onClose,
  onOptIn,
  onPass,
  onSchedulingAction,
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

  const schedulingStatus = intro.schedulingStatus ?? null
  const defaultSlotId = intro.defaultSlotId ?? intro.reasons?.overlappingAvailabilitySlots?.[0] ?? null
  const slots = intro.overlappingSlotIds ?? intro.reasons?.overlappingAvailabilitySlots ?? []
  const counterSlotId = intro.counterSlotId ?? null
  const finalSlotId = intro.finalSlotId ?? null
  const confirmedSlotId = intro.confirmedSlotId ?? null
  const counterProposedByUserId = intro.counterProposedByUserId ?? null
  const isRequester = currentUserId && counterProposedByUserId === currentUserId
  const alternateSlots = defaultSlotId ? slots.filter((s) => s !== defaultSlotId) : [...slots]
  const remainingAfterCounter =
    counterSlotId && defaultSlotId
      ? slots.filter((s) => s !== defaultSlotId && s !== counterSlotId)
      : []
  const hasRemainingAfterCounter = remainingAfterCounter.length > 0

  const showScheduling =
    schedulingStatus &&
    schedulingStatus !== 'expired' &&
    slots.length > 0

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

              {(() => {
                const slots = intro.reasons?.overlappingAvailabilitySlots
                const windows = slots?.length ? summarizeAvailabilitySlots(slots) : []
                if (windows.length === 0) return null
                return (
                  <section className="app-intro-detail-section">
                    <h3 className="app-intro-detail-section-title">Possible times for your Fika</h3>
                    <ul className="app-intro-detail-hooks">
                      {windows.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </section>
                )
              })()}

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
                  <h3 className="app-intro-detail-section-title">Up for talking about (this Fika)</h3>
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
          {schedulingStatus === 'confirmed' ? (
            <>
              <span className="app-intro-status">
                Confirmed Fika · {confirmedSlotId ? getAvailabilitySlotLabel(confirmedSlotId) : 'Time TBD'}
                {intro.confirmedVenueName ? ` · ${intro.confirmedVenueName}${intro.confirmedVenueNeighborhood ? ` (${intro.confirmedVenueNeighborhood})` : ''}` : ''}
              </span>
              {CONCIERGE_NUMBER && (
                <p style={{ marginTop: '0.75rem', fontSize: '0.9rem' }}>
                  Running late or can&apos;t make it?{' '}
                  <a href={`sms:${CONCIERGE_NUMBER}`} className="app-intro-btn app-intro-btn-secondary" style={{ display: 'inline-block', marginTop: '0.25rem' }}>
                    Reply by text
                  </a>
                </p>
              )}
            </>
          ) : schedulingStatus === 'expired' ? (
            <span className="app-intro-status">Expired</span>
          ) : showScheduling && (schedulingStatus === 'proposed_default' || schedulingStatus === 'counter_proposed' || schedulingStatus === 'final_proposed') ? (
            <>
              <p className="app-scheduling-proposal">
                {schedulingStatus === 'proposed_default' && (
                  <>Suggested time: <strong>{defaultSlotId ? getAvailabilitySlotLabel(defaultSlotId) : '—'}</strong></>
                )}
                {schedulingStatus === 'counter_proposed' && (
                  <>{intro.otherFirstName} suggested: <strong>{counterSlotId ? getAvailabilitySlotLabel(counterSlotId) : '—'}</strong></>
                )}
                {schedulingStatus === 'final_proposed' && (
                  <>{intro.otherFirstName} suggested: <strong>{finalSlotId ? getAvailabilitySlotLabel(finalSlotId) : '—'}</strong></>
                )}
              </p>
              <p className="app-intro-sms-cta" style={{ marginBottom: '0.75rem', fontSize: '0.95rem', color: 'var(--color-textSecondary)' }}>
                To confirm this time, suggest a different time, or say you can&apos;t make it, reply by text.
              </p>
              {CONCIERGE_NUMBER ? (
                <a href={`sms:${CONCIERGE_NUMBER}`} className="app-intro-btn app-intro-btn-primary">
                  Reply by text
                </a>
              ) : (
                <span className="app-intro-status">Reply by text from your account or welcome message.</span>
              )}
            </>
          ) : intro.myDecision === 'yes' ? (
            <span className="app-intro-status">You opted in · Waiting for them</span>
          ) : intro.myDecision === 'no' ? (
            <span className="app-intro-status">Passed</span>
          ) : (
            <>
              <p className="app-intro-sms-cta" style={{ marginBottom: '0.75rem', fontSize: '0.95rem', color: 'var(--color-textSecondary)' }}>
                To accept or pass on this intro, reply by text.
              </p>
              <div className="app-scheduling-actions" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
                {CONCIERGE_NUMBER ? (
                  <>
                    <a
                      href={`sms:${CONCIERGE_NUMBER}?body=YES`}
                      className="app-intro-btn app-intro-btn-primary"
                    >
                      Accept (reply YES)
                    </a>
                    <a
                      href={`sms:${CONCIERGE_NUMBER}?body=PASS`}
                      className="app-intro-btn app-intro-btn-secondary"
                    >
                      Pass (reply PASS)
                    </a>
                  </>
                ) : (
                  <span className="app-intro-status">Text YES or PASS to the number we use to text you.</span>
                )}
              </div>
              <p style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: 'var(--color-textSecondary)' }}>
                After you reply, refresh the page to see your status.
              </p>
            </>
          )}
          {error && <p className="onboarding-error" style={{ marginTop: '0.5rem' }}>{error}</p>}
        </footer>
      </div>
    </div>
  )
}
