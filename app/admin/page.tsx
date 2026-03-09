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
          const msg = e?.message === 'unauthorized'
            ? 'Sign in with an admin account.'
            : e?.message === 'not_admin'
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
      <div className="auth-page" style={{ padding: '2rem', textAlign: 'center' }}>
        <p style={{ color: 'var(--color-textSecondary)' }}>Loading…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="auth-page" style={{ padding: '2rem', maxWidth: '28rem', margin: '0 auto' }}>
        <header className="header" style={{ marginBottom: '1.5rem' }}>
          <div className="header-inner">
            <Link href="/" className="logo">fika</Link>
          </div>
        </header>
        <p className="auth-message auth-message-error" role="alert" style={{ marginBottom: '1rem' }}>
          {error}
        </p>
        <Link href="/login?next=/admin" className="btn btn-primary">
          Sign in with Google
        </Link>
        <p style={{ marginTop: '1rem' }}>
          <Link href="/">Back to home</Link>
        </p>
      </div>
    )
  }

  return (
    <div className="auth-page" style={{ padding: '2rem', maxWidth: '42rem', margin: '0 auto' }}>
      <header className="header" style={{ marginBottom: '1.5rem' }}>
        <div className="header-inner">
          <Link href="/" className="logo">fika</Link>
          <span style={{ marginLeft: '1rem', color: 'var(--color-textSecondary)', fontSize: '0.9rem' }}>Admin</span>
        </div>
      </header>

      <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>Markets</h1>
      <p style={{ color: 'var(--color-textSecondary)', fontSize: '0.95rem', marginBottom: '1.25rem' }}>
        Signups by city. Turn a market <strong>Active</strong> to send Monday opt-in texts and run intros there.
      </p>

      {markets.length === 0 ? (
        <p style={{ color: 'var(--color-textSecondary)' }}>No markets yet. They appear when users sign up in a supported city.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.95rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
              <th style={{ textAlign: 'left', padding: '0.6rem 0.5rem 0.6rem 0', fontWeight: 600 }}>Market</th>
              <th style={{ textAlign: 'right', padding: '0.6rem 0.5rem', fontWeight: 600 }}>Signups</th>
              <th style={{ textAlign: 'left', padding: '0.6rem 0 0.6rem 0.5rem', fontWeight: 600 }}>Active</th>
            </tr>
          </thead>
          <tbody>
            {markets.map((m) => (
              <tr key={m.slug} style={{ borderBottom: '1px solid var(--color-border)' }}>
                <td style={{ padding: '0.75rem 0.5rem 0.75rem 0' }}>{m.label}</td>
                <td style={{ textAlign: 'right', padding: '0.75rem 0.5rem' }}>{m.signupCount}</td>
                <td style={{ padding: '0.75rem 0 0.75rem 0.5rem' }}>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', cursor: togglingSlug ? 'not-allowed' : 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={m.active}
                      disabled={togglingSlug !== null}
                      onChange={() => toggleActive(m.slug, m.active)}
                      aria-label={`${m.label} active`}
                    />
                    <span>{m.active ? 'Yes' : 'No'}</span>
                  </label>
                  {togglingSlug === m.slug && <span style={{ marginLeft: '0.5rem', color: 'var(--color-textSecondary)', fontSize: '0.85rem' }}>Updating…</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {error && <p className="auth-message auth-message-error" role="alert" style={{ marginTop: '1rem' }}>{error}</p>}

      <p style={{ marginTop: '1.5rem' }}>
        <Link href="/">Back to home</Link>
      </p>
    </div>
  )
}
