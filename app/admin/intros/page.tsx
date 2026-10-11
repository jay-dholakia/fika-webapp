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
  userAAge: number | null
  userAPronouns: string | null
  userAGender: string | null
  userAWorkLabel: string | null
  userACity: string | null
  userAAvatar: string | null
  userBId: string
  userBName: string
  userBAge: number | null
  userBPronouns: string | null
  userBGender: string | null
  userBWorkLabel: string | null
  userBCity: string | null
  userBAvatar: string | null
  score: number
  llmReason: string
  overlapInterests: string[]
  overlapGreatFika: string[]
  overlapLikeTalkingAbout?: string[]
  likeTalkingAboutA: string | null
  likeTalkingAboutB: string | null
  userALastFeedback: FeedbackInfo
  userBLastFeedback: FeedbackInfo
  projectedVenue: { id: string; name: string; neighborhood: string | null; city: string } | null
  projectedQuestions: { qForA: string; qForB: string } | null
  introMessages: { messageForA: string; messageForB: string } | null
  aiSharedTopics: string[]
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

function AvatarThumb({ url, name, onExpand }: { url: string | null; name: string; onExpand: (url: string) => void }) {
  if (!url) return null
  return (
    <img
      src={url}
      alt={name}
      title={`View ${name}'s photo`}
      onClick={() => onExpand(url)}
      style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover', cursor: 'pointer', marginRight: 6, flexShrink: 0, border: '1.5px solid #e5e7eb', verticalAlign: 'middle' }}
    />
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
  const [tab, setTab] = useState<'sim' | 'active' | 'completed'>('sim')
  const [data, setData] = useState<IntrosData | null>(null)
  const [loadingData, setLoadingData] = useState(true)
  const [dataError, setDataError] = useState<string | null>(null)

  // Simulator
  const [simOpen, setSimOpen] = useState(false)
  const [simMarket, setSimMarket] = useState('')
  const [simTopN, setSimTopN] = useState(100)
  const [simPairs, setSimPairs] = useState<SimPair[] | null>(null)
  const [simRunning, setSimRunning] = useState(false)
  const [simError, setSimError] = useState<string | null>(null)

  // Manual pair
  type UserOption = { id: string; first_name: string | null; market: string | null; city: string | null }
  const [allUsers, setAllUsers] = useState<UserOption[] | null>(null)
  const [manualQueryA, setManualQueryA] = useState('')
  const [manualQueryB, setManualQueryB] = useState('')
  const [manualUserA, setManualUserA] = useState<UserOption | null>(null)
  const [manualUserB, setManualUserB] = useState<UserOption | null>(null)
  const [manualDropdownA, setManualDropdownA] = useState(false)
  const [manualDropdownB, setManualDropdownB] = useState(false)
  const [manualPair, setManualPair] = useState<SimPair | null>(null)
  const [manualRunning, setManualRunning] = useState(false)
  const [manualError, setManualError] = useState<string | null>(null)

  const loadAllUsers = useCallback(async () => {
    if (allUsers !== null) return
    const res = await fetch('/api/admin/users', { credentials: 'include', headers: await authHeaders() })
    if (res.ok) setAllUsers((await res.json()).users ?? [])
  }, [allUsers])

  const filteredUsers = (query: string) => {
    if (!allUsers || query.trim().length < 1) return []
    const q = query.toLowerCase()
    return allUsers.filter(u => (u.first_name ?? '').toLowerCase().includes(q)).slice(0, 8)
  }

  async function runManualPair() {
    if (!manualUserA || !manualUserB) return

    // If this pair already exists in the regular sim results, reuse it — same messages, no extra LLM call
    const existing = simPairs?.find(p =>
      (p.userAId === manualUserA.id && p.userBId === manualUserB.id) ||
      (p.userAId === manualUserB.id && p.userBId === manualUserA.id)
    )
    if (existing) {
      setManualPair(existing)
      return
    }

    setManualRunning(true)
    setManualError(null)
    setManualPair(null)
    try {
      const res = await fetch('/api/admin/match-sim', {
        method: 'POST',
        credentials: 'include',
        headers: await authHeaders(),
        body: JSON.stringify({ manual_pair: { user_a_id: manualUserA.id, user_b_id: manualUserB.id } }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Preview failed')
      setManualPair(json.pairs?.[0] ?? null)
    } catch (e) {
      setManualError(e instanceof Error ? e.message : 'Preview failed')
    } finally {
      setManualRunning(false)
    }
  }

  // Avatar lightbox
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)

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
        body: JSON.stringify({
          pairs: [{
            user_a: pair.userAId,
            user_b: pair.userBId,
            pregenerated_questions: pair.projectedQuestions ?? undefined,
            pregenerated_copy: pair.introMessages ?? undefined,
            ai_shared_topics: pair.aiSharedTopics?.length ? pair.aiSharedTopics : undefined,
          }],
          venue_id: pair.projectedVenue?.id ?? null,
        }),
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

  const tabStyle = (t: typeof tab): React.CSSProperties => ({
    padding: '6px 18px',
    fontSize: 13,
    fontWeight: tab === t ? 700 : 500,
    borderRadius: 99,
    border: 'none',
    cursor: 'pointer',
    background: tab === t ? '#111' : 'transparent',
    color: tab === t ? '#fff' : '#666',
    transition: 'all 0.15s',
  })

  return (
    <main className="admin-main">
      {/* ── Avatar lightbox ── */}
      {lightboxUrl && (
        <div
          onClick={() => setLightboxUrl(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'zoom-out' }}
        >
          <img src={lightboxUrl} alt="Profile photo" style={{ maxWidth: '90vw', maxHeight: '90vh', borderRadius: 12, objectFit: 'contain', boxShadow: '0 8px 40px rgba(0,0,0,0.5)' }} />
        </div>
      )}

      {/* ── Tab bar ── */}
      <div style={{ display: 'flex', gap: 4, marginBottom: '1rem', background: '#f3f4f6', borderRadius: 99, padding: 4, width: 'fit-content' }}>
        <button style={tabStyle('sim')} onClick={() => setTab('sim')}>Simulator</button>
        <button style={tabStyle('active')} onClick={() => setTab('active')}>
          Active Intros{data ? ` (${data.active.length})` : ''}
        </button>
        <button style={tabStyle('completed')} onClick={() => setTab('completed')}>
          Completed{data ? ` (${data.completed.length})` : ''}
        </button>
      </div>

      {/* ── Manual Pair ── */}
      {tab === 'sim' && <div className="admin-card" style={{ marginBottom: '1.25rem' }}>
        <h2 className="admin-title" style={{ marginBottom: '0.75rem' }}>Manual Intro</h2>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '0.75rem' }}>
          {(['A', 'B'] as const).map((side) => {
            const query = side === 'A' ? manualQueryA : manualQueryB
            const setQuery = side === 'A' ? setManualQueryA : setManualQueryB
            const selected = side === 'A' ? manualUserA : manualUserB
            const setSelected = side === 'A' ? setManualUserA : setManualUserB
            const open = side === 'A' ? manualDropdownA : manualDropdownB
            const setOpen = side === 'A' ? setManualDropdownA : setManualDropdownB
            const results = filteredUsers(query)
            return (
              <div key={side} style={{ position: 'relative', flex: '1 1 200px', minWidth: 180 }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                  <span style={{ fontWeight: 600, color: '#555' }}>Person {side}</span>
                  <input
                    className="auth-input"
                    value={selected ? (selected.first_name ?? '') : query}
                    placeholder="Search by name…"
                    style={{ width: '100%' }}
                    onFocus={() => { loadAllUsers(); setOpen(true); if (selected) { setSelected(null); setQuery('') } }}
                    onChange={(e) => { setQuery(e.target.value); setSelected(null); setOpen(true) }}
                    onBlur={() => setTimeout(() => setOpen(false), 150)}
                  />
                </label>
                {open && results.length > 0 && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.1)', marginTop: 2, maxHeight: 240, overflowY: 'auto' }}>
                    {results.map(u => (
                      <div
                        key={u.id}
                        style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid #f3f4f6' }}
                        onMouseDown={() => { setSelected(u); setQuery(''); setOpen(false) }}
                      >
                        <div style={{ fontWeight: 600 }}>{u.first_name}</div>
                        {(u.market || u.city) && <div style={{ fontSize: 11, color: '#888' }}>{u.market ?? u.city?.split(',')[0]}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
          <button
            className="admin-btn admin-btn-primary"
            onClick={runManualPair}
            disabled={!manualUserA || !manualUserB || manualRunning}
            style={{ alignSelf: 'flex-end' }}
          >
            {manualRunning ? 'Previewing…' : 'Preview pair'}
          </button>
        </div>

        {manualError && <p className="admin-error admin-error-inline">{manualError}</p>}

        {manualPair && (() => {
          const p = manualPair
          const key = `${p.userAId}:${p.userBId}`
          const topicsLine = p.aiSharedTopics?.length ? p.aiSharedTopics.join(' · ') : null
          return (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th style={{ width: 46 }}>Score</th>
                    <th>Person A</th>
                    <th>Person B</th>
                    <th>Why · topics</th>
                    <th>Venue</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={{ fontWeight: 700, fontSize: 15, textAlign: 'center', verticalAlign: 'top', paddingTop: 10 }}>{p.score}</td>
                    <td style={{ minWidth: 130, verticalAlign: 'top' }}>
                      <div style={{ display: 'flex', alignItems: 'center' }}>
                        <AvatarThumb url={p.userAAvatar} name={p.userAName} onExpand={setLightboxUrl} />
                        <div style={{ fontWeight: 600 }}>{p.userAName}</div>
                      </div>
                      <div style={{ fontSize: 12, color: '#666' }}>{[p.userAAge != null ? `${p.userAAge}` : null, p.userAPronouns ?? p.userAGender].filter(Boolean).join(' · ')}</div>
                      {p.userAWorkLabel && <div style={{ fontSize: 12, color: '#888' }}>{p.userAWorkLabel}</div>}
                      {p.userACity && <div style={{ fontSize: 11, color: '#aaa' }}>{p.userACity.split(',')[0]}</div>}
                      {p.userALastFeedback && <div style={{ marginTop: 3 }}><SentimentChip sentiment={p.userALastFeedback.sentiment} /></div>}
                    </td>
                    <td style={{ minWidth: 130, verticalAlign: 'top' }}>
                      <div style={{ display: 'flex', alignItems: 'center' }}>
                        <AvatarThumb url={p.userBAvatar} name={p.userBName} onExpand={setLightboxUrl} />
                        <div style={{ fontWeight: 600 }}>{p.userBName}</div>
                      </div>
                      <div style={{ fontSize: 12, color: '#666' }}>{[p.userBAge != null ? `${p.userBAge}` : null, p.userBPronouns ?? p.userBGender].filter(Boolean).join(' · ')}</div>
                      {p.userBWorkLabel && <div style={{ fontSize: 12, color: '#888' }}>{p.userBWorkLabel}</div>}
                      {p.userBCity && <div style={{ fontSize: 11, color: '#aaa' }}>{p.userBCity.split(',')[0]}</div>}
                      {p.userBLastFeedback && <div style={{ marginTop: 3 }}><SentimentChip sentiment={p.userBLastFeedback.sentiment} /></div>}
                    </td>
                    <td style={{ maxWidth: 240, verticalAlign: 'top' }}>
                      {p.llmReason && <div style={{ fontSize: 12, color: '#444', marginBottom: 4 }}>{p.llmReason}</div>}
                      {topicsLine && <div style={{ fontSize: 11, color: '#888', fontStyle: 'italic' }}>{topicsLine}</div>}
                      {p.introMessages && (
                        <details style={{ marginTop: 5 }}>
                          <summary style={{ fontSize: 11, color: '#2563eb', cursor: 'pointer', userSelect: 'none' }}>Preview messages</summary>
                          <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <div>
                              <div style={{ fontSize: 11, fontWeight: 600, color: '#888', marginBottom: 2 }}>→ {p.userAName.split(' ')[0]}</div>
                              <div style={{ fontSize: 12, color: '#222', lineHeight: 1.5, fontStyle: 'italic' }}>&ldquo;{p.introMessages.messageForA}&rdquo;</div>
                            </div>
                            <div>
                              <div style={{ fontSize: 11, fontWeight: 600, color: '#888', marginBottom: 2 }}>→ {p.userBName.split(' ')[0]}</div>
                              <div style={{ fontSize: 12, color: '#222', lineHeight: 1.5, fontStyle: 'italic' }}>&ldquo;{p.introMessages.messageForB}&rdquo;</div>
                            </div>
                          </div>
                        </details>
                      )}
                    </td>
                    <td style={{ fontSize: 12, whiteSpace: 'nowrap', verticalAlign: 'top' }}>
                      {p.projectedVenue ? (
                        <>
                          <div style={{ fontWeight: 600 }}>{p.projectedVenue.name}</div>
                          <div style={{ color: '#888' }}>{p.projectedVenue.neighborhood ?? p.projectedVenue.city}</div>
                        </>
                      ) : <span style={{ color: '#bbb' }}>TBD</span>}
                    </td>
                    <td style={{ verticalAlign: 'top' }}>
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
                </tbody>
              </table>
              {fireMsg && (
                <p style={{ fontSize: 13, fontWeight: 600, color: fireMsg.ok ? '#065f46' : '#991b1b', background: fireMsg.ok ? '#d1fae5' : '#fee2e2', padding: '6px 12px', borderRadius: 6, marginTop: '0.5rem' }}>
                  {fireMsg.text}
                </p>
              )}
            </div>
          )
        })()}
      </div>}

      {/* ── Simulator ── */}
      {tab === 'sim' && <div className="admin-card" style={{ marginBottom: '1.25rem' }}>
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
                      <th style={{ width: 46 }}>Score</th>
                      <th>Person A</th>
                      <th>Person B</th>
                      <th>Why · topics</th>
                      <th>Venue</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {simPairs.map((p) => {
                      const key = `${p.userAId}:${p.userBId}`
                      const topicsLine = p.aiSharedTopics?.length
                        ? p.aiSharedTopics.join(' · ')
                        : null
                      return (
                        <>
                          <tr key={key}>
                            <td style={{ fontWeight: 700, fontSize: 15, textAlign: 'center', verticalAlign: 'top', paddingTop: 10 }}>{p.score}</td>
                            <td style={{ minWidth: 130, verticalAlign: 'top' }}>
                              <div style={{ display: 'flex', alignItems: 'center' }}>
                                <AvatarThumb url={p.userAAvatar} name={p.userAName} onExpand={setLightboxUrl} />
                                <div style={{ fontWeight: 600 }}>{p.userAName}</div>
                              </div>
                              <div style={{ fontSize: 12, color: '#666' }}>
                                {[p.userAAge != null ? `${p.userAAge}` : null, p.userAPronouns ?? p.userAGender].filter(Boolean).join(' · ')}
                              </div>
                              {p.userAWorkLabel && <div style={{ fontSize: 12, color: '#888' }}>{p.userAWorkLabel}</div>}
                              {p.userACity && <div style={{ fontSize: 11, color: '#aaa' }}>{p.userACity.split(',')[0]}</div>}
                              {p.userALastFeedback && <div style={{ marginTop: 3 }}><SentimentChip sentiment={p.userALastFeedback.sentiment} /></div>}
                            </td>
                            <td style={{ minWidth: 130, verticalAlign: 'top' }}>
                              <div style={{ display: 'flex', alignItems: 'center' }}>
                                <AvatarThumb url={p.userBAvatar} name={p.userBName} onExpand={setLightboxUrl} />
                                <div style={{ fontWeight: 600 }}>{p.userBName}</div>
                              </div>
                              <div style={{ fontSize: 12, color: '#666' }}>
                                {[p.userBAge != null ? `${p.userBAge}` : null, p.userBPronouns ?? p.userBGender].filter(Boolean).join(' · ')}
                              </div>
                              {p.userBWorkLabel && <div style={{ fontSize: 12, color: '#888' }}>{p.userBWorkLabel}</div>}
                              {p.userBCity && <div style={{ fontSize: 11, color: '#aaa' }}>{p.userBCity.split(',')[0]}</div>}
                              {p.userBLastFeedback && <div style={{ marginTop: 3 }}><SentimentChip sentiment={p.userBLastFeedback.sentiment} /></div>}
                            </td>
                            <td style={{ maxWidth: 240, verticalAlign: 'top' }}>
                              {p.llmReason && <div style={{ fontSize: 12, color: '#444', marginBottom: 4 }}>{p.llmReason}</div>}
                              {topicsLine && (
                                <div style={{ fontSize: 11, color: '#888', fontStyle: 'italic' }}>{topicsLine}</div>
                              )}
                              {p.introMessages && (
                                <details style={{ marginTop: 5 }}>
                                  <summary style={{ fontSize: 11, color: '#2563eb', cursor: 'pointer', userSelect: 'none' }}>Preview messages</summary>
                                  <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    <div>
                                      <div style={{ fontSize: 11, fontWeight: 600, color: '#888', marginBottom: 2 }}>→ {p.userAName.split(' ')[0]}</div>
                                      <div style={{ fontSize: 12, color: '#222', lineHeight: 1.5, fontStyle: 'italic' }}>&ldquo;{p.introMessages.messageForA}&rdquo;</div>
                                    </div>
                                    <div>
                                      <div style={{ fontSize: 11, fontWeight: 600, color: '#888', marginBottom: 2 }}>→ {p.userBName.split(' ')[0]}</div>
                                      <div style={{ fontSize: 12, color: '#222', lineHeight: 1.5, fontStyle: 'italic' }}>&ldquo;{p.introMessages.messageForB}&rdquo;</div>
                                    </div>
                                  </div>
                                </details>
                              )}
                            </td>
                            <td style={{ fontSize: 12, whiteSpace: 'nowrap', verticalAlign: 'top' }}>
                              {p.projectedVenue ? (
                                <>
                                  <div style={{ fontWeight: 600 }}>{p.projectedVenue.name}</div>
                                  <div style={{ color: '#888' }}>{p.projectedVenue.neighborhood ?? p.projectedVenue.city}</div>
                                </>
                              ) : (
                                <span style={{ color: '#bbb' }}>TBD</span>
                              )}
                            </td>
                            <td style={{ verticalAlign: 'top' }}>
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
                        </>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>}

      {/* ── Active Intros ── */}
      {tab === 'active' && <div className="admin-card" style={{ marginBottom: '1.25rem' }}>
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
      </div>}

      {/* ── Completed Fikas ── */}
      {tab === 'completed' && <div className="admin-card">
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
      </div>}
    </main>
  )
}
