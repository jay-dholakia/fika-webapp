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
        if (mounted && session) router.replace(nextPath)
      })
    }, 100)

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return
      if (session) {
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
