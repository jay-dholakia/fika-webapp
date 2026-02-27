'use client'

import { useState } from 'react'
import Link from 'next/link'
import { getSupabase } from '@/lib/supabase'

export default function SettingsFeedbackPage() {
  const [notes, setNotes] = useState('')
  const [contactOk, setContactOk] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const trimmed = notes.trim()
    if (!trimmed) {
      setError('Please enter your feedback.')
      return
    }
    const supabase = getSupabase()
    if (!supabase) {
      setError('App is not configured.')
      return
    }
    setSubmitting(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        setError('Please log in again.')
        return
      }
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ notes: trimmed, contact_ok: contactOk }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError((data as { error?: string }).error ?? 'Something went wrong.')
        return
      }
      setSubmitted(true)
      setNotes('')
      setContactOk(false)
    } catch {
      setError('Something went wrong.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="app-card">
      <h2>Feedback</h2>
      <p style={{ color: 'var(--color-textSecondary)', fontSize: '0.95rem', marginBottom: '1.5rem' }}>
        Share your feedback or questions. We read everything.
      </p>
      {submitted ? (
        <p className="app-feedback-bubble-success">Thanks! We got your feedback.</p>
      ) : (
        <form onSubmit={handleSubmit} className="app-feedback-bubble-form app-feedback-page-form">
          <textarea
            className="app-feedback-bubble-textarea"
            placeholder="Your feedback or questions…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={submitting}
            rows={4}
          />
          <label className="app-feedback-bubble-check">
            <input
              type="checkbox"
              checked={contactOk}
              onChange={(e) => setContactOk(e.target.checked)}
              disabled={submitting}
            />
            <span>Can we follow up with you?</span>
          </label>
          {error && <p className="app-feedback-bubble-error" role="alert">{error}</p>}
          <button type="submit" className="btn btn-primary app-feedback-bubble-submit" disabled={submitting}>
            {submitting ? 'Sending…' : 'Submit'}
          </button>
        </form>
      )}
      <p style={{ marginTop: '1rem' }}>
        <Link href="/app/settings/profile" className="app-settings-back">← Back to settings</Link>
      </p>
    </div>
  )
}
