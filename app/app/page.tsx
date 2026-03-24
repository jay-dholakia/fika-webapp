'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * /app redirects to /app/how-it-works (welcome / How it works).
 * Your Fika dashboard lives at /app/yourfika.
 */
export default function AppIndexPage() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/app/how-it-works')
  }, [router])
  return (
    <div style={{ padding: '2rem', textAlign: 'center' }}>
      Loading…
    </div>
  )
}
