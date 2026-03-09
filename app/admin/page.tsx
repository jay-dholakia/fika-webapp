'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { getSupabase } from '@/lib/supabase'

type MarketRow = {
  slug: string
  label: string
  active: boolean
  signupCount: number
}

export default function AdminMarketsPage() {
  const [markets, setMarkets] = useState<MarketRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [togglingSlug, setTogglingSlug] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const supabase = getSupabase()
      const { data: { session } } = await supabase?.auth.getSession() ?? { data: { session: null } }
      const headers: HeadersInit = { 'Content-Type': 'application/json' }
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`
      }
      try {
        const res = await fetch('/api/admin/markets', { credentials: 'include', headers })
        if (res.status === 401) {
          const data = await res.json().catch(() => ({}))
          if (data?.code === 'NO_SESSION' && !cancelled) {
            window.location.href = '/login?next=/admin'
            return
          }
          throw new Error('unauthorized')
        }
        if (res.status === 403) throw new Error('not_admin')
        const data = await res.json()
        if (!cancelled && data?.markets) setMarkets(data.markets)
      } catch (e) {
        if (!cancelled) {
          const err = e instanceof Error ? e : new Error(String(e))
          const msg = err.message === 'unauthorized'
            ? 'Sign in with an admin account.'
            : err.message === 'not_admin'
              ? "Your account doesn't have admin access."
              : 'Failed to load.'
          setError(msg)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
  }, [])

  async function toggleActive(slug: string, current: boolean) {
    setTogglingSlug(slug)
    setError(null)
    try {
      const supabase = getSupabase()
      const { data: { session } } = await supabase?.auth.getSession() ?? { data: { session: null } }
      const headers: HeadersInit = { 'Content-Type': 'application/json' }
      if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`
      const res = await fetch(`/api/admin/markets/${encodeURIComponent(slug)}`, {
        method: 'PATCH',
        credentials: 'include',
        headers,
        body: JSON.stringify({ active: !current }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? 'Update failed')
      setMarkets((prev) => prev.map((m) => (m.slug === slug ? { ...m, active: !current } : m)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed')
    } finally {
      setTogglingSlug(null)
    }
  }

  if (loading) {
    return (
      <div className="admin-layout">
        <header className="admin-header">
          <div className="admin-header-inner">
            <Link href="/" className="admin-logo">fika</Link>
            <span className="admin-badge">Admin</span>
          </div>
        </header>
        <main className="admin-main">
          <div className="admin-loading">Loading…</div>
        </main>
      </div>
    )
  }

  if (error && !markets.length) {
    return (
      <div className="admin-layout">
        <header className="admin-header">
          <div className="admin-header-inner">
            <Link href="/" className="admin-logo">fika</Link>
          </div>
        </header>
        <main className="admin-main">
          <div className="admin-card admin-card-narrow">
            <p className="admin-error" role="alert">{error}</p>
            <Link href="/login?next=/admin" className="admin-btn admin-btn-primary">
              Sign in with Google
            </Link>
            <p className="admin-back">
              <Link href="/">Back to home</Link>
            </p>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="admin-layout">
      <header className="admin-header">
        <div className="admin-header-inner">
          <Link href="/" className="admin-logo">fika</Link>
          <nav className="admin-nav">
            <span className="admin-badge">Admin</span>
            <Link href="/app" className="admin-link">Back to app</Link>
          </nav>
        </div>
      </header>

      <main className="admin-main">
        <div className="admin-card">
          <h1 className="admin-title">Markets</h1>
          <p className="admin-description">
            Markets are added automatically when users sign up or set their location (onboarding or settings).
            Each row is a city group (e.g. LA, SF, NYC). Turn a market <strong>Active</strong> to send Monday
            opt-in texts and run weekly intros there.
          </p>

          {markets.length === 0 ? (
            <p className="admin-empty">No markets yet. They appear when users sign up in a supported city.</p>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Market</th>
                    <th className="admin-table-num">Signups</th>
                    <th>Active</th>
                  </tr>
                </thead>
                <tbody>
                  {markets.map((m) => (
                    <tr key={m.slug}>
                      <td className="admin-table-market">{m.label}</td>
                      <td className="admin-table-num">{m.signupCount}</td>
                      <td>
                        <label className="admin-toggle">
                          <input
                            type="checkbox"
                            checked={m.active}
                            disabled={togglingSlug !== null}
                            onChange={() => toggleActive(m.slug, m.active)}
                            aria-label={`${m.label} active`}
                          />
                          <span className="admin-toggle-label">{m.active ? 'Yes' : 'No'}</span>
                          {togglingSlug === m.slug && <span className="admin-toggle-busy">Updating…</span>}
                        </label>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {error && <p className="admin-error admin-error-inline" role="alert">{error}</p>}

          <p className="admin-back">
            <Link href="/app">Back to app</Link>
          </p>
        </div>
      </main>
    </div>
  )
}
