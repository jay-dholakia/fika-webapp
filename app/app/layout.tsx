'use client'

import { useState, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { getSupabase } from '@/lib/supabase'
import { useOnboardingStatus } from '@/lib/use-onboarding'
import { authLog } from '@/lib/auth-log'
import { FeedbackBubble } from '@/app/app/components/FeedbackBubble'

export default function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [userId, setUserId] = useState<string | null>(null)
  const [sessionChecked, setSessionChecked] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const { loading, isComplete, profile } = useOnboardingStatus(userId ?? undefined)

  useEffect(() => {
    setMobileMenuOpen(false)
  }, [pathname])

  useEffect(() => {
    authLog('app-layout:mount')
    const supabase = getSupabase()
    if (!supabase) {
      authLog('app-layout:no-supabase')
      setSessionChecked(true)
      return
    }
    let mounted = true
    function setSession(session: { user: { id: string } } | null) {
      if (mounted) {
        const id = session?.user?.id ?? null
        authLog('app-layout:setSession', { userId: id?.slice(0, 8) ?? null })
        setUserId(id)
      }
    }
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (mounted) {
        authLog('app-layout:getSession', { hasSession: !!session, userId: session?.user?.id?.slice(0, 8) })
        setSession(session)
        setSessionChecked(true)
      }
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      authLog('app-layout:onAuthStateChange', { event, hasSession: !!session })
      if (mounted) setSession(session)
    })
    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  // Ensure profile row exists after OAuth (e.g. Google sign-in)
  useEffect(() => {
    const supabase = getSupabase()
    if (!userId || !supabase) return
    let cancelled = false
    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user || cancelled) return
      const meta = session.user.user_metadata
      const name = (meta?.full_name ?? meta?.name ?? '').trim() || ' '
      const { data: profile } = await supabase.from('profiles').select('id, first_name').eq('id', session.user.id).maybeSingle()
      if (cancelled) return
      if (!profile || (profile.first_name ?? '').trim() === '') {
        await supabase.from('profiles').upsert(
          { id: session.user.id, first_name: name, updated_at: new Date().toISOString() },
          { onConflict: 'id' }
        )
      }
    })()
    return () => { cancelled = true }
  }, [userId])

  useEffect(() => {
    if (!sessionChecked) return
    authLog('app-layout:redirect-check', { sessionChecked, userId: userId?.slice(0, 8) ?? null, loading, isComplete })
    if (userId == null) {
      authLog('app-layout:redirect', { to: '/login', reason: 'no-session' })
      router.replace('/login')
      return
    }
  }, [sessionChecked, userId, loading, isComplete, router])

  async function handleSignOut() {
    await getSupabase()?.auth.signOut()
    router.replace('/')
  }

  if (!sessionChecked || loading) {
    authLog('app-layout:render', { show: 'Loading', sessionChecked, loading, hasUserId: !!userId })
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        Loading…
      </div>
    )
  }

  authLog('app-layout:render', { show: 'dashboard' })
  return (
    <div className="app-shell">
      <header className="app-mobile-header" aria-label="Mobile menu">
        <Link href="/app" className="app-sidebar-logo" onClick={() => setMobileMenuOpen(false)}>
          fika
        </Link>
        <button
          type="button"
          className="app-mobile-menu-btn"
          onClick={() => setMobileMenuOpen((o) => !o)}
          aria-expanded={mobileMenuOpen}
          aria-controls="app-sidebar"
          aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
        >
          <span className="app-mobile-menu-icon" aria-hidden />
        </button>
      </header>
      {mobileMenuOpen && (
        <div
          className="app-sidebar-backdrop"
          aria-hidden
          onClick={() => setMobileMenuOpen(false)}
        />
      )}
      <aside
        id="app-sidebar"
        className={`app-sidebar ${mobileMenuOpen ? 'app-sidebar-open' : ''}`}
        aria-label="App navigation"
      >
        <div className="app-sidebar-header app-sidebar-header-desktop">
          <Link href="/app" className="app-sidebar-logo" onClick={() => setMobileMenuOpen(false)}>
            fika
          </Link>
        </div>
        <nav className="app-sidebar-nav">
          <Link href="/app/how-it-works" className={pathname === '/app/how-it-works' ? 'app-sidebar-link active' : 'app-sidebar-link'} onClick={() => setMobileMenuOpen(false)}>
            Welcome!
          </Link>
          <Link href="/app" className={pathname === '/app' || pathname?.startsWith('/app/onboarding') ? 'app-sidebar-link active' : 'app-sidebar-link'} onClick={() => setMobileMenuOpen(false)}>
            Your Weekly Fika
          </Link>
          <Link href="/app/availability" className={pathname === '/app/availability' ? 'app-sidebar-link active' : 'app-sidebar-link'} onClick={() => setMobileMenuOpen(false)}>
            Your Availability
          </Link>
        </nav>
        <div className="app-sidebar-footer">
          <div className="app-sidebar-intros" aria-label="Intro balance">
            <span className="app-sidebar-intros-icon">☕</span>
            <span className="app-sidebar-intros-label">Intros</span>
            <span className="app-sidebar-intros-count">{profile?.intro_balance ?? 0}</span>
          </div>
          <Link href="/app/settings/profile" className={pathname === '/app/settings/profile' ? 'app-sidebar-link active' : 'app-sidebar-link'} onClick={() => setMobileMenuOpen(false)}>
            Edit profile
          </Link>
          <Link href="/app/settings/how-it-works" className={pathname === '/app/settings/how-it-works' ? 'app-sidebar-link active' : 'app-sidebar-link'} onClick={() => setMobileMenuOpen(false)}>
            FAQ
          </Link>
          <button type="button" className="app-sidebar-logout" onClick={handleSignOut}>
            Log out
          </button>
        </div>
      </aside>
      <main className="app-main">
        {children}
      </main>
      <div className="app-feedback-corner">
        <FeedbackBubble isOpen={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
        {!feedbackOpen && (
          <button
            type="button"
            className="app-feedback-pill"
            onClick={() => setFeedbackOpen(true)}
            aria-label="Send feedback"
            aria-expanded={false}
          >
            <span className="app-feedback-pill-icon" aria-hidden>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </span>
            <span className="app-feedback-pill-label">Feedback</span>
          </button>
        )}
      </div>
    </div>
  )
}
