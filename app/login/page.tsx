'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { getSupabase } from '@/lib/supabase'
import { authLog } from '@/lib/auth-log'
import { toE164, isValidPhone } from '@/lib/phone'
import Footer from '../components/Footer'
import CtaWithLocation from '../components/CtaWithLocation'

type AuthMethod = 'phone' | 'email'

export default function LoginPage() {
  const router = useRouter()
  const [method, setMethod] = useState<AuthMethod>('email')
  const [phone, setPhone] = useState('')
  const [step, setStep] = useState<'phone' | 'code'>('phone')
  const [otp, setOtp] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)
  const [showCtaSection, setShowCtaSection] = useState(false)

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
      authLog('login:sendOtp', { phone: phoneE164 ? `${phoneE164.slice(0, 4)}…` : '' })
      const { error } = await supabase.auth.signInWithOtp({ phone: phoneE164 })
      if (error) {
        authLog('login:otpError', { message: error.message })
        setMessage({ type: 'error', text: error.message })
        return
      }
      setStep('code')
      setMessage({ type: 'success', text: 'Check your phone for the code.' })
    } catch (err) {
      authLog('login:throw', { err: String(err) })
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
        authLog('login:verifyError', { message: error.message })
        setMessage({ type: 'error', text: error.message })
        return
      }
      authLog('login:success', { hasSession: !!data.session, userId: data.user?.id?.slice(0, 8) })
      if (data.session) {
        await new Promise((r) => setTimeout(r, 100))
      }
      authLog('login:redirect', { to: '/app' })
      router.replace('/app')
      router.refresh()
    } catch (err) {
      authLog('login:throw', { err: String(err) })
      setMessage({ type: 'error', text: 'Something went wrong. Please try again.' })
    } finally {
      setLoading(false)
    }
  }

  async function handleEmailSubmit(e: React.FormEvent) {
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
      const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      if (error) {
        setMessage({ type: 'error', text: error.message })
        return
      }
      if (data.session) {
        await new Promise((r) => setTimeout(r, 100))
      }
      router.replace('/app')
      router.refresh()
    } catch {
      setMessage({ type: 'error', text: 'Something went wrong. Please try again.' })
    } finally {
      setLoading(false)
    }
  }

  async function handleGoogleSignIn() {
    const supabase = getSupabase()
    if (!supabase) {
      setMessage({ type: 'error', text: 'App is not configured.' })
      return
    }
    setMessage(null)
    setLoading(true)
    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: typeof window !== 'undefined' ? `${window.location.origin}/app` : undefined },
      })
      if (error) {
        setMessage({ type: 'error', text: error.message })
        return
      }
      if (data?.url) window.location.href = data.url
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

      <main className={showCtaSection ? 'auth-page auth-page-cta' : 'auth-page'}>
        {showCtaSection ? (
          <section id="cta" className="section section-cta section-cta-full">
            <div className="section-inner cta-inner">
              <h2 className="cta-title">Ready for a real Fika?</h2>
              <p className="cta-sub">Enter your location to see if we&apos;re in your city—or join the waitlist and we&apos;ll let you know when Fika comes to you.</p>
              <CtaWithLocation redirectToSignupWhenInLA />
              <p className="auth-switch auth-switch-cta">
                Already have an account?{' '}
                <button
                  type="button"
                  className="auth-switch-link"
                  onClick={() => setShowCtaSection(false)}
                >
                  Log in
                </button>
              </p>
            </div>
          </section>
        ) : (
          <div className="auth-card">
            <h1 className="auth-title">Welcome back</h1>
            <p className="auth-sub">Sign in to your Fika account.</p>

            <div className="auth-method-tabs" role="tablist" aria-label="Sign in method">
              <button
                type="button"
                role="tab"
                aria-selected={method === 'email'}
                className={`auth-method-tab ${method === 'email' ? 'active' : ''}`}
                onClick={() => { setMethod('email'); setMessage(null); }}
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
                    id="login-email"
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
                  <label className="auth-floating-label" htmlFor="login-email">
                    Email
                  </label>
                </div>
                <div className={`auth-field ${password ? 'auth-field-filled' : ''}`}>
                  <input
                    id="login-password"
                    name="password"
                    type="password"
                    className="auth-input"
                    placeholder=" "
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    disabled={loading}
                    autoComplete="current-password"
                  />
                  <label className="auth-floating-label" htmlFor="login-password">
                    Password
                  </label>
                </div>
                {message && (
                  <p className={`auth-message ${message.type === 'error' ? 'auth-message-error' : ''}`} role="alert">
                    {message.text}
                  </p>
                )}
                <button type="submit" className="btn btn-primary btn-block auth-submit" disabled={loading}>
                  {loading ? 'Signing in…' : 'Sign in'}
                </button>
                <p className="auth-forgot">
                  <Link href="/login/forgot-password">Forgot password?</Link>
                </p>
                <div className="auth-divider" aria-hidden>or</div>
                <button
                  type="button"
                  className="btn btn-secondary btn-block auth-submit auth-google-btn"
                  onClick={handleGoogleSignIn}
                  disabled={loading}
                >
                  Continue with Google
                </button>
              </form>
            )}

            {method === 'phone' && step === 'phone' && (
              <>
                <p className="auth-coming-soon">Coming soon</p>
                <p className="auth-sub" style={{ marginTop: 0 }}>Sign in with phone will be available soon. Use Email for now.</p>
              </>
            )}

            {method === 'phone' && step === 'code' && (
              <form className="auth-form" onSubmit={handleVerifyOtp}>
                <p className="auth-phone-sent" aria-live="polite">
                  Code sent to {phoneE164 || phone}.
                </p>
                <div className={`auth-field ${otp ? 'auth-field-filled' : ''}`}>
                  <input
                    id="login-otp"
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
                  <label className="auth-floating-label" htmlFor="login-otp">
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
              Don&apos;t have an account?{' '}
              <button
                type="button"
                className="auth-switch-link"
                onClick={() => setShowCtaSection(true)}
              >
                Sign up
              </button>
            </p>
          </div>
        )}
      </main>

      <Footer />
    </>
  )
}
