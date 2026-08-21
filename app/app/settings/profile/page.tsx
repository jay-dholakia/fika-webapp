'use client'

import { useState, useEffect, useCallback } from 'react'
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

type FreeQuestion = { id: string; label: string; isChoice: false }
type ChoiceQuestion = { id: string; label: string; isChoice: true; isMulti?: boolean; choices: string[]; questionText: string }
type SmsQuestion = FreeQuestion | ChoiceQuestion

const SMS_QUESTIONS: SmsQuestion[] = [
  { id: 'q_neighborhood', label: 'Neighborhood', isChoice: false },
  { id: 'q_relationship_status', label: 'Relationship status', isChoice: false },
  { id: 'q_kids', label: 'Kids', isChoice: false },
  { id: 'q_work', label: 'Work', isChoice: false },
  { id: 'q_interests_freetext', label: 'What you\'re into outside work', isChoice: false },
  { id: 'q_on_mind', label: 'What\'s been on your mind', isChoice: false },
  {
    id: 'q_social_goal',
    label: 'What you want from Fika',
    isChoice: true,
    isMulti: true,
    questionText: 'What are you hoping to get out of Fika?',
    choices: [
      'Someone to think out loud with',
      'A creative collaborator',
      'A coworking buddy',
      'Someone going through a similar life chapter',
      "Fresh perspectives on things I'm wrestling with",
      'Genuine connection outside of work and apps',
      'Someone who sees the world differently',
      'No agenda — just good conversation',
    ],
  },
  {
    id: 'q_fika_time_pref',
    label: 'Fika meeting times',
    isChoice: true,
    questionText: 'What times work best for your Fika meetups?',
    choices: ['Weekday mornings at 10am', 'Weekday evenings at 6pm', 'Both work for me'],
  },
  { id: 'q_market_tenure', label: 'Time in the city', isChoice: false },
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

async function saveChoiceAnswer(
  userId: string,
  questionId: string,
  questionText: string,
  answer: string
): Promise<boolean> {
  const supabase = getSupabase()
  if (!supabase) return false
  const { data } = await supabase
    .from('intake_responses_v5')
    .select('responses')
    .eq('user_id', userId)
    .maybeSingle()
  const responses: IntakeResponseItem[] = Array.isArray(data?.responses) ? [...(data!.responses as IntakeResponseItem[])] : []
  const idx = responses.findIndex((r) => r.question_id === questionId)
  const item: IntakeResponseItem = { question_id: questionId, question_text: questionText, answer, type: 'text', answered_at: new Date().toISOString() }
  if (idx >= 0) responses[idx] = item
  else responses.push(item)
  const { error } = await supabase
    .from('intake_responses_v5')
    .update({ responses, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
  return !error
}

type LockedRowProps = { label: string; value: string | null; last?: boolean }

function LockedRow({ label, value, last }: LockedRowProps) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '0.75rem 0', borderBottom: last ? 'none' : '1px solid var(--color-border)', gap: '1rem' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', marginBottom: '0.2rem' }}>
          <span style={{ fontSize: '0.78rem', color: 'var(--color-textSecondary)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>{label}</span>
          <LockIcon />
        </div>
        <div style={{ fontSize: '0.95rem', wordBreak: 'break-word' }}>
          {value ?? <span style={{ color: 'var(--color-textSecondary)' }}>—</span>}
        </div>
      </div>
    </div>
  )
}

type FreeRowProps = { label: string; value: string | null; questionId: string; last?: boolean }

function FreeRow({ label, value, questionId, last }: FreeRowProps) {
  const href = `sms:${CONCIERGE}?body=${encodeURIComponent(`[edit:${questionId}] ${value ?? ''}`)}`
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '0.75rem 0', borderBottom: last ? 'none' : '1px solid var(--color-border)', gap: '1rem' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ marginBottom: '0.2rem' }}>
          <span style={{ fontSize: '0.78rem', color: 'var(--color-textSecondary)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>{label}</span>
        </div>
        <div style={{ fontSize: '0.95rem', wordBreak: 'break-word' }}>
          {value ?? <span style={{ color: 'var(--color-textSecondary)' }}>—</span>}
        </div>
      </div>
      <a href={href} style={{ fontSize: '0.8rem', color: 'var(--color-primary)', flexShrink: 0, textDecoration: 'none', padding: '0.25rem 0.6rem', border: '1px solid var(--color-primary)', borderRadius: '6px', whiteSpace: 'nowrap', marginTop: '0.1rem' }}>
        Edit
      </a>
    </div>
  )
}

type ChoiceRowProps = {
  label: string
  value: string | null
  question: ChoiceQuestion
  userId: string
  onSaved: (questionId: string, answer: string) => void
  last?: boolean
}

function ChoiceRow({ label, value, question, userId, onSaved, last }: ChoiceRowProps) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const currentValues = value ? value.split(', ').map(s => s.trim()).filter(Boolean) : []
  const [selected, setSelected] = useState<string[]>(currentValues)

  function openEdit() {
    setSelected(currentValues)
    setEditing(true)
  }

  function toggle(choice: string) {
    if (!question.isMulti) {
      setSelected([choice])
      return
    }
    setSelected(prev => prev.includes(choice) ? prev.filter(c => c !== choice) : [...prev, choice])
  }

  async function save() {
    if (selected.length === 0) return
    const answer = selected.join(', ')
    setSaving(true)
    const ok = await saveChoiceAnswer(userId, question.id, question.questionText, answer)
    setSaving(false)
    if (ok) {
      onSaved(question.id, answer)
      setEditing(false)
    }
  }

  const isSingle = !question.isMulti

  return (
    <div style={{ padding: '0.75rem 0', borderBottom: last ? 'none' : '1px solid var(--color-border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ marginBottom: '0.2rem' }}>
            <span style={{ fontSize: '0.78rem', color: 'var(--color-textSecondary)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>{label}</span>
          </div>
          {!editing && (
            <div style={{ fontSize: '0.95rem', wordBreak: 'break-word' }}>
              {value ?? <span style={{ color: 'var(--color-textSecondary)' }}>—</span>}
            </div>
          )}
        </div>
        {!editing && (
          <button
            onClick={openEdit}
            style={{ fontSize: '0.8rem', color: 'var(--color-primary)', flexShrink: 0, background: 'none', cursor: 'pointer', padding: '0.25rem 0.6rem', border: '1px solid var(--color-primary)', borderRadius: '6px', whiteSpace: 'nowrap', marginTop: '0.1rem' }}
          >
            Edit
          </button>
        )}
      </div>
      {editing && (
        <div style={{ marginTop: '0.6rem' }}>
          {question.isMulti && (
            <p style={{ fontSize: '0.8rem', color: 'var(--color-textSecondary)', margin: '0 0 0.5rem' }}>Select all that apply</p>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            {question.choices.map((choice) => {
              const isOn = selected.includes(choice)
              return (
                <button
                  key={choice}
                  onClick={() => { toggle(choice); if (isSingle) save() }}
                  disabled={saving}
                  style={{
                    fontSize: '0.88rem',
                    padding: '0.4rem 0.85rem',
                    borderRadius: '20px',
                    border: isOn ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                    background: isOn ? 'var(--color-primary)' : 'var(--color-surface)',
                    color: isOn ? '#fff' : 'var(--color-text)',
                    cursor: saving ? 'default' : 'pointer',
                    fontWeight: isOn ? 600 : 400,
                    opacity: saving ? 0.6 : 1,
                    transition: 'opacity 0.15s',
                  }}
                >
                  {choice}
                </button>
              )
            })}
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.7rem', alignItems: 'center' }}>
            {question.isMulti && (
              <button
                onClick={save}
                disabled={saving || selected.length === 0}
                style={{ fontSize: '0.85rem', fontWeight: 600, color: '#fff', background: 'var(--color-primary)', border: 'none', borderRadius: '8px', padding: '0.4rem 1rem', cursor: saving || selected.length === 0 ? 'default' : 'pointer', opacity: selected.length === 0 ? 0.5 : 1 }}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            )}
            <button
              onClick={() => setEditing(false)}
              style={{ fontSize: '0.8rem', color: 'var(--color-textSecondary)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function SettingsProfilePage() {
  const [userId, setUserId] = useState<string | null>(null)
  const { loading: statusLoading, profile, intake } = useOnboardingStatus(userId ?? undefined)
  const [localAnswers, setLocalAnswers] = useState<Record<string, string>>({})

  useEffect(() => {
    getSupabase()?.auth.getSession().then(({ data: { session } }) => {
      setUserId(session?.user?.id ?? null)
    })
  }, [])

  const handleSaved = useCallback((questionId: string, answer: string) => {
    setLocalAnswers((prev) => ({ ...prev, [questionId]: answer }))
  }, [])

  if (statusLoading) {
    return <div className="app-card"><p>Loading your profile…</p></div>
  }

  if (!userId) {
    return <div className="app-card"><p>Please log in to view your profile.</p></div>
  }

  const p = profile as Record<string, unknown> | null

  function getAnswer(q: SmsQuestion): string | null {
    return localAnswers[q.id] ?? getSmsAnswer(intake, q.id)
  }

  return (
    <div className="profile-edit">
      <div className="app-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem' }}>
          <h2 style={{ margin: 0 }}>Profile</h2>
          {profile?.id_verified_at && <VerifiedBadge />}
        </div>

        {PROFILE_DISPLAY.map((field, i) => (
          <LockedRow
            key={field.key}
            label={field.label}
            value={getProfileValue(p, field.key)}
            last={i === PROFILE_DISPLAY.length - 1}
          />
        ))}

        <div style={{ margin: '1.5rem 0 1.25rem', borderTop: '2px solid var(--color-border)' }} />

        <div style={{ marginBottom: '1rem' }}>
          <h3 style={{ margin: '0 0 0.25rem', fontSize: '1rem', fontWeight: 600 }}>Your Fika profile</h3>
          <p style={{ color: 'var(--color-textSecondary)', fontSize: '0.85rem', margin: 0 }}>
            Tap Edit to update.
          </p>
        </div>

        {SMS_QUESTIONS.map((q, i) => {
          const isLast = i === SMS_QUESTIONS.length - 1
          if (q.isChoice) {
            return (
              <ChoiceRow
                key={q.id}
                label={q.label}
                value={getAnswer(q)}
                question={q}
                userId={userId}
                onSaved={handleSaved}
                last={isLast}
              />
            )
          }
          return (
            <FreeRow
              key={q.id}
              label={q.label}
              value={getAnswer(q)}
              questionId={q.id}
              last={isLast}
            />
          )
        })}
      </div>
    </div>
  )
}
