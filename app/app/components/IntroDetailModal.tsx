'use client'

import { useState, useEffect } from 'react'
import { getSupabase } from '@/lib/supabase'
import {
  ageFromBirthdate,
  formatIntakeAnswer,
  filterSafeIntakeResponses,
} from '@/lib/intro-detail'
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
    /** Overlapping 30-min slot IDs for intro card; summarize with summarizeAvailabilitySlots() */
    overlappingAvailabilitySlots?: string[]
  } | null
  myDecision?: 'yes' | 'no'
  conversationId?: string | null
  /** Preview for card: topics they enjoy (q5) */
  conversationTypesPreview?: string | null
  /** Preview for card: fika preference (q4) */
  fikaPreferencePreview?: string | null
  /** Scheduling: proposed_default | counter_proposed | final_proposed | confirmed | expired */
  schedulingStatus?: string | null
  defaultSlotId?: string | null
  overlappingSlotIds?: string[] | null
  counterSlotId?: string | null
  counterProposedByUserId?: string | null
  finalSlotId?: string | null
  confirmedSlotId?: string | null
}

type ModalDetail = {
  profile: {
    birthdate: string | null
    bio_text: string | null
    pronouns: string | null
    avatar_url: string | null
    languages: string[] | null
  }
  intakeResponses: IntakeResponseItem[]
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
        .select('birthdate, bio_text, pronouns, avatar_url, languages')
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
          const d = r.data as { birthdate?: string | null; bio_text?: string | null; pronouns?: string | null; avatar_url?: string | null; languages?: string[] | null }
          const profile = {
            birthdate: d.birthdate ?? null,
            bio_text: d.bio_text ?? null,
            pronouns: d.pronouns ?? null,
            avatar_url: d.avatar_url ?? null,
            languages: Array.isArray(d.languages) ? d.languages : null,
          }
          log('profile loaded', { hasAvatar: !!profile.avatar_url, hasBio: !!profile.bio_text?.trim(), hasLanguages: !!profile.languages?.length })
          return profile
        }),
      supabase
        .from('intake_responses_v5')
        .select('responses')
        .eq('user_id', intro.otherUserId)
        .maybeSingle()
        .then((r) => {
          if (cancelled) return []
          if (r.error) {
            log('intake fetch error', { error: r.error.message, code: r.error.code })
            return []
          }
          if (r.data == null) {
            log('intake fetch: no row (user may have no intake, or RLS blocking matched-user read)')
            return []
          }
          const responses = r.data?.responses
          if (!Array.isArray(responses)) {
            log('intake fetch: responses not array', { raw: responses == null ? 'null/undefined' : typeof responses })
            return []
          }
          const filtered = filterSafeIntakeResponses(responses as IntakeResponseItem[])
          log('intake loaded', { rawCount: responses.length, safeCount: filtered.length, questionIds: filtered.map((x) => x.question_id) })
          return filtered
        }),
    ])
      .then(([profile, intakeResponses]) => {
        if (cancelled) return
        const interestsResp = intakeResponses?.find((r) => r.question_id === 'q_topics')
        log('detail set', {
          hasProfile: !!profile,
          intakeCount: intakeResponses?.length ?? 0,
          hasInterestsResp: !!interestsResp,
        })
        setDetail({
          profile: profile ?? { birthdate: null, bio_text: null, pronouns: null, avatar_url: null, languages: null },
          intakeResponses: intakeResponses ?? [],
        })
      })
      .catch((err) => {
        if (!cancelled) {
          log('fetch failed', err)
          setDetail({
            profile: { birthdate: null, bio_text: null, pronouns: null, avatar_url: null, languages: null },
            intakeResponses: [],
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
    const interestsResp = detail.intakeResponses?.find((r) => r.question_id === 'q_topics')
    console.log('[IntroDetailModal] sections', {
      profile: { avatar: !!detail.profile.avatar_url, languages: !!detail.profile.languages?.length, bio: !!detail.profile.bio_text?.trim() },
      interests: !!interestsResp?.answer,
    })
  }, [detail, loading])

  const age = detail ? ageFromBirthdate(detail.profile.birthdate) : null

  // Normalize reasons (backend may send snake_case)
  const conversationHooks = intro.reasons?.conversationHooks?.length
    ? intro.reasons.conversationHooks
    : intro.reasons?.conversation_hooks ?? []
  const sharedInterestsFromReasons =
    intro.reasons?.sharedInterests?.length
      ? intro.reasons.sharedInterests
      : intro.reasons?.shared_interests ?? []

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
        <header className="app-modal-header">
          <div className="app-modal-header-title-row">
            {detail?.profile?.avatar_url ? (
              <img
                src={detail.profile.avatar_url}
                alt=""
                className="app-modal-header-avatar"
              />
            ) : (
              <span className="app-modal-header-avatar app-modal-header-avatar-fallback" aria-hidden>
                {intro.otherFirstName?.charAt(0)?.toUpperCase() || '?'}
              </span>
            )}
            <h2 id="intro-modal-title" className="app-modal-title">
              {intro.otherFirstName}
            </h2>
          </div>
          <button type="button" className="app-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <div className="app-modal-body">
          {loading ? (
            <p className="app-empty">Loading…</p>
          ) : (
            <>
              <div className="app-intro-detail-profile">
                <div className="app-intro-detail-profile-text">
                  <div className="app-intro-detail-meta">
                    {intro.otherCity && <span>{intro.otherCity}</span>}
                    {age != null && (
                      <span>{intro.otherCity ? ' · ' : ''}{age} years old</span>
                    )}
                    {detail?.profile?.pronouns && (
                      <span> · {detail.profile.pronouns}</span>
                    )}
                  </div>
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
                const place = getAnswer('q_place_recommendation')
                const roleModel = getAnswer('q_role_model')
                if (!book && !movieShow && !place && !roleModel) return null
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
                      {place ? (
                        <>
                          <dt>Place they&apos;d recommend</dt>
                          <dd>{place}</dd>
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

              {conversationHooks.length > 0 ? (
                <section className="app-intro-detail-section">
                  <h3 className="app-intro-detail-section-title">Start here</h3>
                  <ul className="app-intro-detail-hooks">
                    {conversationHooks.slice(0, 4).map((hook, i) => (
                      <li key={i}>{hook}</li>
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
                    <h3 className="app-intro-detail-section-title">When you&apos;re both free</h3>
                    <ul className="app-intro-detail-hooks">
                      {windows.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </section>
                )
              })()}

              {(() => {
                const interestsResp = detail?.intakeResponses?.find((r) => r.question_id === 'q_topics')
                const interestsText = interestsResp ? formatIntakeAnswer(interestsResp.answer) : null
                const interestsList = interestsResp && Array.isArray(interestsResp.answer)
                  ? (interestsResp.answer as string[]).filter(Boolean)
                  : interestsText
                    ? interestsText.split(/\s*,\s*/).map((s) => s.trim()).filter(Boolean)
                    : displayInterests
                if (!interestsList?.length) return null
                return (
                  <section className="app-intro-detail-section">
                    <h3 className="app-intro-detail-section-title">Interests</h3>
                    <div className="app-intro-pills">
                      {interestsList.map((interest, i) => (
                        <span key={i} className="app-intro-pill">{interest.trim()}</span>
                      ))}
                    </div>
                  </section>
                )
              })()}

            </>
          )}
        </div>

        <footer className="app-modal-footer">
          {schedulingStatus === 'confirmed' ? (
            <>
              <span className="app-intro-status">
                Confirmed for {confirmedSlotId ? getAvailabilitySlotLabel(confirmedSlotId) : 'your Fika'}
              </span>
              {CONCIERGE_NUMBER && (
                <p style={{ marginTop: '0.75rem', fontSize: '0.9rem' }}>
                  Running late or can&apos;t make it?{' '}
                  <a href={`sms:${CONCIERGE_NUMBER}`} className="app-intro-btn app-intro-btn-secondary" style={{ display: 'inline-block', marginTop: '0.25rem' }}>
                    Text your Fika concierge
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
                To confirm this time, suggest a different time, or say you can&apos;t make it, text your Fika concierge.
              </p>
              {CONCIERGE_NUMBER ? (
                <a href={`sms:${CONCIERGE_NUMBER}`} className="app-intro-btn app-intro-btn-primary">
                  Text your Fika concierge
                </a>
              ) : (
                <span className="app-intro-status">Text your Fika concierge from your account or welcome message.</span>
              )}
            </>
          ) : intro.myDecision === 'yes' ? (
            intro.conversationId ? (
              <a href={`/app/chats/${intro.conversationId}`} className="app-intro-btn app-intro-btn-primary">
                Open chat
              </a>
            ) : (
              <span className="app-intro-status">You opted in · Waiting for them</span>
            )
          ) : intro.myDecision === 'no' ? (
            <span className="app-intro-status">Passed</span>
          ) : (
            <>
              <p className="app-intro-sms-cta" style={{ marginBottom: '0.75rem', fontSize: '0.95rem', color: 'var(--color-textSecondary)' }}>
                To accept or pass on this intro, text your Fika concierge.
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
                  <span className="app-intro-status">Text YES or PASS to your Fika concierge.</span>
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
