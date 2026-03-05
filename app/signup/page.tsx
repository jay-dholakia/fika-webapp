'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense, useEffect } from 'react'

/**
 * Redirect /signup?token=XXX to /app/onboarding?token=XXX so the profile builder runs there (with token-based session).
 */
function SignupContent() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token')

  useEffect(() => {
    if (token) {
      window.location.href = `/app/onboarding?token=${encodeURIComponent(token)}`
    } else {
      window.location.href = '/'
    }
  }, [token])

  return (
    <div style={{ padding: '2rem', textAlign: 'center' }}>
      <p style={{ color: 'var(--color-textSecondary)' }}>Taking you to complete your profile…</p>
    </div>
  )
}

export default function SignupPage() {
  return (
    <Suspense fallback={
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <p style={{ color: 'var(--color-textSecondary)' }}>Loading…</p>
      </div>
    }>
      <SignupContent />
    </Suspense>
  )
}
