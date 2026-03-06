'use client'

import { useState } from 'react'
import { getSupabase } from '@/lib/supabase'

export default function CtaWithLocation() {
  const [email, setEmail] = useState('')
  const [zipCode, setZipCode] = useState('')
  const [emailConsent, setEmailConsent] = useState(false)
  const [waitlistStatus, setWaitlistStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [waitlistMessage, setWaitlistMessage] = useState('')

  async function handleWaitlistSubmit(e: React.FormEvent) {
    e.preventDefault()
    setWaitlistMessage('')
    const emailTrim = email.trim().toLowerCase()
    if (!emailTrim) {
      setWaitlistStatus('error')
      setWaitlistMessage('Enter your email address.')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrim)) {
      setWaitlistStatus('error')
      setWaitlistMessage('Enter a valid email address.')
      return
    }
    if (!emailConsent) {
      setWaitlistStatus('error')
      setWaitlistMessage('Please agree to receive email from us.')
      return
    }
    const zipTrim = zipCode.trim()
    if (!zipTrim) {
      setWaitlistStatus('error')
      setWaitlistMessage('Enter your zip code.')
      return
    }
    const zipNormalized = zipTrim.replace(/\D/g, '')
    if (zipNormalized.length !== 5 && zipNormalized.length !== 9) {
      setWaitlistStatus('error')
      setWaitlistMessage('Enter a valid US zip code (5 or 9 digits).')
      return
    }
    const supabase = getSupabase()
    if (!supabase) {
      setWaitlistStatus('error')
      setWaitlistMessage('Unable to submit. Please try again.')
      return
    }
    setWaitlistStatus('loading')
    const { error } = await supabase.from('waitlist').insert({
      email: emailTrim,
      zip_code: zipNormalized,
      marketing_consent_at: new Date().toISOString(),
    })
    if (error) {
      setWaitlistStatus('error')
      setWaitlistMessage(error.code === '23505' ? 'This email is already on the list.' : 'Something went wrong. Please try again.')
      return
    }
    setWaitlistStatus('success')
    setWaitlistMessage("You're on the list. We'll be in touch.")
    setEmail('')
    setZipCode('')
    setEmailConsent(false)
  }

  if (waitlistStatus === 'success') {
    return (
      <p className="cta-success" role="status">
        {waitlistMessage}
      </p>
    )
  }

  return (
    <form className="cta-form" onSubmit={handleWaitlistSubmit}>
      <label htmlFor="cta-waitlist-email" className="cta-waitlist-hint">
        Email
      </label>
      <div className="cta-form-row cta-form-row-single">
        <input
          id="cta-waitlist-email"
          name="email"
          type="email"
          placeholder="you@example.com"
          className="cta-input"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={waitlistStatus === 'loading'}
          autoComplete="email"
          required
        />
      </div>
      <label htmlFor="cta-waitlist-zip" className="cta-waitlist-hint">
        Zip code
      </label>
      <div className="cta-form-row cta-form-row-single">
        <input
          id="cta-waitlist-zip"
          name="zip_code"
          type="text"
          inputMode="numeric"
          placeholder="90210"
          className="cta-input"
          value={zipCode}
          onChange={(e) => setZipCode(e.target.value.replace(/\D/g, '').slice(0, 10))}
          disabled={waitlistStatus === 'loading'}
          autoComplete="postal-code"
          maxLength={10}
          required
        />
      </div>
      <label className="cta-consent">
        <input
          type="checkbox"
          checked={emailConsent}
          onChange={(e) => setEmailConsent(e.target.checked)}
          disabled={waitlistStatus === 'loading'}
          aria-describedby="cta-consent-email-text"
        />
        <span id="cta-consent-email-text" className="cta-consent-text">
          I agree to receive email from Fika when we launch. Unsubscribe anytime.
        </span>
      </label>
      {waitlistMessage && (
        <p className={`cta-message ${waitlistStatus === 'error' ? 'cta-message-error' : ''}`} role="alert">
          {waitlistMessage}
        </p>
      )}
      <button
        type="submit"
        className="btn btn-primary btn-block"
        disabled={waitlistStatus === 'loading' || !email.trim() || !zipCode.trim() || !emailConsent}
      >
        {waitlistStatus === 'loading' ? 'Adding…' : 'Notify me'}
      </button>
    </form>
  )
}
