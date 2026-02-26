'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { getSupabase } from '@/lib/supabase'
import { toE164, isValidPhone } from '@/lib/phone'
import Footer from '../components/Footer'

type AuthMethod = 'phone' | 'email'

export default function SignupPage() {
  const router = useRouter()
  const [method, setMethod] = useState<AuthMethod>('email')
  const [phone, setPhone] = useState('')
  const [step, setStep] = useState<'phone' | 'code'>('phone')
  const [otp, setOtp] = useState('')
  const [smsConsent, setSmsConsent] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)

  const phoneE164 = toE164(phone)

  async function handleSendCode(e: React.FormEvent) {
    e.preventDefault()
    setMessage(null)
    if (!isValidPhone(phone)) {
      setMessage({ type: 'error', text: 'Enter a valid phone number (at least 10 digits).' })
      return
    }
    const supabase = getSupabase()
    if (!supabase) {
      setMessage({ type: 'error', text: 'App is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local (see .env.example).' })
      return
    }
    setLoading(true)
    setMessage(null)
    try {
      const { error } = await supabase.auth.signInWithOtp({ phone: phoneE164 })
      if (error) {
        setMessage({ type: 'error', text: error.message })
        return
      }
      setStep('code')
      setMessage({ type: 'success', text: 'Check your phone for the code.' })
    } catch {
      setMessage({ type: 'error', text: 'Something went wrong. Please try again.' })
    } finally {
      setLoading(false)
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault()
    setMessage(null)
    const supabase = getSupabase()
    if (!supabase) {
      setMessage({ type: 'error', text: 'App is not configured.' })
      return
    }
    setLoading(true)
    setMessage(null)
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        phone: phoneE164,
        token: otp.trim(),
        type: 'sms',
      })
      if (error) {
        setMessage({ type: 'error', text: error.message })
        return
      }
      if (data.session) {
        await new Promise((r) => setTimeout(r, 100))
      }
      await supabase.from('profiles').upsert(
        { id: data.user!.id, first_name: ' ', sms_consent_at: new Date().toISOString() },
        { onConflict: 'id' }
      )
      router.replace('/app')
      router.refresh()
    } catch {
      setMessage({ type: 'error', text: 'Something went wrong. Please try again.' })
    } finally {
      setLoading(false)
    }
  }

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault()
    setMessage(null)
    if (password !== confirmPassword) {
      setMessage({ type: 'error', text: 'Passwords do not match.' })
      return
    }
    if (password.length < 6) {
      setMessage({ type: 'error', text: 'Password must be at least 6 characters.' })
      return
    }
    const supabase = getSupabase()
    if (!supabase) {
      setMessage({ type: 'error', text: 'App is not configured.' })
      return
    }
    setLoading(true)
    setMessage(null)
    try {
      const { data, error } = await supabase.auth.signUp({ email: email.trim(), password })
      if (error) {
        setMessage({ type: 'error', text: error.message })
        return
      }
      if (data.session) {
        await new Promise((r) => setTimeout(r, 100))
      }
      if (data.user) {
        await supabase.from('profiles').upsert(
          { id: data.user.id, first_name: ' ' },
          { onConflict: 'id' }
        )
      }
      router.replace('/app')
      router.refresh()
    } catch {
      setMessage({ type: 'error', text: 'Something went wrong. Please try again.' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <header className="header">
        <div className="header-inner">
          <Link href="/" className="logo">
            fika
          </Link>
          <nav className="nav" aria-label="Main">
            <Link href="/">Home</Link>
          </nav>
        </div>
      </header>

      <main className="auth-page">
        <div className="auth-card">
          <h1 className="auth-title">Create your account</h1>
          <p className="auth-sub">Join Fika and start meeting people for real conversation.</p>

          <div className="auth-method-tabs" role="tablist" aria-label="Sign up method">
            <button
              type="button"
              role="tab"
              aria-selected={method === 'email'}
              className={`auth-method-tab ${method === 'email' ? 'active' : ''}`}
              onClick={() => { setMessage(null); }}
            >
              Email
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={method === 'phone'}
              className={`auth-method-tab ${method === 'phone' ? 'active' : ''}`}
              onClick={() => { setMethod('phone'); setStep('phone'); setOtp(''); setMessage(null); }}
            >
              Phone
            </button>
          </div>

          {method === 'email' && (
            <form className="auth-form" onSubmit={handleEmailSubmit}>
              <div className={`auth-field ${email ? 'auth-field-filled' : ''}`}>
                <input
                  id="signup-email"
                  name="email"
                  type="email"
                  className="auth-input"
                  placeholder=" "
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={loading}
                  autoComplete="email"
                />
                <label className="auth-floating-label" htmlFor="signup-email">
                  Email
                </label>
              </div>
              <div className={`auth-field ${password ? 'auth-field-filled' : ''}`}>
                <input
                  id="signup-password"
                  name="password"
                  type="password"
                  className="auth-input"
                  placeholder=" "
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={loading}
                  autoComplete="new-password"
                  minLength={6}
                />
                <label className="auth-floating-label" htmlFor="signup-password">
                  Password
                </label>
              </div>
              <div className={`auth-field ${confirmPassword ? 'auth-field-filled' : ''}`}>
                <input
                  id="signup-confirm"
                  name="confirmPassword"
                  type="password"
                  className="auth-input"
                  placeholder=" "
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  disabled={loading}
                  autoComplete="new-password"
                  minLength={6}
                />
                <label className="auth-floating-label" htmlFor="signup-confirm">
                  Confirm password
                </label>
              </div>
              {message && (
                <p className={`auth-message ${message.type === 'error' ? 'auth-message-error' : ''}`} role="alert">
                  {message.text}
                </p>
              )}
              <button type="submit" className="btn btn-primary btn-block auth-submit" disabled={loading}>
                {loading ? 'Creating account…' : 'Create account'}
              </button>
            </form>
          )}

          {method === 'phone' && step === 'phone' && (
            <>
              <p className="auth-coming-soon">Coming soon</p>
              <p className="auth-sub" style={{ marginTop: 0 }}>Sign up with phone will be available soon. Use Email for now.</p>
            </>
          )}

          {method === 'phone' && step === 'code' && (
            <form className="auth-form" onSubmit={handleVerifyOtp}>
              <p className="auth-phone-sent" aria-live="polite">
                Code sent to {phoneE164 || phone}.
              </p>
              <div className={`auth-field ${otp ? 'auth-field-filled' : ''}`}>
                <input
                  id="signup-otp"
                  name="otp"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  className="auth-input"
                  placeholder=" "
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                  required
                  disabled={loading}
                />
                <label className="auth-floating-label" htmlFor="signup-otp">
                  Verification code
                </label>
              </div>
              {message && (
                <p className={`auth-message ${message.type === 'error' ? 'auth-message-error' : ''}`} role="alert">
                  {message.text}
                </p>
              )}
              <button type="submit" className="btn btn-primary btn-block auth-submit" disabled={loading}>
                {loading ? 'Verifying…' : 'Verify'}
              </button>
              <button
                type="button"
                className="auth-back-link"
                onClick={() => { setStep('phone'); setOtp(''); setMessage(null); }}
                disabled={loading}
              >
                Use a different number
              </button>
            </form>
          )}

          <p className="auth-switch">
            Already have an account? <Link href="/login">Log in</Link>
          </p>
        </div>
      </main>

      <Footer />
    </>
  )
}
