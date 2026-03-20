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
    const errorParam = searchParams.get('error_description') || searchParams.get('error')

    const supabase = getSupabase()
    if (!supabase) {
      setError('App is not configured.')
      return
    }
    const client = supabase

    if (errorParam) {
      setError(decodeURIComponent(errorParam))
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
    const timeout = setTimeout(() => {
      if (!mounted) return
      client.auth.getSession().then(({ data: { session } }) => {
        if (!mounted || !session) return
        checkExistingAccountAndRedirect(session)
      })
    }, 100)

    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      if (!mounted || !session) return
      checkExistingAccountAndRedirect(session)
    })

    return () => {
      mounted = false
      clearTimeout(timeout)
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
