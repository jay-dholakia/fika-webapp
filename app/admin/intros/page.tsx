'use client'

import { useCallback, useEffect, useState } from 'react'
import { getSupabase } from '@/lib/supabase'

// ── Types ──────────────────────────────────────────────────────────────────

type FeedbackInfo = { content: string; sentiment: string | null } | null

type UserInfo = {
  id: string
  name: string
  market: string | null
  smsState: string | null
  feedback: FeedbackInfo
}

type IntroRow = {
  id: string
  status: string
  createdAt: string
  userA: UserInfo
  userB: UserInfo
  venue: { name: string; neighborhood: string | null } | null
  eventStartsAt: string | null
}

type IntrosData = { active: IntroRow[]; completed: IntroRow[] }

type SimPair = {
  userAId: string
  userAName: string
  userAWorkLabel: string | null
  userBId: string
  userBName: string
  userBWorkLabel: string | null
  score: number
  llmReason: string
  userALastFeedback: FeedbackInfo
  userBLastFeedback: FeedbackInfo
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function authHeaders(): Promise<HeadersInit> {
  const supabase = getSupabase()
  const { data: { session } } = await supabase?.auth.getSession() ?? { data: { session: null } }
  const h: HeadersInit = { 'Content-Type': 'application/json' }
  if (session?.access_token) h['Authorization'] = `Bearer ${session.access_token}`
  return h
}

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  const d = new Date(ts)
  return isNaN(d.getTime()) ? ts : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtDateTime(ts: string | null) {
  if (!ts) return '—'
  const d = new Date(ts)
  return isNaN(d.getTime()) ? ts : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

const STATE_LABELS: Record<string, string> = {
  '1v1_offered': 'Offered',
  '1v1_accepted': 'Accepted',
  '1v1_awaiting_availability': 'Awaiting days',
  '1v1_proposed': 'Proposed',
  '1v1_confirmed': 'Confirmed',
  '1v1_morning_reminder': 'Day of',
  '1v1_feedback': 'Feedback',
}

const STATE_COLORS: Record<string, string> = {
  '1v1_offered': '#b45309',
  '1v1_accepted': '#1d4ed8',
  '1v1_awaiting_availability': '#92400e',
  '1v1_proposed': '#1d4ed8',
  '1v1_confirmed': '#065f46',
  '1v1_morning_reminder': '#065f46',
  '1v1_feedback': '#6b21a8',
}

const STATE_BG: Record<string, string> = {
  '1v1_offered': '#fef3c7',
  '1v1_accepted': '#dbeafe',
  '1v1_awaiting_availability': '#fde68a',
  '1v1_proposed': '#dbeafe',
  '1v1_confirmed': '#d1fae5',
  '1v1_morning_reminder': '#d1fae5',
  '1v1_feedback': '#ede9fe',
}

function StateChip({ state }: { state: string | null }) {
  if (!state) return <span style={{ color: '#999' }}>—</span>
  const label = STATE_LABELS[state] ?? state.replace('1v1_', '')
  const color = STATE_COLORS[state] ?? '#374151'
  const bg = STATE_BG[state] ?? '#f3f4f6'
  return (
    <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 99, color, background: bg, whiteSpace: 'nowrap' }}>
      {label}
    </span>
  )
}

function SentimentChip({ sentiment }: { sentiment: string | null | undefined }) {
  if (!sentiment) return null
  const map: Record<string, { label: string; color: string; bg: string }> = {
    positive: { label: 'Positive', color: '#065f46', bg: '#d1fae5' },
    neutral: { label: 'Neutral', color: '#374151', bg: '#f3f4f6' },
    negative: { label: 'Negative', color: '#991b1b', bg: '#fee2e2' },
  }
  const s = map[sentiment]
  if (!s) return null
  return (
    <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 99, color: s.color, background: s.bg }}>
      {s.label}
    </span>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────

export default function AdminIntrosPage() {
  const [data, setData] = useState<IntrosData | null>(null)
  const [loadingData, setLoadingData] = useState(true)
  const [dataError, setDataError] = useState<string | null>(null)

  // Simulator
  const [simOpen, setSimOpen] = useState(false)
  const [simMarket, setSimMarket] = useState('')
  const [simTopN, setSimTopN] = useState(30)
  const [simPairs, setSimPairs] = useState<SimPair[] | null>(null)
  const [simRunning, setSimRunning] = useState(false)
  const [simError, setSimError] = useState<string | null>(null)

  // Firing
  const [firingKey, setFiringKey] = useState<string | null>(null)
  const [fireMsg, setFireMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const loadData = useCallback(async () => {
    setLoadingData(true)
    setDataError(null)
    try {
      const res = await fetch('/api/admin/intros', { credentials: 'include', headers: await authHeaders() })
      if (res.status === 401) { window.location.href = '/login?next=/admin/intros'; return }
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed to load')
      setData(await res.json())
    } catch (e) {
      setDataError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoadingData(false)
    }
  }, [])

  useEffect(() => { void loadData() }, [loadData])

  async function runSim() {
    setSimRunning(true)
    setSimError(null)
    setSimPairs(null)
    try {
      const res = await fetch('/api/admin/match-sim', {
        method: 'POST',
        credentials: 'include',
        headers: await authHeaders(),
        body: JSON.stringify({ market: simMarket.trim() || undefined, topN: simTopN, maxUsers: 300 }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Sim failed')
      setSimPairs(json.pairs ?? [])
    } catch (e) {
      setSimError(e instanceof Error ? e.message : 'Sim failed')
    } finally {
      setSimRunning(false)
    }
  }

  async function fireIntro(pair: SimPair) {
    const key = `${pair.userAId}:${pair.userBId}`
    if (!confirm(`Fire intro between ${pair.userAName} and ${pair.userBName}?`)) return
    setFiringKey(key)
    setFireMsg(null)
    try {
      const res = await fetch('/api/admin/matches', {
        method: 'POST',
        credentials: 'include',
        headers: await authHeaders(),
        body: JSON.stringify({ pairs: [{ user_a: pair.userAId, user_b: pair.userBId }] }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Fire failed')
      if (json.sent === 0 && json.skipped?.length > 0) {
        setFireMsg({ ok: false, text: `Skipped — ${json.skipped[0].reason}` })
      } else {
        setFireMsg({ ok: true, text: `Intro fired for ${pair.userAName} & ${pair.userBName}` })
        void loadData()
      }
    } catch (e) {
      setFireMsg({ ok: false, text: e instanceof Error ? e.message : 'Fire failed' })
    } finally {
      setFiringKey(null)
    }
  }

  return (
    <main className="admin-main">
      {/* ── Simulator ── */}
      <div className="admin-card" style={{ marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: simOpen ? '1rem' : 0 }}>
          <div>
            <h2 className="admin-title" style={{ marginBottom: 2 }}>Match Simulator</h2>
            {!simOpen && (
              <p style={{ margin: 0, fontSize: 13, color: '#666' }}>
                Score pairs with LLM and fire new intros
              </p>
            )}
          </div>
          <button
            onClick={() => setSimOpen((o) => !o)}
            className="admin-btn"
            style={{ fontSize: 13 }}
          >
            {simOpen ? 'Collapse' : 'Open'}
          </button>
        </div>

        {simOpen && (
          <>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.75rem', alignItems: 'flex-end' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <span style={{ fontWeight: 600, color: '#555' }}>Market</span>
                <input
                  className="auth-input"
                  value={simMarket}
                  onChange={(e) => setSimMarket(e.target.value)}
                  placeholder="all markets (or: la, sf, nyc)"
                  style={{ width: 220 }}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <span style={{ fontWeight: 600, color: '#555' }}>Top N pairs</span>
                <input
                  className="auth-input"
                  type="number"
                  value={simTopN}
                  onChange={(e) => setSimTopN(Math.max(5, Math.min(200, Number(e.target.value))))}
                  style={{ width: 80 }}
                />
              </label>
              <button
                className="admin-btn admin-btn-primary"
                onClick={runSim}
                disabled={simRunning}
                style={{ alignSelf: 'flex-end' }}
              >
                {simRunning ? 'Running…' : 'Run simulation'}
              </button>
            </div>

            {simError && <p className="admin-error admin-error-inline">{simError}</p>}
            {fireMsg && (
              <p style={{
                fontSize: 13,
                fontWeight: 600,
                color: fireMsg.ok ? '#065f46' : '#991b1b',
                background: fireMsg.ok ? '#d1fae5' : '#fee2e2',
                padding: '6px 12px',
                borderRadius: 6,
                marginBottom: '0.75rem',
              }}>
                {fireMsg.text}
              </p>
            )}

            {simPairs && (
              <div className="admin-table-wrap">
                <p style={{ fontSize: 12, color: '#999', marginBottom: '0.5rem' }}>
                  {simPairs.length} eligible pairs · LLM scored
                </p>
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th style={{ width: 52 }}>Score</th>
                      <th>Person A</th>
                      <th>Person B</th>
                      <th>Why</th>
                      <th>Last feedback</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {simPairs.map((p) => {
                      const key = `${p.userAId}:${p.userBId}`
                      return (
                        <tr key={key}>
                          <td style={{ fontWeight: 700, fontSize: 15, textAlign: 'center' }}>{p.score}</td>
                          <td>
                            <div style={{ fontWeight: 600 }}>{p.userAName}</div>
                            {p.userAWorkLabel && <div style={{ fontSize: 12, color: '#666' }}>{p.userAWorkLabel}</div>}
                          </td>
                          <td>
                            <div style={{ fontWeight: 600 }}>{p.userBName}</div>
                            {p.userBWorkLabel && <div style={{ fontSize: 12, color: '#666' }}>{p.userBWorkLabel}</div>}
                          </td>
                          <td style={{ fontSize: 12, color: '#555', maxWidth: 260 }}>{p.llmReason || '—'}</td>
                          <td style={{ fontSize: 12 }}>
                            {p.userALastFeedback && (
                              <div style={{ marginBottom: 2 }}>
                                <SentimentChip sentiment={p.userALastFeedback.sentiment} />
                                <span style={{ marginLeft: 4, color: '#666' }}>{p.userAName.split(' ')[0]}</span>
                              </div>
                            )}
                            {p.userBLastFeedback && (
                              <div>
                                <SentimentChip sentiment={p.userBLastFeedback.sentiment} />
                                <span style={{ marginLeft: 4, color: '#666' }}>{p.userBName.split(' ')[0]}</span>
                              </div>
                            )}
                            {!p.userALastFeedback && !p.userBLastFeedback && <span style={{ color: '#bbb' }}>—</span>}
                          </td>
                          <td>
                            <button
                              className="admin-btn admin-btn-primary"
                              style={{ fontSize: 12, padding: '4px 12px', whiteSpace: 'nowrap' }}
                              onClick={() => fireIntro(p)}
                              disabled={firingKey === key}
                            >
                              {firingKey === key ? '…' : 'Fire intro'}
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Active Intros ── */}
      <div className="admin-card" style={{ marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
          <h2 className="admin-title" style={{ marginBottom: 0 }}>
            Active Intros
            {data && <span style={{ fontSize: 14, fontWeight: 400, color: '#888', marginLeft: 8 }}>({data.active.length})</span>}
          </h2>
          <button className="admin-btn" style={{ fontSize: 13 }} onClick={loadData} disabled={loadingData}>
            {loadingData ? 'Loading…' : 'Refresh'}
          </button>
        </div>

        {dataError && <p className="admin-error admin-error-inline">{dataError}</p>}

        {loadingData ? (
          <div className="admin-loading">Loading…</div>
        ) : data?.active.length === 0 ? (
          <p style={{ color: '#888', fontSize: 14 }}>No active intros.</p>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Pair</th>
                  <th>Match status</th>
                  <th>A's state</th>
                  <th>B's state</th>
                  <th>Venue</th>
                  <th>Fika date</th>
                  <th>Started</th>
                </tr>
              </thead>
              <tbody>
                {(data?.active ?? []).map((r) => (
                  <tr key={r.id} style={r.status === 'scheduling_stalled' ? { background: '#fffbeb' } : undefined}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{r.userA.name} ↔ {r.userB.name}</div>
                      {r.userA.market && <div style={{ fontSize: 11, color: '#999' }}>{r.userA.market}</div>}
                    </td>
                    <td>
                      {r.status === 'scheduling_stalled' ? (
                        <span style={{ fontSize: 11, fontWeight: 600, color: '#92400e', background: '#fde68a', padding: '2px 8px', borderRadius: 99 }}>
                          Stalled
                        </span>
                      ) : (
                        <span style={{ fontSize: 11, color: '#065f46', background: '#d1fae5', fontWeight: 600, padding: '2px 8px', borderRadius: 99 }}>
                          Active
                        </span>
                      )}
                    </td>
                    <td><StateChip state={r.userA.smsState} /></td>
                    <td><StateChip state={r.userB.smsState} /></td>
                    <td style={{ fontSize: 13 }}>
                      {r.venue
                        ? [r.venue.name, r.venue.neighborhood].filter(Boolean).join(', ')
                        : <span style={{ color: '#bbb' }}>—</span>
                      }
                    </td>
                    <td style={{ fontSize: 13 }}>{fmtDateTime(r.eventStartsAt)}</td>
                    <td style={{ fontSize: 13, color: '#888' }}>{fmtDate(r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Completed Fikas ── */}
      <div className="admin-card">
        <h2 className="admin-title" style={{ marginBottom: '0.75rem' }}>
          Completed Fikas
          {data && <span style={{ fontSize: 14, fontWeight: 400, color: '#888', marginLeft: 8 }}>({data.completed.length})</span>}
        </h2>

        {!loadingData && data?.completed.length === 0 && (
          <p style={{ color: '#888', fontSize: 14 }}>No completed Fikas in the last 60 days.</p>
        )}

        {!loadingData && (data?.completed.length ?? 0) > 0 && (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Pair</th>
                  <th>Fika date</th>
                  <th>Feedback A</th>
                  <th>Feedback B</th>
                </tr>
              </thead>
              <tbody>
                {(data?.completed ?? []).map((r) => (
                  <tr key={r.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{r.userA.name} ↔ {r.userB.name}</div>
                      {r.userA.market && <div style={{ fontSize: 11, color: '#999' }}>{r.userA.market}</div>}
                    </td>
                    <td style={{ fontSize: 13 }}>{fmtDateTime(r.eventStartsAt)}</td>
                    <td style={{ fontSize: 13 }}>
                      {r.userA.feedback
                        ? (
                          <>
                            <SentimentChip sentiment={r.userA.feedback.sentiment} />
                            <div style={{ fontSize: 12, color: '#555', marginTop: 2, maxWidth: 200 }}>{r.userA.feedback.content}</div>
                          </>
                        )
                        : <span style={{ color: '#bbb' }}>—</span>
                      }
                    </td>
                    <td style={{ fontSize: 13 }}>
                      {r.userB.feedback
                        ? (
                          <>
                            <SentimentChip sentiment={r.userB.feedback.sentiment} />
                            <div style={{ fontSize: 12, color: '#555', marginTop: 2, maxWidth: 200 }}>{r.userB.feedback.content}</div>
                          </>
                        )
                        : <span style={{ color: '#bbb' }}>—</span>
                      }
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
