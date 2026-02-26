'use client'

import { useState, useEffect } from 'react'
import { getSupabase } from '@/lib/supabase'
import {
  ageFromBirthdate,
  formatIntakeAnswer,
  filterSafeIntakeResponses,
} from '@/lib/intro-detail'
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
    conversationHooks?: string[]
    sharedInterests?: string[]
    conversation_hooks?: string[]
    shared_interests?: string[]
  } | null
  myDecision?: 'yes' | 'no'
  conversationId?: string | null
  /** Preview for card: conversations they're looking for (q1) */
  conversationTypesPreview?: string | null
  /** Preview for card: fika preference (q4) */
  fikaPreferencePreview?: string | null
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
  onOptIn: (intro: IntroMatch) => void
  onPass: (intro: IntroMatch) => void
  actionMatchId: string | null
  error: string | null
}

export function IntroDetailModal({
  intro,
  onClose,
  onOptIn,
  onPass,
  actionMatchId,
  error,
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
        const conversationTypes = intakeResponses?.find((r) => r.question_id === 'q1_conversation_types')
        const interestsResp = intakeResponses?.find((r) => r.question_id === 'q5_talk_about')
        log('detail set', {
          hasProfile: !!profile,
          intakeCount: intakeResponses?.length ?? 0,
          hasConversationTypes: !!conversationTypes,
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
    const conversationTypes = detail.intakeResponses?.find((r) => r.question_id === 'q1_conversation_types')
    const typesText = conversationTypes ? formatIntakeAnswer(conversationTypes.answer) : null
    const interestsResp = detail.intakeResponses?.find((r) => r.question_id === 'q5_talk_about')
    console.log('[IntroDetailModal] sections', {
      profile: { avatar: !!detail.profile.avatar_url, languages: !!detail.profile.languages?.length, bio: !!detail.profile.bio_text?.trim() },
      conversationTypes: !!typesText,
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
  const displayInterests = sharedInterestsFromReasons.length > 0 ? sharedInterestsFromReasons : [...new Set(parsedInterests)]

  // Fika preference (q4) and typical availability (q9) for bottom of modal
  const fikaPreference = detail?.intakeResponses?.find((r) => r.question_id === 'q4_where_most_yourself')
  const fikaPreferenceText = fikaPreference ? formatIntakeAnswer(fikaPreference.answer) : null
  const typicalAvailability = detail?.intakeResponses?.find((r) => r.question_id === 'q9_availability')
  const typicalAvailabilityText = typicalAvailability ? formatIntakeAnswer(typicalAvailability.answer) : null

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
                    {detail.profile.pronouns && (
                      <span> · {detail.profile.pronouns}</span>
                    )}
                  </div>
                  {detail.profile.languages?.length ? (
                    <p className="app-intro-detail-languages">
                      Speaks {detail.profile.languages.join(', ')}
                    </p>
                  ) : null}
                  {detail.profile.bio_text?.trim() ? (
                    <p className="app-intro-detail-bio">{detail.profile.bio_text.trim()}</p>
                  ) : null}
                </div>
              </div>

              {conversationHooks.length > 0 ? (
                <section className="app-intro-detail-section">
                  <h3 className="app-intro-detail-section-title">Why you might connect</h3>
                  <ul className="app-intro-detail-hooks">
                    {conversationHooks.slice(0, 4).map((hook, i) => (
                      <li key={i}>{hook}</li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {(() => {
                const interestsResp = detail?.intakeResponses?.find((r) => r.question_id === 'q5_talk_about')
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

              {(() => {
                const conversationTypes = detail?.intakeResponses?.find((r) => r.question_id === 'q1_conversation_types')
                const typesText = conversationTypes ? formatIntakeAnswer(conversationTypes.answer) : null
                if (!typesText) return null
                return (
                  <section className="app-intro-detail-section">
                    <h3 className="app-intro-detail-section-title">Conversations they&apos;re looking for</h3>
                    <p className="app-intro-detail-conversation-types">{typesText}</p>
                  </section>
                )
              })()}

              {fikaPreferenceText ? (
                <section className="app-intro-detail-section">
                  <h3 className="app-intro-detail-section-title">Fika preference</h3>
                  <p className="app-intro-detail-conversation-types">{fikaPreferenceText}</p>
                </section>
              ) : null}
              {typicalAvailabilityText ? (
                <section className="app-intro-detail-section">
                  <h3 className="app-intro-detail-section-title">Typical availability</h3>
                  <p className="app-intro-detail-conversation-types">{typicalAvailabilityText}</p>
                </section>
              ) : null}
            </>
          )}
        </div>

        <footer className="app-modal-footer">
          {intro.myDecision === 'yes' ? (
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
              <button
                type="button"
                className="app-intro-btn app-intro-btn-primary"
                onClick={() => onOptIn(intro)}
                disabled={actionMatchId !== null}
              >
                {actionMatchId === intro.id ? 'Opting in…' : 'Opt in'}
              </button>
              <button
                type="button"
                className="app-intro-btn app-intro-btn-secondary"
                onClick={() => onPass(intro)}
                disabled={actionMatchId !== null}
              >
                Pass
              </button>
            </>
          )}
          {error && <p className="onboarding-error" style={{ marginTop: '0.5rem' }}>{error}</p>}
        </footer>
      </div>
    </div>
  )
}
