'use client'

import { useState } from 'react'
import Link from 'next/link'
import { getSupabase } from '@/lib/supabase'
import Footer from '../components/Footer'
import { GoogleIcon } from '../app/components/GoogleIcon'

export default function SignupPage() {
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)

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

      <main className="auth-page">
        <div className="auth-card">
          <h1 className="auth-title">Create your account</h1>
          <p className="auth-sub">Join Fika and start meeting people for real conversation.</p>

          <div className="auth-form">
            {message && (
              <p className={`auth-message ${message.type === 'error' ? 'auth-message-error' : ''}`} role="alert">
                {message.text}
              </p>
            )}
            <button
              type="button"
              className="btn btn-google auth-submit"
              onClick={handleGoogleSignIn}
              disabled={loading}
              aria-label="Sign up with Google"
            >
              <GoogleIcon className="auth-google-icon" />
              {loading ? 'Signing up…' : 'Continue with Google'}
            </button>
          </div>

          <p className="auth-switch">
            Already have an account? <Link href="/login">Log in</Link>
          </p>
        </div>
      </main>

      <Footer />
    </>
  )
}
