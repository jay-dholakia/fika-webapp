'use client'

import { Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import Footer from '../components/Footer'
import { getSupabase } from '@/lib/supabase'

const CONCIERGE_NUMBER = process.env.NEXT_PUBLIC_SENDBLUE_CONCIERGE_NUMBER?.trim() || null

function LoginContent() {
  const searchParams = useSearchParams()
  const noAccount = searchParams.get('no_account') === '1'

  async function handleSignInWithGoogle() {
    const supabase = getSupabase()
    if (!supabase) return
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    const next = searchParams.get('next')?.trim() || '/app/how-it-works'
    const nextPath = next.startsWith('/') ? next : '/app/how-it-works'
    const redirectTo = `${origin}/auth/callback?next=${encodeURIComponent(nextPath)}`
    await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } })
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
            <Link href="#cta" className="nav-cta">Get started</Link>
          </nav>
        </div>
      </header>

      <main className="auth-page auth-page-cta">
        <section id="cta" className="section section-cta section-cta-full">
          <div className="section-inner cta-inner auth-login-inner">
            <div className="auth-login-main">
              <h2 className="cta-title">Login to Fika</h2>
              {noAccount && (
                <p className="cta-message cta-message-error" role="alert" style={{ marginBottom: '1rem' }}>
                  No account found. Text us to get started.
                </p>
              )}
              <button
                type="button"
                className="btn btn-primary btn-block"
                onClick={handleSignInWithGoogle}
              >
                Sign in with Google
              </button>
              {CONCIERGE_NUMBER ? (
                <a
                  href={`sms:${CONCIERGE_NUMBER}?body=${encodeURIComponent('Hi! Help set me up for Fika.')}`}
                  className="btn btn-secondary btn-block"
                  style={{ marginTop: '0.75rem' }}
                >
                  Sign up via text
                </a>
              ) : (
                <p className="auth-switch auth-switch-cta" style={{ marginTop: '1.5rem' }}>
                  Text us to get started.
                </p>
              )}
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="auth-page" style={{ padding: '2rem', textAlign: 'center' }}>
        <p style={{ color: 'var(--color-textSecondary)' }}>Loading…</p>
      </div>
    }>
      <LoginContent />
    </Suspense>
  )
}
