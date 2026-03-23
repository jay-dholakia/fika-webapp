'use client'

import { useEffect, useState } from 'react'
import { getSupabase } from '@/lib/supabase'

type SmsUser = {
  id: string
  firstName: string | null
  phone: string | null
  city: string | null
  market: string | null
  smsMode: 'auto' | 'human'
  smsHumanUntil: string | null
  updatedAt: string | null
}

function formatTime(ts: string | null): string {
  if (!ts) return 'No expiry'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ts
  return d.toLocaleString()
}

export default function AdminSmsControlPage() {
  const [users, setUsers] = useState<SmsUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      const supabase = getSupabase()
      const { data: { session } } = await supabase?.auth.getSession() ?? { data: { session: null } }
      const headers: HeadersInit = { 'Content-Type': 'application/json' }
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`
      try {
        const res = await fetch('/api/admin/sms-control', { credentials: 'include', headers })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data?.error ?? 'Failed to load SMS control users')
        if (!cancelled) setUsers(Array.isArray(data?.users) ? data.users as SmsUser[] : [])
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  async function setMode(userId: string, mode: 'auto' | 'human', hours?: number) {
    setSavingId(userId)
    setError(null)
    const supabase = getSupabase()
    const { data: { session } } = await supabase?.auth.getSession() ?? { data: { session: null } }
    const headers: HeadersInit = { 'Content-Type': 'application/json' }
    if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`
    try {
      const res = await fetch(`/api/admin/sms-control/${encodeURIComponent(userId)}`, {
        method: 'PATCH',
        credentials: 'include',
        headers,
        body: JSON.stringify({ mode, ...(hours ? { hours } : {}) }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? 'Failed to update mode')
      setUsers((prev) => prev.map((u) => (
        u.id === userId
          ? { ...u, smsMode: data.smsMode as 'auto' | 'human', smsHumanUntil: data.smsHumanUntil ?? null }
          : u
      )))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update mode')
    } finally {
      setSavingId(null)
    }
  }

  const filtered = users.filter((u) => {
    const hay = `${u.firstName ?? ''} ${u.phone ?? ''} ${u.city ?? ''} ${u.market ?? ''}`.toLowerCase()
    return hay.includes(query.trim().toLowerCase())
  })

  return (
    <main className="admin-main">
      <div className="admin-card">
        <h1 className="admin-title">SMS Control</h1>
        <p className="admin-description">
          Switch users between automation and human takeover. In Human mode, webhook auto-replies are suppressed.
        </p>
        <div style={{ marginBottom: '0.75rem' }}>
          <input
            className="auth-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, phone, city, market"
            aria-label="Search users"
          />
        </div>
        {loading ? (
          <div className="admin-loading">Loading…</div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Phone</th>
                  <th>Location</th>
                  <th>Mode</th>
                  <th>Human until</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => (
                  <tr key={u.id}>
                    <td>{u.firstName ?? '—'}</td>
                    <td>{u.phone ?? '—'}</td>
                    <td>{u.city ?? u.market ?? '—'}</td>
                    <td>{u.smsMode}</td>
                    <td>{formatTime(u.smsHumanUntil)}</td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                        <button className="admin-btn" type="button" disabled={savingId === u.id} onClick={() => setMode(u.id, 'auto')} style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
                          Auto
                        </button>
                        <button className="admin-btn" type="button" disabled={savingId === u.id} onClick={() => setMode(u.id, 'human', 24)} style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
                          Human 24h
                        </button>
                        <button className="admin-btn" type="button" disabled={savingId === u.id} onClick={() => setMode(u.id, 'human', 72)} style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
                          Human 72h
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="admin-empty">No users found.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        {error && <p className="admin-error admin-error-inline" role="alert">{error}</p>}
      </div>
    </main>
  )
}
