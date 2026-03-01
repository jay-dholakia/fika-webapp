'use client'

import { useState } from 'react'
import Link from 'next/link'
import { getSupabase } from '@/lib/supabase'
import { authLog } from '@/lib/auth-log'
import Footer from '../components/Footer'
import CtaWithLocation from '../components/CtaWithLocation'
import { GoogleIcon } from '../app/components/GoogleIcon'

export default function LoginPage() {
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)
  const [showCtaSection, setShowCtaSection] = useState(false)

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
        authLog('login:googleError', { message: error.message })
        setMessage({ type: 'error', text: error.message })
        return
      }
      if (data?.url) {
        authLog('login:googleRedirect', { url: data.url })
        window.location.href = data.url
      }
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
                aria-label="Sign in with Google"
              >
                <GoogleIcon className="auth-google-icon" />
                {loading ? 'Signing in…' : 'Continue with Google'}
              </button>
            </div>

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
