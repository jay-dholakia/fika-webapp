'use client'

import { useEffect, useMemo, useState } from 'react'
import { getSupabase } from '@/lib/supabase'

type EventRow = {
  id: string
  source: string
  source_post_url: string | null
  source_post_title: string | null
  raw_event_text: string | null
  title: string | null
  description_short: string | null
  starts_at: string | null
  ends_at: string | null
  venue_name: string | null
  neighborhood: string | null
  event_url: string | null
  category: string | null
  tags: string[]
  confidence: number | null
  status: 'draft' | 'approved' | 'rejected' | 'expired'
  review_notes: string | null
  created_at: string
  updated_at: string
}

type ApiResponse = {
  events: EventRow[]
  summary: {
    returned: number
    status: string | null
    source: string | null
    q: string | null
    limit: number
  }
}

type EventEditDraft = {
  title: string
  starts_at: string
  venue_name: string
  neighborhood: string
  category: string
  event_url: string
  review_notes: string
  description_short: string
}

function fmt(ts: string | null): string {
  if (!ts) return '—'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ts
  return d.toLocaleString()
}

function toDateTimeLocalValue(ts: string | null): string {
  if (!ts) return ''
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function buildDraft(row: EventRow): EventEditDraft {
  return {
    title: row.title ?? '',
    starts_at: toDateTimeLocalValue(row.starts_at),
    venue_name: row.venue_name ?? '',
    neighborhood: row.neighborhood ?? '',
    category: row.category ?? '',
    event_url: row.event_url ?? '',
    review_notes: row.review_notes ?? '',
    description_short: row.description_short ?? '',
  }
}

export default function AdminEventsPage() {
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<ApiResponse | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, EventEditDraft>>({})
  const [status, setStatus] = useState('draft')
  const [source, setSource] = useState('')
  const [q, setQ] = useState('')
  const [newTitle, setNewTitle] = useState('')
  const [newCategory, setNewCategory] = useState('')
  const [newVenue, setNewVenue] = useState('')
  const [newUrl, setNewUrl] = useState('')
  const [newNotes, setNewNotes] = useState('')

  const sourceOptions = useMemo(() => {
    const set = new Set<string>()
    for (const row of data?.events ?? []) set.add(row.source)
    return Array.from(set).sort()
  }, [data?.events])

  async function getAuthHeaders(): Promise<HeadersInit> {
    const supabase = getSupabase()
    const { data: { session } } = await supabase?.auth.getSession() ?? { data: { session: null } }
    const headers: HeadersInit = { 'Content-Type': 'application/json' }
    if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`
    return headers
  }

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      params.set('limit', '200')
      if (status) params.set('status', status)
      if (source) params.set('source', source)
      if (q.trim()) params.set('q', q.trim())
      const res = await fetch(`/api/admin/events?${params.toString()}`, {
        credentials: 'include',
        headers: await getAuthHeaders(),
      })
      const json = await res.json().catch(() => ({} as ApiResponse))
      if (res.status === 403 && (json as any)?.code === 'NOT_ADMIN') {
        window.location.href = '/login?next=/admin/events'
        return
      }
      if (!res.ok) throw new Error((json as any)?.error ?? 'Failed to load')
      setData(json as ApiResponse)
      setDrafts(Object.fromEntries(((json as ApiResponse).events ?? []).map((row) => [row.id, buildDraft(row)])))
      setEditingId(null)
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

  async function updateEvent(eventId: string, patch: Record<string, unknown>) {
    setSavingId(eventId)
    setError(null)
    try {
      const res = await fetch(`/api/admin/events/${encodeURIComponent(eventId)}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: await getAuthHeaders(),
        body: JSON.stringify(patch),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error ?? 'Failed to update')
      setData((prev) => prev
        ? { ...prev, events: prev.events.map((row) => row.id === eventId ? json.event as EventRow : row) }
        : prev)
      setDrafts((prev) => ({ ...prev, [eventId]: buildDraft(json.event as EventRow) }))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update')
    } finally {
      setSavingId(null)
    }
  }

  function beginEdit(row: EventRow) {
    setEditingId(row.id)
    setDrafts((prev) => ({ ...prev, [row.id]: prev[row.id] ?? buildDraft(row) }))
  }

  function cancelEdit(row: EventRow) {
    setEditingId((current) => current === row.id ? null : current)
    setDrafts((prev) => ({ ...prev, [row.id]: buildDraft(row) }))
  }

  function updateDraft(eventId: string, key: keyof EventEditDraft, value: string) {
    setDrafts((prev) => ({
      ...prev,
      [eventId]: {
        ...(prev[eventId] ?? {
          title: '',
          starts_at: '',
          venue_name: '',
          neighborhood: '',
          category: '',
          event_url: '',
          review_notes: '',
          description_short: '',
        }),
        [key]: value,
      },
    }))
  }

  async function saveDraft(row: EventRow, nextStatus?: EventRow['status']) {
    const draft = drafts[row.id] ?? buildDraft(row)
    await updateEvent(row.id, {
      title: draft.title,
      starts_at: draft.starts_at ? new Date(draft.starts_at).toISOString() : null,
      venue_name: draft.venue_name,
      neighborhood: draft.neighborhood,
      category: draft.category,
      event_url: draft.event_url,
      review_notes: draft.review_notes,
      description_short: draft.description_short,
      ...(nextStatus ? { status: nextStatus } : {}),
    })
    if (!nextStatus) setEditingId((current) => current === row.id ? null : current)
  }

  async function createManualDraft() {
    setSavingId('new')
    setError(null)
    try {
      const res = await fetch('/api/admin/events', {
        method: 'POST',
        credentials: 'include',
        headers: await getAuthHeaders(),
        body: JSON.stringify({
          source: 'manual',
          title: newTitle,
          category: newCategory || null,
          venue_name: newVenue || null,
          event_url: newUrl || null,
          review_notes: newNotes || null,
          status: 'draft',
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error ?? 'Failed to create')
      setNewTitle('')
      setNewCategory('')
      setNewVenue('')
      setNewUrl('')
      setNewNotes('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create')
    } finally {
      setSavingId(null)
    }
  }

  return (
    <main className="admin-main">
      <div className="admin-card">
        <h1 className="admin-title">Events</h1>
        <p className="admin-description">
          Human-reviewed event queue for SMS recommendations. Only approved events should be surfaced to users.
        </p>

        <div style={{ display: 'grid', gap: '0.75rem', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <select className="auth-input" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
              <option value="">All statuses</option>
              <option value="draft">draft</option>
              <option value="approved">approved</option>
              <option value="rejected">rejected</option>
              <option value="expired">expired</option>
            </select>
            <select className="auth-input" value={source} onChange={(e) => setSource(e.target.value)} aria-label="Source">
              <option value="">All sources</option>
              {sourceOptions.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
            <input
              className="auth-input"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search title, venue, source post"
              aria-label="Search"
              style={{ minWidth: 260 }}
            />
            <button type="button" className="admin-btn admin-btn-primary" onClick={load} disabled={loading}>
              {loading ? 'Loading…' : 'Refresh'}
            </button>
          </div>

          <div style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            <input className="auth-input" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Manual event title" />
            <input className="auth-input" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="Category" />
            <input className="auth-input" value={newVenue} onChange={(e) => setNewVenue(e.target.value)} placeholder="Venue" />
            <input className="auth-input" value={newUrl} onChange={(e) => setNewUrl(e.target.value)} placeholder="Event URL" />
          </div>
          <textarea
            className="auth-input"
            value={newNotes}
            onChange={(e) => setNewNotes(e.target.value)}
            placeholder="Optional review notes"
            rows={3}
          />
          <div>
            <button
              type="button"
              className="admin-btn admin-btn-primary"
              disabled={savingId === 'new' || !newTitle.trim()}
              onClick={createManualDraft}
            >
              {savingId === 'new' ? 'Creating…' : 'Create Manual Draft'}
            </button>
          </div>
        </div>

        {error && <p className="admin-error admin-error-inline" role="alert">{error}</p>}

        {data && (
          <p className="admin-modal-meta">
            Showing <strong>{data.summary.returned}</strong> events
          </p>
        )}

        {loading ? (
          <div className="admin-loading">Loading…</div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>When</th>
                  <th>Event</th>
                  <th>Source</th>
                  <th>Category</th>
                  <th>Notes</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {(data?.events ?? []).map((row) => (
                  <tr key={row.id}>
                    <td>{row.status}</td>
                    <td>
                      {editingId === row.id ? (
                        <input
                          className="auth-input"
                          type="datetime-local"
                          value={drafts[row.id]?.starts_at ?? ''}
                          onChange={(e) => updateDraft(row.id, 'starts_at', e.target.value)}
                        />
                      ) : fmt(row.starts_at)}
                    </td>
                    <td>
                      {editingId === row.id ? (
                        <div style={{ display: 'grid', gap: 8, minWidth: 280 }}>
                          <input
                            className="auth-input"
                            value={drafts[row.id]?.title ?? ''}
                            onChange={(e) => updateDraft(row.id, 'title', e.target.value)}
                            placeholder="Title"
                          />
                          <input
                            className="auth-input"
                            value={drafts[row.id]?.venue_name ?? ''}
                            onChange={(e) => updateDraft(row.id, 'venue_name', e.target.value)}
                            placeholder="Venue"
                          />
                          <input
                            className="auth-input"
                            value={drafts[row.id]?.neighborhood ?? ''}
                            onChange={(e) => updateDraft(row.id, 'neighborhood', e.target.value)}
                            placeholder="Neighborhood"
                          />
                          <input
                            className="auth-input"
                            value={drafts[row.id]?.event_url ?? ''}
                            onChange={(e) => updateDraft(row.id, 'event_url', e.target.value)}
                            placeholder="Event URL"
                          />
                          <textarea
                            className="auth-input"
                            rows={3}
                            value={drafts[row.id]?.description_short ?? ''}
                            onChange={(e) => updateDraft(row.id, 'description_short', e.target.value)}
                            placeholder="Short description"
                          />
                        </div>
                      ) : (
                        <>
                          <div><strong>{row.title ?? 'Untitled draft'}</strong></div>
                          <div>{row.venue_name ?? '—'} {row.neighborhood ? `· ${row.neighborhood}` : ''}</div>
                          {row.event_url ? (
                            <div><a href={row.event_url} target="_blank" rel="noreferrer">{row.event_url}</a></div>
                          ) : null}
                          {row.description_short ? <div style={{ marginTop: 6 }}>{row.description_short}</div> : null}
                        </>
                      )}
                    </td>
                    <td>
                      <div>{row.source}</div>
                      {row.source_post_title ? <div>{row.source_post_title}</div> : null}
                    </td>
                    <td>
                      {editingId === row.id ? (
                        <input
                          className="auth-input"
                          value={drafts[row.id]?.category ?? ''}
                          onChange={(e) => updateDraft(row.id, 'category', e.target.value)}
                          placeholder="Category"
                        />
                      ) : (row.category ?? '—')}
                    </td>
                    <td>
                      {editingId === row.id ? (
                        <textarea
                          className="auth-input"
                          rows={3}
                          value={drafts[row.id]?.review_notes ?? ''}
                          onChange={(e) => updateDraft(row.id, 'review_notes', e.target.value)}
                          placeholder="Review notes"
                        />
                      ) : (row.review_notes ?? '—')}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {editingId === row.id ? (
                          <>
                            <button
                              type="button"
                              className="admin-btn admin-btn-primary"
                              disabled={savingId === row.id}
                              onClick={() => saveDraft(row)}
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              className="admin-btn admin-btn-primary"
                              disabled={savingId === row.id}
                              onClick={() => saveDraft(row, 'approved')}
                            >
                              Save + Approve
                            </button>
                            <button
                              type="button"
                              className="admin-btn"
                              disabled={savingId === row.id}
                              onClick={() => saveDraft(row, 'rejected')}
                            >
                              Save + Reject
                            </button>
                            <button
                              type="button"
                              className="admin-btn"
                              disabled={savingId === row.id}
                              onClick={() => cancelEdit(row)}
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="admin-btn"
                              disabled={savingId === row.id}
                              onClick={() => beginEdit(row)}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="admin-btn admin-btn-primary"
                              disabled={savingId === row.id || row.status === 'approved'}
                              onClick={() => updateEvent(row.id, { status: 'approved' })}
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              className="admin-btn"
                              disabled={savingId === row.id || row.status === 'rejected'}
                              onClick={() => updateEvent(row.id, { status: 'rejected' })}
                            >
                              Reject
                            </button>
                            <button
                              type="button"
                              className="admin-btn"
                              disabled={savingId === row.id || row.status === 'draft'}
                              onClick={() => updateEvent(row.id, { status: 'draft' })}
                            >
                              Reset
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  )
}
