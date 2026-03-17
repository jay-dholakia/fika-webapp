'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { getSupabase } from '@/lib/supabase'
import Footer from '../../components/Footer'

export default function ResetPasswordPage() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const supabase = getSupabase()
    if (!supabase) return
    const check = () => supabase.auth.getSession().then(({ data: { session } }) => setReady(!!session))
    check()
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => check())
    return () => subscription.unsubscribe()
  }, [])

  async function handleSubmit(e: React.FormEvent) {
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
      const { error } = await supabase.auth.updateUser({ password })
      if (error) {
        setMessage({ type: 'error', text: error.message })
        return
      }
      setMessage({ type: 'success', text: 'Password updated. Redirecting…' })
      setTimeout(() => router.replace('/app/weeklyfika'), 1500)
    } catch {
      setMessage({ type: 'error', text: 'Something went wrong. Please try again.' })
    } finally {
      setLoading(false)
    }
  }

  if (!ready) {
    return (
      <>
        <header className="header">
          <div className="header-inner">
            <Link href="/" className="logo">fika</Link>
            <nav className="nav" aria-label="Main"><Link href="/">Home</Link></nav>
          </div>
        </header>
        <main className="auth-page">
          <div className="auth-card">
            <h1 className="auth-title">Reset password</h1>
            <p className="auth-sub">Loading… If you followed a reset link, we’re verifying it.</p>
            <p className="auth-switch"><Link href="/login">Back to sign in</Link></p>
          </div>
        </main>
        <Footer />
      </>
    )
  }

  return (
    <>
      <header className="header">
        <div className="header-inner">
          <Link href="/" className="logo">fika</Link>
          <nav className="nav" aria-label="Main"><Link href="/">Home</Link></nav>
        </div>
      </header>

      <main className="auth-page">
        <div className="auth-card">
          <h1 className="auth-title">Set new password</h1>
          <p className="auth-sub">Enter your new password below.</p>

          <form className="auth-form" onSubmit={handleSubmit}>
            <div className={`auth-field ${password ? 'auth-field-filled' : ''}`}>
              <input
                id="reset-password"
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
              <label className="auth-floating-label" htmlFor="reset-password">
                New password
              </label>
            </div>
            <div className={`auth-field ${confirmPassword ? 'auth-field-filled' : ''}`}>
              <input
                id="reset-confirm"
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
              <label className="auth-floating-label" htmlFor="reset-confirm">
                Confirm password
              </label>
            </div>
            {message && (
              <p className={`auth-message ${message.type === 'error' ? 'auth-message-error' : ''}`} role="alert">
                {message.text}
              </p>
            )}
            <button type="submit" className="btn btn-primary btn-block auth-submit" disabled={loading}>
              {loading ? 'Updating…' : 'Update password'}
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
