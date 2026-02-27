'use client'

import { useState, useRef, useEffect } from 'react'
import { getSupabase } from '@/lib/supabase'

type Props = {
  isOpen: boolean
  onClose: () => void
}

export function FeedbackBubble({ isOpen, onClose }: Props) {
  const [notes, setNotes] = useState('')
  const [contactOk, setContactOk] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (isOpen) {
      setNotes('')
      setContactOk(false)
      setSubmitted(false)
      setError(null)
      setTimeout(() => textareaRef.current?.focus(), 100)
    }
  }, [isOpen])

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
      setTimeout(() => {
        onClose()
        setSubmitted(false)
      }, 1500)
    } catch {
      setError('Something went wrong.')
    } finally {
      setSubmitting(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="app-feedback-bubble-wrap" role="dialog" aria-label="Send feedback">
      <div className="app-feedback-bubble">
        <div className="app-feedback-bubble-header">
          <h3 className="app-feedback-bubble-title">Feedback</h3>
          <button
            type="button"
            className="app-feedback-bubble-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        {submitted ? (
          <p className="app-feedback-bubble-success">Thanks! We got your feedback.</p>
        ) : (
          <form onSubmit={handleSubmit} className="app-feedback-bubble-form">
            <textarea
              ref={textareaRef}
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
      </div>
    </div>
  )
}
