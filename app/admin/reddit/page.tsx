'use client'

import { useState, useEffect, useCallback } from 'react'
import { getSupabase } from '@/lib/supabase'

// ── Types ──────────────────────────────────────────────────────────────────

type Subreddit = {
  id: string
  name: string
  subscriber_count: number | null
  active_user_count: number | null
  posts_per_day: number | null
  keyword_hits: number | null
  category: 'la_local' | 'interest_topic' | null
  relevance_score: number | null
  status: 'candidate' | 'watchlist' | 'active' | 'ignored'
  notes: string | null
  last_scored_at: string | null
}

type RedditMatch = {
  id: string
  subreddit_id: string
  reddit_post_id: string
  title: string
  url: string
  author: string | null
  body_snippet: string | null
  matched_keywords: string[] | null
  posted_at: string | null
  draft_text: string | null
  edited_text: string | null
  model: string | null
  status: 'pending_review' | 'approved' | 'posted' | 'rejected'
  post_error: string | null
  posted_comment_id: string | null
  created_at: string
  reddit_subreddits: { name: string } | null
}

// ── Auth helper ────────────────────────────────────────────────────────────

async function authHeaders(): Promise<HeadersInit> {
  const supabase = getSupabase()
  const { data: { session } } = await supabase?.auth.getSession() ?? { data: { session: null } }
  const h: HeadersInit = { 'Content-Type': 'application/json' }
  if (session?.access_token) h['Authorization'] = `Bearer ${session.access_token}`
  return h
}

// ── Status badge ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    candidate: '#888 / #555',
    watchlist: '#b07d00 / #3d2900',
    active: '#1a7f37 / #0a3018',
    ignored: '#aaa / #444',
    pending_review: '#b07d00 / #3d2900',
    approved: '#1a7f37 / #0a3018',
    posted: '#0066cc / #003366',
    rejected: '#cc2222 / #330000',
  }
  const styleMap: Record<string, React.CSSProperties> = {
    candidate: { background: '#f0f0f0', color: '#555', border: '1px solid #ccc' },
    watchlist: { background: '#fff8e1', color: '#8a6200', border: '1px solid #f0d060' },
    active: { background: '#e6f4ea', color: '#1a7f37', border: '1px solid #a8d5b0' },
    ignored: { background: '#f5f5f5', color: '#999', border: '1px solid #ddd' },
    pending_review: { background: '#fff8e1', color: '#8a6200', border: '1px solid #f0d060' },
    approved: { background: '#e6f4ea', color: '#1a7f37', border: '1px solid #a8d5b0' },
    posted: { background: '#e8f0fe', color: '#1a57cc', border: '1px solid #a0b8f0' },
    rejected: { background: '#fce8e8', color: '#cc2222', border: '1px solid #f0a0a0' },
  }
  void colors
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, borderRadius: 4, padding: '2px 7px',
      letterSpacing: '.02em', textTransform: 'uppercase',
      ...styleMap[status] ?? { background: '#eee', color: '#666', border: '1px solid #ccc' },
    }}>
      {status.replace('_', ' ')}
    </span>
  )
}

// ── Subreddits Tab ─────────────────────────────────────────────────────────

function SubredditsTab() {
  const [subs, setSubs] = useState<Subreddit[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [editNotes, setEditNotes] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const h = await authHeaders()
      const res = await fetch('/api/admin/reddit/subreddits', { credentials: 'include', headers: h })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed')
      setSubs(data.subreddits ?? [])
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function updateSub(id: string, patch: { status?: string; notes?: string }) {
    setSaving(id)
    try {
      const h = await authHeaders()
      const res = await fetch(`/api/admin/reddit/subreddits/${id}`, {
        method: 'PATCH', credentials: 'include', headers: h, body: JSON.stringify(patch),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed')
      setSubs(prev => prev.map(s => s.id === id ? { ...s, ...data.subreddit } : s))
    } catch (e) {
      alert(`Error: ${e}`)
    } finally {
      setSaving(null)
    }
  }

  if (loading) return <p style={{ color: '#888', padding: 24 }}>Loading subreddits…</p>
  if (error) return <p style={{ color: 'red', padding: 24 }}>Error: {error}</p>
  if (subs.length === 0) return (
    <p style={{ color: '#888', padding: 24 }}>
      No subreddits yet. Run <code>reddit-discover-subreddits</code> from the Edge Functions dashboard.
    </p>
  )

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: '2px solid var(--border)', textAlign: 'left' }}>
            {['Subreddit', 'Subscribers', 'Posts/day', 'Kw hits', 'Score', 'Category', 'Status', 'Notes', ''].map(h => (
              <th key={h} style={{ padding: '8px 12px', fontWeight: 600, whiteSpace: 'nowrap', color: 'var(--muted)' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {subs.map(sub => (
            <tr key={sub.id} style={{ borderBottom: '1px solid var(--border)' }}>
              <td style={{ padding: '8px 12px' }}>
                <a href={`https://reddit.com/r/${sub.name}`} target="_blank" rel="noopener noreferrer"
                  style={{ fontWeight: 600, color: 'var(--link)', textDecoration: 'none' }}>
                  r/{sub.name}
                </a>
              </td>
              <td style={{ padding: '8px 12px', fontVariantNumeric: 'tabular-nums' }}>
                {sub.subscriber_count?.toLocaleString() ?? '—'}
              </td>
              <td style={{ padding: '8px 12px', fontVariantNumeric: 'tabular-nums' }}>
                {sub.posts_per_day != null ? sub.posts_per_day.toFixed(1) : '—'}
              </td>
              <td style={{ padding: '8px 12px', fontVariantNumeric: 'tabular-nums' }}>
                {sub.keyword_hits ?? '—'}
              </td>
              <td style={{ padding: '8px 12px', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                {sub.relevance_score ?? '—'}
              </td>
              <td style={{ padding: '8px 12px', color: 'var(--muted)', fontSize: 12 }}>
                {sub.category === 'la_local' ? 'LA local' : 'Interest'}
              </td>
              <td style={{ padding: '8px 12px' }}>
                <select
                  value={sub.status}
                  disabled={saving === sub.id}
                  onChange={e => updateSub(sub.id, { status: e.target.value })}
                  style={{ fontSize: 12, padding: '3px 6px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--fg)', cursor: 'pointer' }}
                >
                  <option value="candidate">candidate</option>
                  <option value="watchlist">watchlist</option>
                  <option value="active">active</option>
                  <option value="ignored">ignored</option>
                </select>
              </td>
              <td style={{ padding: '8px 12px' }}>
                <input
                  type="text"
                  placeholder="Notes…"
                  value={editNotes[sub.id] ?? sub.notes ?? ''}
                  onChange={e => setEditNotes(prev => ({ ...prev, [sub.id]: e.target.value }))}
                  onBlur={() => {
                    const n = editNotes[sub.id]
                    if (n !== undefined && n !== (sub.notes ?? '')) updateSub(sub.id, { notes: n })
                  }}
                  style={{ fontSize: 12, padding: '3px 6px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--fg)', width: 180 }}
                />
              </td>
              <td style={{ padding: '8px 12px', color: 'var(--muted)', fontSize: 11 }}>
                {saving === sub.id ? 'Saving…' : sub.last_scored_at ? new Date(sub.last_scored_at).toLocaleDateString() : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Drafts / Review Queue Tab ──────────────────────────────────────────────

function DraftsTab() {
  const [matches, setMatches] = useState<RedditMatch[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState('pending_review')
  const [editTexts, setEditTexts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<Record<string, boolean>>({})

  const load = useCallback(async (filter: string) => {
    setLoading(true)
    setError(null)
    try {
      const h = await authHeaders()
      const url = `/api/admin/reddit/matches${filter ? `?status=${filter}` : ''}`
      const res = await fetch(url, { credentials: 'include', headers: h })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed')
      setMatches(data.matches ?? [])
      setEditTexts({})
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(statusFilter) }, [load, statusFilter])

  async function saveEdit(id: string) {
    const text = editTexts[id]
    if (text === undefined) return
    setBusy(prev => ({ ...prev, [id]: true }))
    try {
      const h = await authHeaders()
      const res = await fetch(`/api/admin/reddit/matches/${id}`, {
        method: 'PATCH', credentials: 'include', headers: h, body: JSON.stringify({ edited_text: text }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed')
      setMatches(prev => prev.map(m => m.id === id ? { ...m, edited_text: text } : m))
      setEditTexts(prev => { const n = { ...prev }; delete n[id]; return n })
    } catch (e) { alert(`Error saving: ${e}`) }
    finally { setBusy(prev => ({ ...prev, [id]: false })) }
  }

  async function reject(id: string) {
    if (!confirm('Reject this draft?')) return
    setBusy(prev => ({ ...prev, [id]: true }))
    try {
      const h = await authHeaders()
      const res = await fetch(`/api/admin/reddit/matches/${id}`, {
        method: 'PATCH', credentials: 'include', headers: h, body: JSON.stringify({ status: 'rejected' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed')
      setMatches(prev => prev.filter(m => m.id !== id))
    } catch (e) { alert(`Error: ${e}`) }
    finally { setBusy(prev => ({ ...prev, [id]: false })) }
  }

  async function approve(id: string, match: RedditMatch) {
    const displayText = editTexts[id] ?? match.edited_text ?? match.draft_text ?? ''
    if (!confirm(`Post this comment to r/${match.reddit_subreddits?.name ?? '?'}?\n\n"${displayText.slice(0, 200)}"`)) return
    setBusy(prev => ({ ...prev, [id]: true }))
    try {
      // Save edit first if pending
      if (editTexts[id] !== undefined) {
        const h = await authHeaders()
        await fetch(`/api/admin/reddit/matches/${id}`, {
          method: 'PATCH', credentials: 'include', headers: h, body: JSON.stringify({ edited_text: editTexts[id] }),
        })
      }
      const h = await authHeaders()
      const res = await fetch(`/api/admin/reddit/matches/${id}/approve`, {
        method: 'POST', credentials: 'include', headers: h,
      })
      const data = await res.json() as { ok?: boolean; commentId?: string; error?: string; detail?: string }
      if (!res.ok || !data.ok) throw new Error(data.error ?? data.detail ?? 'Post failed')
      alert(`Posted! Comment ID: ${data.commentId}`)
      setMatches(prev => prev.filter(m => m.id !== id))
    } catch (e) { alert(`Error: ${e}`) }
    finally { setBusy(prev => ({ ...prev, [id]: false })) }
  }

  const filterOptions = [
    { value: 'pending_review', label: 'Pending review' },
    { value: 'approved', label: 'Approved' },
    { value: 'posted', label: 'Posted' },
    { value: 'rejected', label: 'Rejected' },
    { value: '', label: 'All' },
  ]

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, alignItems: 'center' }}>
        <span style={{ color: 'var(--muted)', fontSize: 13 }}>Filter:</span>
        {filterOptions.map(opt => (
          <button key={opt.value} onClick={() => setStatusFilter(opt.value)}
            style={{
              fontSize: 12, padding: '4px 10px', borderRadius: 4, cursor: 'pointer',
              border: '1px solid var(--border)',
              background: statusFilter === opt.value ? 'var(--fg)' : 'var(--bg)',
              color: statusFilter === opt.value ? 'var(--bg)' : 'var(--fg)',
              fontWeight: statusFilter === opt.value ? 700 : 400,
            }}>
            {opt.label}
          </button>
        ))}
      </div>

      {loading && <p style={{ color: '#888' }}>Loading…</p>}
      {error && <p style={{ color: 'red' }}>Error: {error}</p>}
      {!loading && matches.length === 0 && (
        <p style={{ color: '#888' }}>No matches with status "{statusFilter || 'any'}".</p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {matches.map(match => {
          const currentText = editTexts[match.id] ?? match.edited_text ?? match.draft_text ?? ''
          const isDirty = editTexts[match.id] !== undefined && editTexts[match.id] !== (match.edited_text ?? match.draft_text ?? '')
          const isBusy = busy[match.id] ?? false

          return (
            <div key={match.id} style={{
              border: '1px solid var(--border)', borderRadius: 8, padding: 16,
              background: 'var(--card-bg)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 10 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>
                      r/{match.reddit_subreddits?.name ?? match.subreddit_id}
                    </span>
                    <span style={{ color: 'var(--border)' }}>·</span>
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>u/{match.author ?? '?'}</span>
                    {match.posted_at && (
                      <>
                        <span style={{ color: 'var(--border)' }}>·</span>
                        <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                          {new Date(match.posted_at).toLocaleDateString()}
                        </span>
                      </>
                    )}
                    <StatusBadge status={match.status} />
                  </div>
                  <a href={match.url} target="_blank" rel="noopener noreferrer"
                    style={{ fontWeight: 600, fontSize: 14, color: 'var(--link)', textDecoration: 'none' }}>
                    {match.title}
                  </a>
                  {match.body_snippet && (
                    <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4, marginBottom: 0 }}>
                      {match.body_snippet.slice(0, 200)}…
                    </p>
                  )}
                  {match.matched_keywords && match.matched_keywords.length > 0 && (
                    <div style={{ marginTop: 6, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {match.matched_keywords.map(kw => (
                        <span key={kw} style={{ fontSize: 11, padding: '1px 6px', borderRadius: 3, background: 'var(--tag-bg)', color: 'var(--tag-fg)', border: '1px solid var(--border)' }}>
                          {kw}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {match.post_error && (
                <div style={{ fontSize: 12, color: '#cc2222', background: '#fce8e8', border: '1px solid #f0a0a0', borderRadius: 4, padding: '6px 10px', marginBottom: 10 }}>
                  Post error: {match.post_error}
                </div>
              )}

              {match.status !== 'posted' && (
                <>
                  <textarea
                    rows={4}
                    value={currentText}
                    onChange={e => setEditTexts(prev => ({ ...prev, [match.id]: e.target.value }))}
                    disabled={isBusy || match.status === 'rejected'}
                    style={{
                      width: '100%', fontSize: 13, lineHeight: 1.5, padding: '8px 10px',
                      border: `1px solid ${isDirty ? '#b07d00' : 'var(--border)'}`,
                      borderRadius: 6, background: 'var(--bg)', color: 'var(--fg)',
                      resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit',
                    }}
                  />
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    {match.status === 'pending_review' && (
                      <>
                        <button
                          onClick={() => saveEdit(match.id)}
                          disabled={!isDirty || isBusy}
                          style={{ fontSize: 12, padding: '5px 12px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--fg)', cursor: isDirty && !isBusy ? 'pointer' : 'not-allowed', opacity: isDirty && !isBusy ? 1 : 0.5 }}>
                          {isBusy ? 'Saving…' : 'Save edit'}
                        </button>
                        <button
                          onClick={() => approve(match.id, match)}
                          disabled={isBusy}
                          style={{ fontSize: 12, padding: '5px 14px', borderRadius: 4, border: 'none', background: '#1a7f37', color: '#fff', cursor: isBusy ? 'not-allowed' : 'pointer', fontWeight: 600 }}>
                          {isBusy ? 'Posting…' : 'Approve & Post'}
                        </button>
                        <button
                          onClick={() => reject(match.id)}
                          disabled={isBusy}
                          style={{ fontSize: 12, padding: '5px 12px', borderRadius: 4, border: '1px solid #f0a0a0', background: 'transparent', color: '#cc2222', cursor: isBusy ? 'not-allowed' : 'pointer' }}>
                          Reject
                        </button>
                      </>
                    )}
                    {match.status === 'approved' && (
                      <span style={{ fontSize: 12, color: '#1a7f37', fontWeight: 600 }}>Approved — will be posted.</span>
                    )}
                  </div>
                </>
              )}

              {match.status === 'posted' && (
                <div style={{ fontSize: 13, color: 'var(--muted)', fontStyle: 'italic' }}>
                  Posted · Comment ID: {match.posted_comment_id ?? '—'}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function AdminRedditPage() {
  const [tab, setTab] = useState<'subreddits' | 'drafts'>('drafts')

  const tabStyle = (active: boolean): React.CSSProperties => ({
    fontSize: 14, fontWeight: 600, padding: '8px 18px', cursor: 'pointer',
    border: 'none', borderBottom: active ? '2px solid var(--fg)' : '2px solid transparent',
    background: 'transparent', color: active ? 'var(--fg)' : 'var(--muted)',
  })

  return (
    <div style={{
      maxWidth: 1100, margin: '0 auto', padding: '32px 24px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    }}>
      <style>{`
        :root {
          --bg: #ffffff;
          --fg: #111;
          --muted: #777;
          --border: #e0e0e0;
          --link: #0066cc;
          --card-bg: #fafafa;
          --tag-bg: #f0f0f0;
          --tag-fg: #555;
        }
        @media (prefers-color-scheme: dark) {
          :root:not([data-theme="light"]) {
            --bg: #111;
            --fg: #f0f0f0;
            --muted: #888;
            --border: #2e2e2e;
            --link: #5ba3ff;
            --card-bg: #1a1a1a;
            --tag-bg: #222;
            --tag-fg: #aaa;
          }
        }
        :root[data-theme="dark"] {
          --bg: #111;
          --fg: #f0f0f0;
          --muted: #888;
          --border: #2e2e2e;
          --link: #5ba3ff;
          --card-bg: #1a1a1a;
          --tag-bg: #222;
          --tag-fg: #aaa;
        }
        body { background: var(--bg); color: var(--fg); }
      `}</style>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Reddit Growth Agent</h1>
          <p style={{ fontSize: 13, color: 'var(--muted)', margin: '4px 0 0' }}>
            Discover subreddits · review drafts · approve & post
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 24 }}>
        <button style={tabStyle(tab === 'drafts')} onClick={() => setTab('drafts')}>Drafts</button>
        <button style={tabStyle(tab === 'subreddits')} onClick={() => setTab('subreddits')}>Subreddits</button>
      </div>

      {tab === 'drafts' && <DraftsTab />}
      {tab === 'subreddits' && <SubredditsTab />}
    </div>
  )
}
