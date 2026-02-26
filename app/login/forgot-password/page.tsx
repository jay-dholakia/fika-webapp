'use client'

import { useState } from 'react'
import Link from 'next/link'
import { getSupabase } from '@/lib/supabase'
import Footer from '../../components/Footer'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)

  async function handleSubmit(e: React.FormEvent) {
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
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${typeof window !== 'undefined' ? window.location.origin : ''}/login/reset-password`,
      })
      if (error) {
        setMessage({ type: 'error', text: error.message })
        return
      }
      setMessage({ type: 'success', text: 'If an account exists for that email, we’ve sent a reset link. Check your inbox and spam folder.' })
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
          <h1 className="auth-title">Forgot password?</h1>
          <p className="auth-sub">Enter your email and we’ll send you a link to reset your password.</p>

          <form className="auth-form" onSubmit={handleSubmit}>
            <div className={`auth-field ${email ? 'auth-field-filled' : ''}`}>
              <input
                id="forgot-email"
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
              <label className="auth-floating-label" htmlFor="forgot-email">
                Email
              </label>
            </div>
            {message && (
              <p className={`auth-message ${message.type === 'error' ? 'auth-message-error' : ''}`} role="alert">
                {message.text}
              </p>
            )}
            <button type="submit" className="btn btn-primary btn-block auth-submit" disabled={loading}>
              {loading ? 'Sending…' : 'Send reset link'}
            </button>
          </form>

          <p className="auth-switch">
            <Link href="/login">Back to sign in</Link>
          </p>
        </div>
      </main>

      <Footer />
    </>
  )
}
