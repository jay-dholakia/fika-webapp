'use client'

import { Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import Footer from '../components/Footer'
import CtaWithLocation from '../components/CtaWithLocation'
import { getSupabase } from '@/lib/supabase'

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
          <div className="section-inner cta-inner">
            <h2 className="cta-title">Get started with Fika</h2>
            <p className="cta-sub">
              Have an account? Sign in with Google. Otherwise join the waitlist and we&apos;ll be in touch.
            </p>
            {noAccount && (
              <p className="cta-message cta-message-error" role="alert" style={{ marginBottom: '1rem' }}>
                No account found for that sign-in. Join the waitlist below and we&apos;ll notify you when Fika is ready for you.
              </p>
            )}
            <button
              type="button"
              className="btn btn-primary btn-block"
              onClick={handleSignInWithGoogle}
            >
              Sign in with Google
            </button>
            <p className="cta-waitlist-hint" style={{ marginTop: '1.5rem', marginBottom: '0.5rem' }}>
              New to Fika? Join the waitlist
            </p>
            <CtaWithLocation />
            <p className="auth-switch auth-switch-cta" style={{ marginTop: '1.5rem' }}>
              <Link href="/">Back to home</Link>
            </p>
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
