'use client'

import { useState, useEffect } from 'react'
import { getSupabase } from '@/lib/supabase'
import { useOnboardingStatus } from '@/lib/use-onboarding'
import type { IntakeResponseItem, IntakeResponsesV5Row } from '@/lib/db-types'
import { VerifiedBadge } from '@/app/app/components/VerifiedBadge'

const CONCIERGE = '+13102102404'

const PROFILE_DISPLAY = [
  { key: 'first_name', label: 'Name', locked: true },
  { key: 'birthdate', label: 'Birthday', locked: true },
  { key: 'pronouns', label: 'Pronouns', locked: true },
  { key: 'city', label: 'Location', locked: true },
  { key: 'languages', label: 'Languages', locked: true },
] as const

const SMS_QUESTIONS = [
  { id: 'q_neighborhood', label: 'Neighborhood', isChoice: false },
  { id: 'q_relationship_status', label: 'Relationship status', isChoice: false },
  { id: 'q_kids', label: 'Kids', isChoice: false },
  { id: 'q_work', label: 'Work', isChoice: false },
  { id: 'q_interests_freetext', label: 'Life outside work', isChoice: false },
  { id: 'q_social_goal', label: 'What you want from Fika', isChoice: true },
  { id: 'q_market_tenure', label: 'Time in the city', isChoice: false },
  { id: 'q_anything_else', label: 'Anything else', isChoice: false },
]

function LockIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ color: 'var(--color-textSecondary)', opacity: 0.5, flexShrink: 0, marginTop: '1px' }}
      aria-label="locked"
    >
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}

function formatBirthdate(d: string | null | undefined): string | null {
  if (!d) return null
  const dt = new Date(d)
  if (isNaN(dt.getTime())) return d
  return dt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
}

function getProfileValue(profile: Record<string, unknown> | null, key: string): string | null {
  if (!profile) return null
  const v = profile[key]
  if (Array.isArray(v)) return v.length > 0 ? v.join(', ') : null
  if (key === 'birthdate') return formatBirthdate(v as string | null)
  if (typeof v === 'string' && v.trim()) return v.trim()
  return null
}

function getSmsAnswer(intake: IntakeResponsesV5Row | null, questionId: string): string | null {
  const responses = Array.isArray(intake?.responses) ? (intake!.responses as IntakeResponseItem[]) : []
  const r = responses.find((x) => x.question_id === questionId)
  const a = r?.answer
  if (typeof a === 'string' && a.trim() && a.trim() !== 'N/A') return a.trim()
  return null
}

function smsEditHref(questionId: string, isChoice: boolean, currentAnswer: string | null): string {
  const body = isChoice
    ? `[edit:${questionId}]`
    : `[edit:${questionId}] ${currentAnswer ?? ''}`
  return `sms:${CONCIERGE}?body=${encodeURIComponent(body)}`
}

type RowProps = {
  label: string
  value: string | null
  locked?: boolean
  editHref?: string
  last?: boolean
}

function InfoRow({ label, value, locked, editHref, last }: RowProps) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        padding: '0.75rem 0',
        borderBottom: last ? 'none' : '1px solid var(--color-border)',
        gap: '1rem',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', marginBottom: '0.2rem' }}>
          <span style={{ fontSize: '0.78rem', color: 'var(--color-textSecondary)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
            {label}
          </span>
          {locked && <LockIcon />}
        </div>
        <div style={{ fontSize: '0.95rem', wordBreak: 'break-word' }}>
          {value ?? <span style={{ color: 'var(--color-textSecondary)' }}>—</span>}
        </div>
      </div>
      {!locked && editHref && (
        <a
          href={editHref}
          style={{
            fontSize: '0.8rem',
            color: 'var(--color-primary)',
            flexShrink: 0,
            textDecoration: 'none',
            padding: '0.25rem 0.6rem',
            border: '1px solid var(--color-primary)',
            borderRadius: '6px',
            whiteSpace: 'nowrap',
            marginTop: '0.1rem',
          }}
        >
          Edit
        </a>
      )}
    </div>
  )
}

export default function SettingsProfilePage() {
  const [userId, setUserId] = useState<string | null>(null)
  const { loading: statusLoading, profile, intake } = useOnboardingStatus(userId ?? undefined)

  useEffect(() => {
    getSupabase()?.auth.getSession().then(({ data: { session } }) => {
      setUserId(session?.user?.id ?? null)
    })
  }, [])

  if (statusLoading) {
    return (
      <div className="app-card">
        <p>Loading your profile…</p>
      </div>
    )
  }

  if (!userId) {
    return (
      <div className="app-card">
        <p>Please log in to view your profile.</p>
      </div>
    )
  }

  const p = profile as Record<string, unknown> | null

  return (
    <div className="profile-edit">
      <div className="app-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem' }}>
          <h2 style={{ margin: 0 }}>Profile</h2>
          {profile?.id_verified_at && <VerifiedBadge />}
        </div>

        {PROFILE_DISPLAY.map((field, i) => (
          <InfoRow
            key={field.key}
            label={field.label}
            value={getProfileValue(p, field.key)}
            locked={field.locked}
            last={i === PROFILE_DISPLAY.length - 1}
          />
        ))}

        <div style={{ margin: '1.5rem 0 1.25rem', borderTop: '2px solid var(--color-border)' }} />

        <div style={{ marginBottom: '1rem' }}>
          <h3 style={{ margin: '0 0 0.25rem', fontSize: '1rem', fontWeight: 600 }}>Your Fika profile</h3>
          <p style={{ color: 'var(--color-textSecondary)', fontSize: '0.85rem', margin: 0 }}>
            Tap Edit to update via text.
          </p>
        </div>

        {SMS_QUESTIONS.map((q, i) => {
          const answer = getSmsAnswer(intake, q.id)
          return (
            <InfoRow
              key={q.id}
              label={q.label}
              value={answer}
              locked={false}
              editHref={smsEditHref(q.id, q.isChoice, answer)}
              last={i === SMS_QUESTIONS.length - 1}
            />
          )
        })}
      </div>
    </div>
  )
}
