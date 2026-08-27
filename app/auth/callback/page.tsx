'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { getSupabase } from '@/lib/supabase'

function AuthCallbackContent() {
  const searchParams = useSearchParams()
  const [error, setError] = useState<string | null>(null)
  const mergeCalledRef = useRef(false)

  useEffect(() => {
    const next = searchParams.get('next') ?? '/app/how-it-works'
    const nextPath = next.startsWith('/') ? next : '/app/how-it-works'
    const smsToken = searchParams.get('sms_token')
    const errorParam = searchParams.get('auth_error') || searchParams.get('error_description') || searchParams.get('error')

    const supabase = getSupabase()
    if (!supabase) {
      setError('App is not configured.')
      return
    }
    const client = supabase

    function toFriendlyAuthError(message: string): string {
      const m = message.toLowerCase()
      if (m.includes('pkce code verifier not found')) {
        return 'Sign-in didn\'t complete. This usually works on the second try — tap below to try again.'
      }
      return message
    }

    if (errorParam) {
      setError(toFriendlyAuthError(decodeURIComponent(errorParam)))
      return
    }

    function isLikelyMobileDevice(): boolean {
      if (typeof navigator === 'undefined') return false
      const ua = navigator.userAgent.toLowerCase()
      return /iphone|ipad|ipod|android|mobile/.test(ua)
    }

    async function checkExistingAccountAndRedirect(session: { access_token: string; user: { id: string } }) {
      if (mergeCalledRef.current) return
      mergeCalledRef.current = true

      // If they came with an SMS merge token, allow through (merge will create/update profile).
      if (smsToken) {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 3000)
        try {
          const res = await fetch('/api/merge-sms-signup', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${session.access_token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ token: smsToken }),
            signal: controller.signal,
          })
          if (!res.ok) {
            console.error('merge-sms-signup failed', res.status)
            window.location.href = nextPath
            return
          }
        } catch (e) {
          console.error('merge-sms-signup timeout/error', e)
          window.location.href = nextPath
          return
        } finally {
          clearTimeout(timeoutId)
        }
        // SMS onboarding: open Messages to the concierge thread (no pre-filled body).
        // Profile links and follow-ups arrive there.
        const concierge = process.env.NEXT_PUBLIC_SENDBLUE_CONCIERGE_NUMBER?.trim()
        if (concierge && isLikelyMobileDevice()) {
          window.location.href = `sms:${concierge}`
          // Fallback if device/browser does not hand off to Messages.
          setTimeout(() => { window.location.href = nextPath }, 1200)
          return
        }
        window.location.href = nextPath
        return
      }

      // No SMS token: only allow if they have an existing profile (existing account).
      const { data: profile } = await client
        .from('profiles')
        .select('id')
        .eq('id', session.user.id)
        .maybeSingle()

      if (!profile) {
        await client.auth.signOut()
        window.location.href = '/login?no_account=1'
        return
      }

      window.location.href = nextPath
    }

    let mounted = true
    let failTimer: ReturnType<typeof setTimeout> | null = null

    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      if (!mounted || !session) return
      void checkExistingAccountAndRedirect(session)
    })

    async function finishAuth() {
      // detectSessionInUrl:true may have already auto-exchanged the code.
      // Check for an existing session first to avoid double-exchanging the
      // same code (which produces a "pkce code verifier not found" error).
      const { data: { session: existingSession } } = await client.auth.getSession()
      if (!mounted) return
      if (existingSession) {
        await checkExistingAccountAndRedirect(existingSession)
        return
      }

      const code = searchParams.get('code')
      if (code) {
        // Manual exchange as fallback: handles iOS cases where the OAuth
        // callback opens in a different browser context from the one that
        // started the flow (auto-detection would have already run above).
        const { data, error } = await client.auth.exchangeCodeForSession(code)
        if (!mounted) return
        if (error) {
          setError(toFriendlyAuthError(error.message))
          return
        }
        if (data.session) {
          await checkExistingAccountAndRedirect(data.session)
          return
        }
      }

      // No code, no session yet — onAuthStateChange will handle it if it arrives.
      // Set a timeout to avoid an infinite spinner.
      failTimer = setTimeout(() => {
        if (!mounted) return
        setError('Could not complete sign-in. Please try again.')
      }, 4000)
    }

    void finishAuth()

    return () => {
      mounted = false
      if (failTimer) clearTimeout(failTimer)
      subscription.unsubscribe()
    }
  }, [searchParams])

  if (error) {
    return (
      <div className="auth-page" style={{ padding: '2rem', textAlign: 'center' }}>
        <p className="auth-message auth-message-error" role="alert">
          {error}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem', marginTop: '1.25rem' }}>
          <a href="/login" className="btn btn-primary">
            Try again
          </a>
          <a href="/" style={{ fontSize: '0.85rem', color: 'var(--color-textSecondary)', textDecoration: 'none' }}>
            Back to home
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-page" style={{ padding: '2rem', textAlign: 'center' }}>
      <p style={{ color: 'var(--color-textSecondary)' }}>Signing you in…</p>
      <div style={{ marginTop: 12, display: 'flex', justifyContent: 'center' }}>
        <span className="spinner spinner-dark" aria-hidden="true" />
      </div>
    </div>
  )
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={
      <div className="auth-page" style={{ padding: '2rem', textAlign: 'center' }}>
        <p style={{ color: 'var(--color-textSecondary)' }}>Signing you in…</p>
        <div style={{ marginTop: 12, display: 'flex', justifyContent: 'center' }}>
          <span className="spinner spinner-dark" aria-hidden="true" />
        </div>
      </div>
    }>
      <AuthCallbackContent />
    </Suspense>
  )
}
