'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { getSupabase } from '@/lib/supabase'
import { authLog } from '@/lib/auth-log'
import Footer from '../components/Footer'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setMessage(null)
    authLog('login:submit', { email: email ? `${email.slice(0, 3)}…` : '' })
    const supabase = getSupabase()
    if (!supabase) {
      authLog('login:error', 'no supabase client')
      setMessage({ type: 'error', text: 'App is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local (see .env.example).' })
      return
    }
    setLoading(true)
    setMessage(null)
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        authLog('login:error', { message: error.message })
        setMessage({ type: 'error', text: error.message })
        return
      }
      authLog('login:success', { hasSession: !!data.session, userId: data.user?.id?.slice(0, 8) })
      // Ensure session is in storage before navigating so /app layout sees it
      if (data.session) {
        await new Promise((r) => setTimeout(r, 100))
      }
      authLog('login:redirect', { to: '/app' })
      // Go to app; layout will redirect to onboarding if not complete, or show dashboard
      router.replace('/app')
      router.refresh()
    } catch (err) {
      authLog('login:throw', { err: String(err) })
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
          <h1 className="auth-title">Welcome back</h1>
          <p className="auth-sub">Sign in to your Fika account.</p>

          <form className="auth-form" onSubmit={handleSubmit}>
            <label className="auth-label" htmlFor="login-email">
              Email
            </label>
            <input
              id="login-email"
              name="email"
              type="email"
              className="auth-input"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={loading}
              autoComplete="email"
            />
            <label className="auth-label" htmlFor="login-password">
              Password
            </label>
            <input
              id="login-password"
              name="password"
              type="password"
              className="auth-input"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={loading}
              autoComplete="current-password"
            />
            {message && (
              <div role="alert">
                <p className={`auth-message ${message.type === 'error' ? 'auth-message-error' : ''}`}>
                  {message.text}
                </p>
                {message.type === 'error' && (
                  <p className="auth-message-hint">
                    If sign-in keeps failing, check that email sign-in is enabled in Supabase (Auth → Providers) and that your email is confirmed.
                  </p>
                )}
              </div>
            )}
            <button type="submit" className="btn btn-primary btn-block auth-submit" disabled={loading}>
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <p className="auth-switch">
            Don’t have an account? <Link href="/signup">Sign up</Link>
          </p>
        </div>
      </main>

      <Footer />
    </>
  )
}
