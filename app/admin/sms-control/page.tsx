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
  const [bulkSaving, setBulkSaving] = useState(false)
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

  async function setMode(userId: string, mode: 'auto' | 'human') {
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
        body: JSON.stringify({ mode }),
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
  const allFilteredHuman = filtered.length > 0 && filtered.every((u) => u.smsMode === 'human')

  async function setBulkMode(mode: 'auto' | 'human') {
    setBulkSaving(true)
    setError(null)
    const targets = filtered.map((u) => u.id)
    try {
      await Promise.all(targets.map(async (userId) => {
        const supabase = getSupabase()
        const { data: { session } } = await supabase?.auth.getSession() ?? { data: { session: null } }
        const headers: HeadersInit = { 'Content-Type': 'application/json' }
        if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`
        const res = await fetch(`/api/admin/sms-control/${encodeURIComponent(userId)}`, {
          method: 'PATCH',
          credentials: 'include',
          headers,
          body: JSON.stringify({ mode }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data?.error ?? `Failed for ${userId}`)
      }))
      setUsers((prev) => prev.map((u) => (targets.includes(u.id) ? { ...u, smsMode: mode, smsHumanUntil: null } : u)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Bulk update failed')
    } finally {
      setBulkSaving(false)
    }
  }

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
                  <th>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span>Mode</span>
                      <button
                        type="button"
                        className={`admin-switch ${allFilteredHuman ? 'admin-switch-on' : 'admin-switch-off'}`}
                        onClick={() => setBulkMode(allFilteredHuman ? 'auto' : 'human')}
                        disabled={bulkSaving || filtered.length === 0}
                        aria-label={allFilteredHuman ? 'Set all visible users to auto' : 'Set all visible users to human'}
                      >
                        <span className="admin-switch-knob" />
                        <span className="admin-switch-label">{allFilteredHuman ? 'Human' : 'Auto'}</span>
                      </button>
                    </div>
                  </th>
                  <th>Human until</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => (
                  <tr key={u.id}>
                    <td>{u.firstName ?? '—'}</td>
                    <td>{u.phone ?? '—'}</td>
                    <td>{u.city ?? u.market ?? '—'}</td>
                    <td>
                      <button
                        type="button"
                        className={`admin-switch ${u.smsMode === 'human' ? 'admin-switch-on' : 'admin-switch-off'}`}
                        onClick={() => setMode(u.id, u.smsMode === 'human' ? 'auto' : 'human')}
                        disabled={savingId === u.id || bulkSaving}
                        aria-label={`${u.firstName ?? 'User'} SMS mode ${u.smsMode === 'human' ? 'human' : 'auto'}`}
                      >
                        <span className="admin-switch-knob" />
                        <span className="admin-switch-label">{u.smsMode === 'human' ? 'Human' : 'Auto'}</span>
                      </button>
                    </td>
                    <td>{formatTime(u.smsHumanUntil)}</td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={5} className="admin-empty">No users found.</td>
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
