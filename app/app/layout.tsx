'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { getSupabase } from '@/lib/supabase'
import { useOnboardingStatus } from '@/lib/use-onboarding'
import { authLog } from '@/lib/auth-log'
import { FeedbackBubble } from '@/app/app/components/FeedbackBubble'

function AppLayoutLoading() {
  return (
    <div style={{ padding: '2rem', textAlign: 'center' }}>
      Loading…
    </div>
  )
}

function AppLayoutInner({
  children,
}: {
  children: React.ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
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

  // Ensure profile row exists after OAuth (e.g. Google sign-in). We do not set first_name
  // from the provider; the user enters it in onboarding.
  useEffect(() => {
    const supabase = getSupabase()
    if (!userId || !supabase) return
    let cancelled = false
    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user || cancelled) return
      const { data: profile } = await supabase.from('profiles').select('id, first_name').eq('id', session.user.id).maybeSingle()
      if (cancelled) return
      if (!profile) {
        await supabase.from('profiles').upsert(
          { id: session.user.id, first_name: ' ', updated_at: new Date().toISOString() },
          { onConflict: 'id' }
        )
      }
    })()
    return () => { cancelled = true }
  }, [userId])

  useEffect(() => {
    if (!sessionChecked) return
    const onboardingToken = pathname === '/app/onboarding' ? searchParams.get('token') : null
    // Don't redirect to login when on /app/onboarding — let the page load so token-based flow can run (no auth required)
    if (userId == null && pathname === '/app/onboarding') return
    if (userId == null && !onboardingToken) {
      authLog('app-layout:redirect', { to: '/', reason: 'no-session' })
      router.replace('/')
      return
    }
    authLog('app-layout:redirect-check', { sessionChecked, userId: userId?.slice(0, 8) ?? null, loading, isComplete })
  }, [sessionChecked, userId, loading, isComplete, router, pathname, searchParams])

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

  // Token-based signup (SMS link): minimal shell — no sidebar, no settings, no logout
  const isTokenOnboarding = pathname === '/app/onboarding' && searchParams.get('token')
  if (isTokenOnboarding) {
    authLog('app-layout:render', { show: 'minimal-onboarding' })
    return (
      <div className="app-shell app-shell-minimal">
        <header className="app-minimal-header" aria-label="Fika">
          <Link href="/" className="app-sidebar-logo">
            fika
          </Link>
        </header>
        <main className="app-main app-main-full">
          {children}
        </main>
      </div>
    )
  }

  authLog('app-layout:render', { show: 'dashboard' })
  return (
    <div className="app-shell">
      <header className="app-mobile-header" aria-label="Mobile menu">
        <Link href="/app/yourfika" className="app-sidebar-logo" onClick={() => setMobileMenuOpen(false)}>
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
          <Link href="/app/yourfika" className="app-sidebar-logo" onClick={() => setMobileMenuOpen(false)}>
            fika
          </Link>
        </div>
        <nav className="app-sidebar-nav">
          <Link href="/app/how-it-works" className={pathname === '/app/how-it-works' ? 'app-sidebar-link active' : 'app-sidebar-link'} onClick={() => setMobileMenuOpen(false)}>
            Welcome to Fika
          </Link>
          <Link href="/app/yourfika" className={pathname === '/app/yourfika' || pathname?.startsWith('/app/onboarding') ? 'app-sidebar-link active' : 'app-sidebar-link'} onClick={() => setMobileMenuOpen(false)}>
            Your Fika
          </Link>
          <Link href="/app/availability" className={pathname === '/app/availability' ? 'app-sidebar-link active' : 'app-sidebar-link'} onClick={() => setMobileMenuOpen(false)}>
            Your Availability
          </Link>
        </nav>
        <div className="app-sidebar-footer">
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

export default function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <Suspense fallback={<AppLayoutLoading />}>
      <AppLayoutInner>{children}</AppLayoutInner>
    </Suspense>
  )
}
