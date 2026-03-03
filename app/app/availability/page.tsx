'use client'

import { useState, useEffect } from 'react'
import { getSupabase } from '@/lib/supabase'

export default function AvailabilityPage() {
  const [userId, setUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getSupabase()?.auth.getSession().then(({ data: { session } }) => {
      setUserId(session?.user?.id ?? null)
      setLoading(false)
    })
  }, [])

  if (loading) {
    return (
      <div className="app-card">
        <p className="app-empty">Loading…</p>
      </div>
    )
  }

  return (
    <div className="app-card">
      <h2 className="app-page-title">Your Availability</h2>
      <div className="app-availability-default-card">
        <p>
          We&apos;re still building the community in your area. Once we&apos;re ready to match you for Fikas, we&apos;ll ask when you&apos;re free so we can suggest times that work for everyone.
        </p>
        <p style={{ marginTop: '0.75rem', marginBottom: 0 }}>
          Nothing for you to do here yet — we&apos;ll let you know when it&apos;s time to set your availability.
        </p>
      </div>
    </div>
  )
}
