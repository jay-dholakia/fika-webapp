'use client'

import { useEffect, useMemo, useState } from 'react'
import { getSupabase } from '@/lib/supabase'

type EventInfo = {
  id: string
  marketSlug: string
  startsAt: string
  venueName: string | null
  venueNeighborhood: string | null
} | null

type FikaRow = {
  id: string
  createdAt: string | null
  expiresAt: string | null
  status: string | null
  stage: 'pending' | 'revealed' | 'expired' | 'cancelled' | 'unknown'
  needsAttentionReason: string | null
  score: number | null
  event: EventInfo
  userA: { id: string; firstName: string | null; phone: string | null; city: string | null; market: string | null }
  userB: { id: string; firstName: string | null; phone: string | null; city: string | null; market: string | null }
}

type ApiResponse = {
  summary: {
    total: number
    returned: number
    limit: number
    market: string | null
    stage: string | null
    needs_attention: boolean
    q: string | null
  }
  fikas: FikaRow[]
}

function fmtDate(ts: string | null): string {
  if (!ts) return '—'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ts
  return d.toLocaleDateString(undefined, { dateStyle: 'medium' })
}

function fmtDateTime(ts: string | null): string {
  if (!ts) return '—'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ts
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function stageChip(stage: FikaRow['stage']): string {
  switch (stage) {
    case 'pending': return '🕐 Pending'
    case 'revealed': return '✅ Revealed'
    case 'expired': return '⏰ Expired'
    case 'cancelled': return '❌ Cancelled'
    default: return stage
  }
}

export default function AdminFikasPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<ApiResponse | null>(null)
  const [q, setQ] = useState('')
  const [market, setMarket] = useState('')
  const [stage, setStage] = useState('')
  const [needsAttentionOnly, setNeedsAttentionOnly] = useState(false)

  const marketOptions = useMemo(() => {
    const set = new Set<string>()
    for (const r of data?.fikas ?? []) {
      if (r.userA.market) set.add(r.userA.market)
      if (r.userB.market) set.add(r.userB.market)
      if (r.event?.marketSlug) set.add(r.event.marketSlug)
    }
    return Array.from(set).sort()
  }, [data?.fikas])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const supabase = getSupabase()
      const { data: { session } } = await supabase?.auth.getSession() ?? { data: { session: null } }
      const headers: HeadersInit = { 'Content-Type': 'application/json' }
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`

      const params = new URLSearchParams()
      params.set('limit', '500')
      if (q.trim()) params.set('q', q.trim())
      if (market.trim()) params.set('market', market.trim())
      if (stage.trim()) params.set('stage', stage.trim())
      if (needsAttentionOnly) params.set('needs_attention', '1')

      const res = await fetch(`/api/admin/fikas?${params.toString()}`, { credentials: 'include', headers })
      const json = await res.json().catch(() => ({} as ApiResponse))
      if (res.status === 401 && (json as any)?.code === 'NO_SESSION') {
        window.location.href = '/login?next=/admin/fikas'
        return
      }
      if (!res.ok) throw new Error((json as any)?.error ?? 'Failed to load')
      setData(json as ApiResponse)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <main className="admin-main">
      <div className="admin-card">
        <h1 className="admin-title">Fikas</h1>
        <p className="admin-description">
          All-time match lifecycle view — source of truth: <code>match_candidates</code>.
          Stage reflects the event-based flow: pending → revealed (reveal SMS sent 30 min before event).
        </p>

        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
          <input
            className="auth-input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, phone, city, market, match id"
            aria-label="Search"
            style={{ minWidth: 280 }}
          />
          <select className="auth-input" value={market} onChange={(e) => setMarket(e.target.value)} aria-label="Market">
            <option value="">All markets</option>
            {marketOptions.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <select className="auth-input" value={stage} onChange={(e) => setStage(e.target.value)} aria-label="Stage">
            <option value="">All stages</option>
            <option value="pending">Pending</option>
            <option value="revealed">Revealed</option>
            <option value="expired">Expired</option>
            <option value="cancelled">Cancelled</option>
            <option value="unknown">Unknown</option>
          </select>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={needsAttentionOnly}
              onChange={(e) => setNeedsAttentionOnly(e.target.checked)}
            />
            Needs attention only
          </label>
          <button type="button" className="admin-btn admin-btn-primary" onClick={load} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>

        {error && <p className="admin-error admin-error-inline" role="alert">{error}</p>}

        {data && (
          <p className="admin-modal-meta">
            Showing <strong>{data.summary.returned}</strong> of {data.summary.total} (limit {data.summary.limit})
          </p>
        )}

        {loading ? (
          <div className="admin-loading">Loading…</div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Created</th>
                  <th>Pair</th>
                  <th>Stage</th>
                  <th>Event</th>
                  <th>Venue</th>
                  <th>Score</th>
                  <th>Attention</th>
                </tr>
              </thead>
              <tbody>
                {(data?.fikas ?? []).map((r) => {
                  const nameA = r.userA.firstName?.trim() || 'Unknown'
                  const nameB = r.userB.firstName?.trim() || 'Unknown'
                  const venueLine = r.event
                    ? [r.event.venueName, r.event.venueNeighborhood].filter(Boolean).join(', ') || '—'
                    : '—'
                  return (
                    <tr key={r.id}>
                      <td>{fmtDate(r.createdAt)}</td>
                      <td>
                        {nameA} ↔ {nameB}
                        {r.userA.market && <div style={{ fontSize: '0.75em', opacity: 0.6 }}>{r.userA.market}</div>}
                      </td>
                      <td>{stageChip(r.stage)}</td>
                      <td>{r.event ? fmtDateTime(r.event.startsAt) : '—'}</td>
                      <td>{venueLine}</td>
                      <td>{r.score != null ? r.score.toFixed(1) : '—'}</td>
                      <td>{r.needsAttentionReason ?? '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  )
}
