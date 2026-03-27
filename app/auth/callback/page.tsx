'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { getSupabase } from '@/lib/supabase'

function AuthCallbackContent() {
  const router = useRouter()
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
        return 'Could not complete sign-in on this browser. Please return to Login and try Google sign-in again from the same browser window.'
      }
      return message
    }

    if (errorParam) {
      setError(toFriendlyAuthError(decodeURIComponent(errorParam)))
      return
    }

    async function checkExistingAccountAndRedirect(session: { access_token: string; user: { id: string } }) {
      if (mergeCalledRef.current) return
      mergeCalledRef.current = true

      // If they came with an SMS merge token, allow through (merge will create/update profile).
      if (smsToken) {
        const res = await fetch('/api/merge-sms-signup', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ token: smsToken }),
        })
        if (!res.ok) {
          console.error('merge-sms-signup failed', res.status)
          router.replace(nextPath)
          return
        }
        // SMS onboarding: open Messages to the concierge thread (no pre-filled body).
        // Profile links and follow-ups arrive there.
        const concierge = process.env.NEXT_PUBLIC_SENDBLUE_CONCIERGE_NUMBER?.trim()
        if (concierge) {
          window.location.href = `sms:${concierge}`
          return
        }
        router.replace(nextPath)
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
        router.replace('/login?no_account=1')
        return
      }

      router.replace(nextPath)
    }

    let mounted = true
    let failTimer: ReturnType<typeof setTimeout> | null = null

    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      if (!mounted || !session) return
      void checkExistingAccountAndRedirect(session)
    })

    async function finishAuth() {
      const { data: { session } } = await client.auth.getSession()
      if (session) {
        await checkExistingAccountAndRedirect(session)
        return
      }

      // Prevent infinite "Signing you in..." spinner if no session arrives.
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
  }, [searchParams, router])

  if (error) {
    return (
      <div className="auth-page" style={{ padding: '2rem', textAlign: 'center' }}>
        <p className="auth-message auth-message-error" role="alert">
          {error}
        </p>
        <a href="/" className="btn btn-primary" style={{ marginTop: '1rem' }}>
          Back to home
        </a>
        <a href="/login" className="btn btn-secondary" style={{ marginTop: '0.75rem', marginLeft: '0.5rem' }}>
          Try login again
        </a>
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
