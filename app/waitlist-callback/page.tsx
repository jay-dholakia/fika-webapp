'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { getSupabase } from '@/lib/supabase'
import Header from '../components/Header'
import Footer from '../components/Footer'

const WAITLIST_STORAGE_KEY = 'fika_waitlist_city_state'

export default function WaitlistCallbackPage() {
  const router = useRouter()
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
  const [message, setMessage] = useState('')

  useEffect(() => {
    let mounted = true
    const run = async () => {
      const supabase = getSupabase()
      if (!supabase) {
        if (mounted) {
          setStatus('error')
          setMessage('App is not configured.')
        }
        return
      }
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user?.email) {
        router.replace('/')
        return
      }
      const raw = typeof window !== 'undefined' ? sessionStorage.getItem(WAITLIST_STORAGE_KEY) : null
      let city: string | null = null
      let state: string | null = null
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as { city?: string; state?: string }
          city = parsed.city ?? null
          state = parsed.state ?? null
        } catch {
          // ignore
        }
        sessionStorage.removeItem(WAITLIST_STORAGE_KEY)
      }
      const email = session.user.email.trim().toLowerCase()
      const { error } = await supabase.from('waitlist').insert({
        email,
        city,
        state,
        marketing_consent_at: new Date().toISOString(),
      })
      if (!mounted) return
      if (error) {
        setStatus('error')
        if (error.code === '23505') {
          setMessage("You're already on the list. We'll email you when we launch in your city.")
        } else {
          setMessage('Something went wrong. Please try again.')
        }
        return
      }
      setStatus('success')
    }
    run()
    return () => { mounted = false }
  }, [router])

  if (status === 'loading') {
    return (
      <>
        <Header />
        <main className="auth-page">
          <div className="auth-card">
            <p className="auth-sub">Adding you to the waitlist…</p>
          </div>
        </main>
        <Footer />
      </>
    )
  }

  if (status === 'error') {
    return (
      <>
        <Header />
        <main className="auth-page">
          <div className="auth-card">
            <p className="auth-message auth-message-error" role="alert">{message}</p>
            <Link href="/" className="btn btn-primary">Go to home</Link>
          </div>
        </main>
        <Footer />
      </>
    )
  }

  return (
    <>
      <Header />
      <main className="auth-page">
        <div className="auth-card">
          <h1 className="auth-title">You&apos;re on the list</h1>
          <p className="auth-sub">We&apos;ll email you when Fika comes to your city.</p>
          <Link href="/" className="btn btn-primary">Go to home</Link>
        </div>
      </main>
      <Footer />
    </>
  )
}
