'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import Footer from '../components/Footer'
import { getSupabase } from '@/lib/supabase'

const CONCIERGE_NUMBER = process.env.NEXT_PUBLIC_SENDBLUE_CONCIERGE_NUMBER?.trim() || null

function LoginContent() {
  const searchParams = useSearchParams()
  const noAccount = searchParams.get('no_account') === '1'
  const next = searchParams.get('next')?.trim() || '/app'
  const nextPath = next.startsWith('/') ? next : '/app'

  const [phone, setPhone] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [phoneLast4, setPhoneLast4] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function handleSendLink() {
    if (!phone.trim()) { setError('Enter your phone number.'); return }
    setSending(true)
    setError(null)
    try {
      const res = await fetch('/api/send-phone-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone.trim(), next: nextPath }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Failed to send link.')
      setPhoneLast4((data as { phoneLast4?: string }).phoneLast4 ?? phone.slice(-4))
      setSent(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send link.')
    } finally {
      setSending(false)
    }
  }

  async function handleSignInWithGoogle() {
    const supabase = getSupabase()
    if (!supabase) return
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
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
            <Link href="/#cta" className="nav-cta">Get started</Link>
          </nav>
        </div>
      </header>

      <main className="auth-page">
        <section className="auth-card">
          <h2 className="auth-title">Sign in to Fika</h2>

          {noAccount && (
            <p className="cta-message cta-message-error" role="alert" style={{ marginBottom: '1rem' }}>
              No account found. Text us to get started.
            </p>
          )}

          {sent ? (
            <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <p style={{ fontSize: '2rem', margin: 0 }}>📱</p>
              <p style={{ margin: 0, lineHeight: 1.5, color: 'var(--color-text)' }}>
                We sent a sign-in link to the number ending in <strong>…{phoneLast4}</strong>.
              </p>
              <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-textSecondary)', lineHeight: 1.5 }}>
                Tap the link in your texts to sign in. It expires in 1 hour.
              </p>
              <button
                type="button"
                className="btn btn-secondary btn-block"
                onClick={() => { setSent(false); setError(null) }}
                style={{ marginTop: '0.5rem' }}
              >
                Use a different number
              </button>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <label htmlFor="login-phone" style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--color-text)' }}>
                  Phone number
                </label>
                <input
                  id="login-phone"
                  className="auth-input"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="(555) 555-5555"
                  value={phone}
                  onChange={(e) => { setPhone(e.target.value); setError(null) }}
                  onKeyDown={(e) => e.key === 'Enter' && !sending && handleSendLink()}
                  disabled={sending}
                  autoFocus
                />
              </div>

              {error && (
                <p style={{ color: 'var(--color-error)', fontSize: '0.875rem', margin: 0 }} role="alert">
                  {error}
                </p>
              )}

              <button
                type="button"
                className="btn btn-primary btn-block"
                onClick={handleSendLink}
                disabled={sending || !phone.trim()}
              >
                {sending ? (
                  <><span className="spinner" aria-hidden /> Sending…</>
                ) : 'Send sign-in link'}
              </button>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', color: 'var(--color-textSecondary)', fontSize: '0.8rem' }}>
                <hr style={{ flex: 1, border: 'none', borderTop: '1px solid var(--color-border)', margin: 0 }} />
                or
                <hr style={{ flex: 1, border: 'none', borderTop: '1px solid var(--color-border)', margin: 0 }} />
              </div>

              <button
                type="button"
                className="btn btn-secondary btn-block"
                onClick={handleSignInWithGoogle}
              >
                Sign in with Google
              </button>

              {CONCIERGE_NUMBER && (
                <a
                  href={`sms:${CONCIERGE_NUMBER}?body=${encodeURIComponent('Hi — set me up for Fika.')}`}
                  className="auth-switch auth-switch-cta"
                  style={{ textAlign: 'center', display: 'block' }}
                >
                  No account? Sign up via text
                </a>
              )}
            </>
          )}
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
