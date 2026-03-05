'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { getSupabase } from '@/lib/supabase'

function AuthCallbackContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const next = searchParams.get('next') ?? '/app'
    const nextPath = next.startsWith('/') ? next : '/app'
    const smsToken = searchParams.get('sms_token')
    const errorParam = searchParams.get('error_description') || searchParams.get('error')

    const supabase = getSupabase()
    if (!supabase) {
      setError('App is not configured.')
      return
    }

    if (errorParam) {
      setError(decodeURIComponent(errorParam))
      return
    }

    // Implicit flow: Supabase redirects with tokens in the URL hash. The client
    // parses the hash automatically (detectSessionInUrl). Wait for session then redirect.
    let mounted = true
    const timeout = setTimeout(() => {
      if (!mounted) return
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (!mounted || !session) return
        if (smsToken) {
          fetch('/api/merge-sms-signup', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${session.access_token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ token: smsToken }),
          })
            .then((res) => { if (!res.ok) console.error('merge-sms-signup failed', res.status) })
            .finally(() => { router.replace(nextPath) })
        } else {
          router.replace(nextPath)
        }
      })
    }, 100)

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted || !session) return
      if (smsToken) {
        fetch('/api/merge-sms-signup', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ token: smsToken }),
        })
          .then((res) => { if (!res.ok) console.error('merge-sms-signup failed', res.status) })
          .finally(() => { router.replace(nextPath) })
      } else {
        router.replace(nextPath)
      }
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
    </div>
  )
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={
      <div className="auth-page" style={{ padding: '2rem', textAlign: 'center' }}>
        <p style={{ color: 'var(--color-textSecondary)' }}>Signing you in…</p>
      </div>
    }>
      <AuthCallbackContent />
    </Suspense>
  )
}
