'use client'

import { useCallback, useEffect, useState } from 'react'
import { getSupabase } from '@/lib/supabase'

type SessionRow = {
  id: string
  market_slug: string
  venue_id: string
  week_anchor_monday: string
  radius_miles: number
  iana_tz: string
  fika_starts_at: string
  status: string
  opt_in_closes_at: string | null
  sunday_blast_sent_at: string | null
  opt_in_closed_at: string | null
  match_run_at: string | null
  intro_sms_sent_at: string | null
}

type MatchRow = {
  id: string
  user_a: string
  user_b: string
  admin_approval_status: string
  score: number | null
  created_at: string | null
}

type DetailResponse = {
  session: SessionRow
  venue: { id: string; name: string; neighborhood: string | null; city: string } | null
  counts: { opt_ins: number; matches: number }
  matches: MatchRow[]
}

async function getAuthHeaders(): Promise<HeadersInit> {
  const supabase = getSupabase()
  const { data: { session } } = await supabase?.auth.getSession() ?? { data: { session: null } }
  const headers: HeadersInit = { 'Content-Type': 'application/json' }
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`
  return headers
}

function toDateTimeLocalValue(ts: string): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fromDateTimeLocalValue(v: string): string {
  if (!v) return ''
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString()
}

export default function AdminFikaSocialsPage() {
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<DetailResponse | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const [marketSlug, setMarketSlug] = useState('la')
  const [venueId, setVenueId] = useState('')
  const [weekMonday, setWeekMonday] = useState('')
  const [fikaLocal, setFikaLocal] = useState('')
  const [radius, setRadius] = useState('4')
  const [ianaTz, setIanaTz] = useState('America/Los_Angeles')
  const [optInClosesLocal, setOptInClosesLocal] = useState('')
  const [previewCount, setPreviewCount] = useState<number | null>(null)

  const loadSessions = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/fika-socials?limit=100', {
        credentials: 'include',
        headers: await getAuthHeaders(),
      })
      const json = await res.json().catch(() => ({}))
      if (res.status === 403 && json?.code === 'NOT_ADMIN') {
        window.location.href = '/login?next=/admin/fika-socials'
        return
      }
      if (!res.ok) throw new Error(json?.error ?? 'Failed to load')
      setSessions(json.sessions ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadDetail = useCallback(async (sessionId: string) => {
    setDetailLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/fika-socials/${encodeURIComponent(sessionId)}`, {
        credentials: 'include',
        headers: await getAuthHeaders(),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error ?? 'Failed to load session')
      setDetail(json as DetailResponse)
      setOptInClosesLocal(json.session?.opt_in_closes_at ? toDateTimeLocalValue(json.session.opt_in_closes_at) : '')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load session')
    } finally {
      setDetailLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadSessions()
  }, [loadSessions])

  async function previewEligibility() {
    setError(null)
    setPreviewCount(null)
    try {
      const params = new URLSearchParams({
        market_slug: marketSlug.trim(),
        venue_id: venueId.trim(),
        radius_miles: radius.trim() || '4',
      })
      const res = await fetch(`/api/admin/fika-socials/eligibility-preview?${params}`, {
        credentials: 'include',
        headers: await getAuthHeaders(),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error ?? 'Preview failed')
      setPreviewCount(json.count ?? 0)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Preview failed')
    }
  }

  async function createSession() {
    setError(null)
    try {
      const fikaIso = fromDateTimeLocalValue(fikaLocal)
      if (!weekMonday.trim()) throw new Error('Set week_anchor_monday (YYYY-MM-DD)')
      if (!fikaIso) throw new Error('Set Fika start (local date/time)')
      const res = await fetch('/api/admin/fika-socials', {
        method: 'POST',
        credentials: 'include',
        headers: await getAuthHeaders(),
        body: JSON.stringify({
          market_slug: marketSlug.trim(),
          venue_id: venueId.trim(),
          week_anchor_monday: weekMonday.trim(),
          fika_starts_at: fikaIso,
          radius_miles: Number(radius) || 4,
          iana_tz: ianaTz.trim() || 'America/Los_Angeles',
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error ?? 'Create failed')
      await loadSessions()
      if (json.session?.id) await loadDetail(json.session.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Create failed')
    }
  }

  async function patchSession(sessionId: string, body: Record<string, unknown>) {
    setError(null)
    try {
      const res = await fetch(`/api/admin/fika-socials/${encodeURIComponent(sessionId)}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: await getAuthHeaders(),
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error ?? 'Update failed')
      await loadSessions()
      await loadDetail(sessionId)
      return json
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed')
      return null
    }
  }

  return (
    <main className="admin-markets-page" style={{ maxWidth: 960, margin: '0 auto', padding: '1.25rem 1rem 3rem' }}>
      <h1 style={{ fontSize: '1.35rem', marginBottom: '0.35rem' }}>Fika socials</h1>
      <p style={{ color: 'var(--color-textSecondary, #666)', marginBottom: '1.25rem', fontSize: '0.95rem' }}>
        Draft sessions: set Fika time and opt-in close, publish, record opt-in blast, close opt-in, run matcher, approve rows, then mark intro-ready (SMS send path still separate). Relative
        blast/close/intro milestones from <code>fika_starts_at</code> are specified in <code>docs/WEEKLY_FIKA_RELATIVE_CADENCE.md</code> (automation not wired yet).
      </p>

      {error ? (
        <p style={{ color: '#b00020', marginBottom: '1rem' }} role="alert">
          {error}
        </p>
      ) : null}

      <section
        style={{
          border: '1px solid var(--color-border, #ddd)',
          borderRadius: 8,
          padding: '1rem',
          marginBottom: '1.5rem',
        }}
      >
        <h2 style={{ fontSize: '1.05rem', marginBottom: '0.75rem' }}>New draft</h2>
        <div style={{ display: 'grid', gap: '0.65rem', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
          <label>
            <span style={{ display: 'block', fontSize: '0.8rem', marginBottom: 2 }}>market_slug</span>
            <input value={marketSlug} onChange={(e) => setMarketSlug(e.target.value)} style={{ width: '100%' }} />
          </label>
          <label>
            <span style={{ display: 'block', fontSize: '0.8rem', marginBottom: 2 }}>venue_id (uuid)</span>
            <input value={venueId} onChange={(e) => setVenueId(e.target.value)} style={{ width: '100%' }} />
          </label>
          <label>
            <span style={{ display: 'block', fontSize: '0.8rem', marginBottom: 2 }}>week_anchor_monday</span>
            <input type="date" value={weekMonday} onChange={(e) => setWeekMonday(e.target.value)} style={{ width: '100%' }} />
          </label>
          <label>
            <span style={{ display: 'block', fontSize: '0.8rem', marginBottom: 2 }}>Fika starts (local)</span>
            <input type="datetime-local" value={fikaLocal} onChange={(e) => setFikaLocal(e.target.value)} style={{ width: '100%' }} />
          </label>
          <label>
            <span style={{ display: 'block', fontSize: '0.8rem', marginBottom: 2 }}>radius_miles</span>
            <input value={radius} onChange={(e) => setRadius(e.target.value)} style={{ width: '100%' }} />
          </label>
          <label>
            <span style={{ display: 'block', fontSize: '0.8rem', marginBottom: 2 }}>iana_tz</span>
            <input value={ianaTz} onChange={(e) => setIanaTz(e.target.value)} style={{ width: '100%' }} />
          </label>
        </div>
        <div style={{ marginTop: '0.85rem', display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
          <button type="button" className="admin-btn" onClick={() => void previewEligibility()}>
            Preview pool count
          </button>
          {previewCount != null ? (
            <span style={{ alignSelf: 'center', fontSize: '0.9rem' }}>~{previewCount} profiles in radius</span>
          ) : null}
          <button type="button" className="admin-btn admin-btn-primary" onClick={() => void createSession()}>
            Create draft
          </button>
        </div>
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.2fr)', gap: '1rem' }}>
        <section
          style={{
            border: '1px solid var(--color-border, #ddd)',
            borderRadius: 8,
            padding: '0.75rem',
          }}
        >
          <h2 style={{ fontSize: '1.05rem', marginBottom: '0.5rem' }}>Sessions</h2>
          {loading ? <p>Loading…</p> : null}
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {sessions.map((s) => (
              <li key={s.id} style={{ marginBottom: 6 }}>
                <button
                  type="button"
                  onClick={() => void loadDetail(s.id)}
                  style={{
                    textAlign: 'left',
                    width: '100%',
                    padding: '0.45rem 0.5rem',
                    borderRadius: 6,
                    border: detail?.session.id === s.id ? '2px solid #333' : '1px solid #ddd',
                    background: detail?.session.id === s.id ? '#f6f6f6' : '#fff',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ fontWeight: 600 }}>{s.status}</div>
                  <div style={{ fontSize: '0.8rem', color: '#555' }}>
                    {s.market_slug} · week {s.week_anchor_monday}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#888' }}>{s.id}</div>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section
          style={{
            border: '1px solid var(--color-border, #ddd)',
            borderRadius: 8,
            padding: '0.75rem',
            minHeight: 280,
          }}
        >
          <h2 style={{ fontSize: '1.05rem', marginBottom: '0.5rem' }}>Detail</h2>
          {detailLoading ? <p>Loading…</p> : null}
          {!detail && !detailLoading ? <p style={{ color: '#666' }}>Select a session.</p> : null}
          {detail ? (
            <div>
              <p style={{ fontSize: '0.9rem', marginBottom: '0.5rem' }}>
                Venue: {detail.venue ? `${detail.venue.name} (${detail.venue.city})` : '—'}
              </p>
              <p style={{ fontSize: '0.9rem', marginBottom: '0.75rem' }}>
                Opt-ins: {detail.counts.opt_ins} · Matches: {detail.counts.matches}
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginBottom: '1rem' }}>
                {detail.session.status === 'draft' ? (
                  <label style={{ fontSize: '0.85rem' }}>
                    Opt-in closes (local)
                    <input
                      type="datetime-local"
                      value={optInClosesLocal}
                      onChange={(e) => setOptInClosesLocal(e.target.value)}
                      style={{ display: 'block', width: '100%', marginTop: 4 }}
                    />
                  </label>
                ) : null}
                {detail.session.status === 'draft' ? (
                  <button
                    type="button"
                    className="admin-btn admin-btn-primary"
                    onClick={() => {
                      const iso = fromDateTimeLocalValue(optInClosesLocal)
                      if (!iso) {
                        setError('Set opt-in closes (local) before publish')
                        return
                      }
                      void patchSession(detail.session.id, { action: 'publish', opt_in_closes_at: iso })
                    }}
                  >
                    Publish (open opt-in)
                  </button>
                ) : null}
                {detail.session.status === 'open_opt_in' ? (
                  <>
                    <button type="button" className="admin-btn" onClick={() => void patchSession(detail.session.id, { action: 'record_sunday_blast' })}>
                      Record opt-in blast sent
                    </button>
                    <button type="button" className="admin-btn admin-btn-primary" onClick={() => void patchSession(detail.session.id, { action: 'close_opt_in' })}>
                      Close opt-in window
                    </button>
                  </>
                ) : null}
                {detail.session.status === 'opt_in_closed' ? (
                  <button type="button" className="admin-btn admin-btn-primary" onClick={() => void patchSession(detail.session.id, { action: 'run_matcher' })}>
                    Run matcher
                  </button>
                ) : null}
                {detail.session.status === 'matching_pending_review' ? (
                  <>
                    <button type="button" className="admin-btn" onClick={() => void patchSession(detail.session.id, { action: 'approve_all_matches' })}>
                      Approve all pending
                    </button>
                    <button type="button" className="admin-btn admin-btn-primary" onClick={() => void patchSession(detail.session.id, { action: 'mark_intro_ready' })}>
                      Mark intro send ready
                    </button>
                  </>
                ) : null}
                {detail.session.status === 'intro_send_ready' ? (
                  <button type="button" className="admin-btn admin-btn-primary" onClick={() => void patchSession(detail.session.id, { action: 'mark_intro_sent' })}>
                    Mark intro SMS sent (manual)
                  </button>
                ) : null}
                {detail.session.status === 'intro_sms_sent' ? (
                  <button type="button" className="admin-btn" onClick={() => void patchSession(detail.session.id, { action: 'complete' })}>
                    Mark completed
                  </button>
                ) : null}
                {['draft', 'open_opt_in', 'opt_in_closed', 'matching_pending_review', 'intro_send_ready'].includes(detail.session.status) ? (
                  <button type="button" className="admin-btn" style={{ marginTop: '0.5rem' }} onClick={() => void patchSession(detail.session.id, { action: 'cancel' })}>
                    Cancel session
                  </button>
                ) : null}
              </div>

              {detail.matches.length > 0 ? (
                <table style={{ width: '100%', fontSize: '0.85rem', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: '4px 0' }}>Pair</th>
                      <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: '4px 0' }}>Approval</th>
                      <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: '4px 0' }} />
                    </tr>
                  </thead>
                  <tbody>
                    {detail.matches.map((m) => (
                      <tr key={m.id}>
                        <td style={{ padding: '4px 0', wordBreak: 'break-all' }}>
                          {m.user_a.slice(0, 8)}… / {m.user_b.slice(0, 8)}…
                        </td>
                        <td style={{ padding: '4px 0' }}>{m.admin_approval_status}</td>
                        <td style={{ padding: '4px 0' }}>
                          {m.admin_approval_status === 'pending' ? (
                            <span style={{ display: 'inline-flex', gap: 4 }}>
                              <button
                                type="button"
                                className="admin-btn"
                                style={{ fontSize: '0.75rem', padding: '2px 6px' }}
                                onClick={() => void patchSession(detail.session.id, { action: 'approve_match', match_id: m.id })}
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                className="admin-btn"
                                style={{ fontSize: '0.75rem', padding: '2px 6px' }}
                                onClick={() => void patchSession(detail.session.id, { action: 'reject_match', match_id: m.id })}
                              >
                                Reject
                              </button>
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>
    </main>
  )
}
