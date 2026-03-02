'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { getSupabase } from '@/lib/supabase'

function AuthCallbackContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const code = searchParams.get('code')
    const next = searchParams.get('next') ?? '/app'
    const nextPath = next.startsWith('/') ? next : '/app'
    const errorDesc = searchParams.get('error_description') || searchParams.get('error')

    const supabase = getSupabase()
    if (!supabase) {
      setError('App is not configured.')
      return
    }

    if (errorDesc) {
      setError(decodeURIComponent(errorDesc))
      return
    }

    if (!code) {
      setError('Missing auth code. Please try signing in again.')
      return
    }

    let mounted = true
    supabase.auth
      .exchangeCodeForSession(code)
      .then(({ error: exchangeError }) => {
        if (!mounted) return
        if (exchangeError) {
          setError(exchangeError.message || 'Sign-in failed. Please try again.')
          return
        }
        router.replace(nextPath)
      })
      .catch(() => {
        if (mounted) setError('Something went wrong. Please try again.')
      })

    return () => {
      mounted = false
    }
  }, [searchParams, router])

  if (error) {
    return (
      <div className="auth-page" style={{ padding: '2rem', textAlign: 'center' }}>
        <p className="auth-message auth-message-error" role="alert">
          {error}
        </p>
        <a href="/login" className="btn btn-primary" style={{ marginTop: '1rem' }}>
          Back to sign in
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
