'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { getSupabase } from '@/lib/supabase'
import { getQuestionText, formatIntakeAnswer } from '@/lib/intro-detail'
import type { IntakeResponseItem } from '@/lib/db-types'

type DashboardItem = { slug: string; label: string; count: number }
type SignupRow = {
  id: string
  firstName: string | null
  city: string | null
  market: string | null
  createdAt: string | null
}
type ProfileDetail = {
  id: string
  firstName: string | null
  birthdate: string | null
  gender: string | null
  genderPreference: string | null
  agePreference: string | null
  pronouns: string | null
  relationshipStatus: string | null
  city: string | null
  market: string | null
  marketLabel: string | null
  phone: string | null
  avatarUrl: string | null
  intentConfirmedAt: string | null
  createdAt: string | null
  updatedAt: string | null
}
type IntakeDetail = {
  responses: IntakeResponseItem[]
  availabilityTimes: string[] | null
  completedAt: string | null
}
type SimSummary = {
  usersConsidered: number
  pairsScored: number
  filteredOut: number
  optedInOnly: boolean
  market: string | null
}
type SimPair = {
  userAId: string
  userAName: string
  userAAge: number | null
  userAGender: string | null
  userACity: string | null
  userBId: string
  userBName: string
  userBAge: number | null
  userBGender: string | null
  userBCity: string | null
  score: number
  distanceKm: number | null
  sharedLanguages: string[]
  hopingA: string | null
  hopingB: string | null
  overlapGreatFika: string[]
  overlapInterests: string[]
  compareRows: Array<{ label: string; a: string; b: string }>
  sectionScores: Record<string, number>
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    return d.toLocaleDateString(undefined, { dateStyle: 'medium' })
  } catch {
    return iso
  }
}

export default function AdminSignupsPage() {
  const [dashboard, setDashboard] = useState<DashboardItem[]>([])
  const [signups, setSignups] = useState<SignupRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterMarket, setFilterMarket] = useState<string>('')
  const [modalUserId, setModalUserId] = useState<string | null>(null)
  const [modalProfile, setModalProfile] = useState<ProfileDetail | null>(null)
  const [modalIntake, setModalIntake] = useState<IntakeDetail | null>(null)
  const [modalLoading, setModalLoading] = useState(false)
  const [simLoading, setSimLoading] = useState(false)
  const [simError, setSimError] = useState<string | null>(null)
  const [simSummary, setSimSummary] = useState<SimSummary | null>(null)
  const [simPairs, setSimPairs] = useState<SimPair[]>([])
  const [simPairModal, setSimPairModal] = useState<SimPair | null>(null)
  const [simOptedInOnly, setSimOptedInOnly] = useState(false)
  const [selectedSimPairs, setSelectedSimPairs] = useState<Record<string, boolean>>({})
  const [triggeringSms, setTriggeringSms] = useState(false)
  const [triggerSmsResult, setTriggerSmsResult] = useState<string | null>(null)

  const fetchSignups = useCallback(async (market?: string) => {
    const supabase = getSupabase()
    const { data: { session } } = await supabase?.auth.getSession() ?? { data: { session: null } }
    const headers: HeadersInit = { 'Content-Type': 'application/json' }
    if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`
    const url = market
      ? `/api/admin/signups?market=${encodeURIComponent(market)}`
      : '/api/admin/signups'
    const res = await fetch(url, { credentials: 'include', headers })
    if (res.status === 401) {
      const data = await res.json().catch(() => ({}))
      if (data?.code === 'NO_SESSION') window.location.href = '/login?next=/admin/signups'
      throw new Error('unauthorized')
    }
    if (res.status === 403) throw new Error('not_admin')
    const data = await res.json()
    if (data?.error) throw new Error(data.error)
    return { signups: data.signups ?? [], dashboard: data.dashboard ?? [] }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const { signups: list, dashboard: dash } = await fetchSignups(filterMarket || undefined)
        if (!cancelled) {
          setSignups(list)
          setDashboard(dash)
        }
      } catch (e) {
        if (!cancelled) {
          const err = e instanceof Error ? e : new Error(String(e))
          const msg = err.message === 'unauthorized'
            ? 'Sign in with an admin account.'
            : err.message === 'not_admin'
              ? "Your account doesn't have admin access."
              : err.message
          setError(msg)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
  }, [fetchSignups, filterMarket])

  async function openModal(userId: string) {
    setModalUserId(userId)
    setModalProfile(null)
    setModalIntake(null)
    setModalLoading(true)
    const supabase = getSupabase()
    const { data: { session } } = await supabase?.auth.getSession() ?? { data: { session: null } }
    const headers: HeadersInit = { 'Content-Type': 'application/json' }
    if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`
    try {
      const res = await fetch(`/api/admin/signups/${encodeURIComponent(userId)}`, {
        credentials: 'include',
        headers,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? 'Failed to load')
      setModalProfile(data.profile ?? null)
      setModalIntake(data.intake ?? null)
    } catch (e) {
      setModalProfile(null)
      setModalIntake(null)
      setError(e instanceof Error ? e.message : 'Failed to load profile')
    } finally {
      setModalLoading(false)
    }
  }

  function closeModal() {
    setModalUserId(null)
    setModalProfile(null)
    setModalIntake(null)
  }

  async function runSimulation() {
    setSimLoading(true)
    setSimError(null)
    setTriggerSmsResult(null)
    const supabase = getSupabase()
    const { data: { session } } = await supabase?.auth.getSession() ?? { data: { session: null } }
    const headers: HeadersInit = { 'Content-Type': 'application/json' }
    if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`
    try {
      const res = await fetch('/api/admin/match-sim', {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({
          action: 'simulate',
          market: filterMarket || null,
          optedInOnly: simOptedInOnly,
          topN: 100,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? 'Simulation failed')
      setSimSummary((data?.summary ?? null) as SimSummary | null)
      setSimPairs(Array.isArray(data?.pairs) ? data.pairs as SimPair[] : [])
      setSelectedSimPairs({})
    } catch (e) {
      setSimError(e instanceof Error ? e.message : 'Simulation failed')
    } finally {
      setSimLoading(false)
    }
  }

  async function triggerSmsDelivery() {
    setTriggeringSms(true)
    setSimError(null)
    setTriggerSmsResult(null)
    const supabase = getSupabase()
    const { data: { session } } = await supabase?.auth.getSession() ?? { data: { session: null } }
    const headers: HeadersInit = { 'Content-Type': 'application/json' }
    if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`
    const selected = simPairs.filter((p) => selectedSimPairs[`${p.userAId}:${p.userBId}`])
    if (selected.length === 0) {
      setSimError('Select at least one simulated pair before triggering SMS.')
      setTriggeringSms(false)
      return
    }
    try {
      const res = await fetch('/api/admin/match-sim', {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({
          action: 'trigger_sms',
          selectedPairs: selected.map((p) => ({
            userAId: p.userAId,
            userBId: p.userBId,
            score: p.score,
            reasons: {
              sectionScores: p.sectionScores,
              shared_interests: p.overlapInterests.slice(0, 3),
              conversation_hooks: p.overlapGreatFika.slice(0, 2),
            },
          })),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data?.ok === false) throw new Error(data?.error ?? data?.response ?? 'Failed to trigger SMS delivery')
      setTriggerSmsResult(`Triggered match-delivery SMS for ${selected.length} selected pair(s).`)
    } catch (e) {
      setSimError(e instanceof Error ? e.message : 'Failed to trigger SMS delivery')
    } finally {
      setTriggeringSms(false)
    }
  }

  const visiblePairs = simPairs.slice(0, 50)
  const selectedVisibleCount = visiblePairs.filter((p) => selectedSimPairs[`${p.userAId}:${p.userBId}`]).length
  const allVisibleSelected = visiblePairs.length > 0 && selectedVisibleCount === visiblePairs.length

  function toggleSimPair(pair: SimPair, checked: boolean) {
    const key = `${pair.userAId}:${pair.userBId}`
    setSelectedSimPairs((prev) => ({ ...prev, [key]: checked }))
  }

  if (loading) {
    return (
      <main className="admin-main">
        <div className="admin-loading">Loading…</div>
      </main>
    )
  }

  if (error && !signups.length && !dashboard.length) {
    return (
      <main className="admin-main">
        <div className="admin-card admin-card-narrow">
          <p className="admin-error" role="alert">{error}</p>
          <Link href="/login?next=/admin/signups" className="admin-btn admin-btn-primary">
            Sign in with Google
          </Link>
          <p className="admin-back">
            <Link href="/">Back to home</Link>
          </p>
        </div>
      </main>
    )
  }

  return (
    <>
      <main className="admin-main">
        <div className="admin-card">
          <h1 className="admin-title">Sign-ups</h1>
          <p className="admin-description">
            Users who have completed onboarding and selected a market. Click a row to view profile and intake.
          </p>

          {dashboard.length > 0 && (
            <div className="admin-dashboard">
              <h2 className="admin-dashboard-title">By location</h2>
              <div className="admin-dashboard-grid">
                {dashboard.filter((d) => d.count > 0).map((d) => (
                  <button
                    key={d.slug}
                    type="button"
                    className={`admin-dashboard-card ${filterMarket === d.slug ? 'admin-dashboard-card-active' : ''}`}
                    onClick={() => setFilterMarket((prev) => (prev === d.slug ? '' : d.slug))}
                  >
                    <span className="admin-dashboard-label">{d.label}</span>
                    <span className="admin-dashboard-count">{d.count}</span>
                  </button>
                ))}
              </div>
              {filterMarket && (
                <p className="admin-dashboard-filter">
                  Filtering by: {dashboard.find((d) => d.slug === filterMarket)?.label ?? filterMarket}
                  {' '}
                  <button type="button" className="admin-link" onClick={() => setFilterMarket('')}>
                    Clear
                  </button>
                </p>
              )}
            </div>
          )}

          <div className="admin-dashboard" style={{ marginTop: '1rem', marginBottom: '1.25rem' }}>
            <h2 className="admin-dashboard-title">Match simulation (no availability, no SMS)</h2>
            <p className="admin-description" style={{ marginBottom: '0.75rem' }}>
              Simulates replenish-match quality factors using current onboarding/profile data, but ignores availability overlap and does not create matches.
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <label className="admin-toggle" style={{ marginRight: '0.25rem' }}>
                <input
                  type="checkbox"
                  checked={simOptedInOnly}
                  onChange={(e) => setSimOptedInOnly(e.target.checked)}
                  disabled={simLoading || triggeringSms}
                />
                <span className="admin-toggle-label">Only users opted in this week</span>
              </label>
              <button
                type="button"
                className="admin-btn admin-btn-primary"
                onClick={runSimulation}
                disabled={simLoading || triggeringSms}
                style={{ marginBottom: 0 }}
              >
                {simLoading ? 'Simulating…' : 'Simulate match quality'}
              </button>
              <button
                type="button"
                className="admin-btn"
                onClick={triggerSmsDelivery}
                disabled={triggeringSms || simLoading}
                style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)', marginBottom: 0 }}
              >
                {triggeringSms ? 'Triggering…' : 'Trigger SMS for selected matches'}
              </button>
            </div>
            <p className="admin-dashboard-filter" style={{ marginTop: '0.5rem' }}>
              Select specific simulated pairs below, then trigger SMS only for those pairs.
            </p>
            {simSummary && (
              <p className="admin-dashboard-filter" style={{ marginTop: '0.75rem' }}>
                Users considered: {simSummary.usersConsidered} · Pairs scored: {simSummary.pairsScored} · Filtered out: {simSummary.filteredOut}
              </p>
            )}
            {triggerSmsResult && (
              <p style={{ color: 'var(--color-success)', fontSize: '0.9rem', marginTop: '0.5rem' }}>{triggerSmsResult}</p>
            )}
            {simPairs.length > 0 && (
              <div className="admin-table-wrap" style={{ marginTop: '0.75rem' }}>
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th style={{ width: '2.5rem' }}>
                        <input
                          type="checkbox"
                          checked={allVisibleSelected}
                          onChange={(e) => {
                            const checked = e.target.checked
                            const updates: Record<string, boolean> = {}
                            for (const pair of visiblePairs) {
                              updates[`${pair.userAId}:${pair.userBId}`] = checked
                            }
                            setSelectedSimPairs((prev) => ({ ...prev, ...updates }))
                          }}
                          onClick={(e) => e.stopPropagation()}
                          aria-label="Select all visible simulated pairs"
                        />
                      </th>
                      <th>#</th>
                      <th>Pair</th>
                      <th className="admin-table-num">Score</th>
                      <th>Top factors</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visiblePairs.map((p, idx) => {
                      const pairKey = `${p.userAId}:${p.userBId}`
                      const topFactors = Object.entries(p.sectionScores ?? {})
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 3)
                        .map(([k, v]) => `${k.replace(/_/g, ' ')} ${v.toFixed(2)}`)
                        .join(' · ')
                      return (
                        <tr
                          key={`${p.userAId}-${p.userBId}`}
                          className="admin-table-row-clickable"
                          role="button"
                          tabIndex={0}
                          onClick={() => setSimPairModal(p)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              setSimPairModal(p)
                            }
                          }}
                        >
                          <td onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={selectedSimPairs[pairKey] === true}
                              onChange={(e) => toggleSimPair(p, e.target.checked)}
                              onClick={(e) => e.stopPropagation()}
                              aria-label={`Select ${p.userAName} and ${p.userBName}`}
                            />
                          </td>
                          <td>{idx + 1}</td>
                          <td>{p.userAName} ↔ {p.userBName}</td>
                          <td className="admin-table-num">{p.score.toFixed(3)}</td>
                          <td>{topFactors}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {signups.length === 0 ? (
            <p className="admin-empty">No sign-ups yet.</p>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Name</th>
                    <th>Location</th>
                  </tr>
                </thead>
                <tbody>
                  {signups.map((s) => (
                    <tr
                      key={s.id}
                      className="admin-table-row-clickable"
                      role="button"
                      tabIndex={0}
                      onClick={() => openModal(s.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          openModal(s.id)
                        }
                      }}
                    >
                      <td>{formatDate(s.createdAt)}</td>
                      <td>{s.firstName ?? '—'}</td>
                      <td>{s.city ?? s.market ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {(error || simError) && <p className="admin-error admin-error-inline" role="alert">{error ?? simError}</p>}

          <p className="admin-back">
            <Link href="/app/weeklyfika">Back to app</Link>
          </p>
        </div>
      </main>

      {modalUserId && (
        <div
          className="admin-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="admin-modal-title"
          onClick={(e) => e.target === e.currentTarget && closeModal()}
        >
          <div className="admin-modal">
            <div className="admin-modal-header">
              <h2 id="admin-modal-title">Sign-up details</h2>
              <button type="button" className="admin-modal-close" onClick={closeModal} aria-label="Close">
                ×
              </button>
            </div>
            <div className="admin-modal-body">
              {modalLoading ? (
                <div className="admin-loading">Loading…</div>
              ) : (
                <>
                  {modalProfile && (
                    <section className="admin-modal-section">
                      <h3 className="admin-modal-section-title">Profile</h3>
                      <dl className="admin-modal-dl">
                        <dt>Name</dt>
                        <dd>{modalProfile.firstName ?? '—'}</dd>
                        <dt>City</dt>
                        <dd>{modalProfile.city ?? '—'}</dd>
                        <dt>Market</dt>
                        <dd>{modalProfile.marketLabel ?? modalProfile.market ?? '—'}</dd>
                        <dt>Birthdate</dt>
                        <dd>{modalProfile.birthdate ?? '—'}</dd>
                        <dt>Gender</dt>
                        <dd>{modalProfile.gender ?? '—'}</dd>
                        <dt>Pronouns</dt>
                        <dd>{modalProfile.pronouns ?? '—'}</dd>
                        <dt>Relationship status</dt>
                        <dd>{modalProfile.relationshipStatus ?? '—'}</dd>
                        <dt>Intent confirmed</dt>
                        <dd>{modalProfile.intentConfirmedAt ? formatDate(modalProfile.intentConfirmedAt) : '—'}</dd>
                        <dt>Created</dt>
                        <dd>{formatDate(modalProfile.createdAt)}</dd>
                      </dl>
                    </section>
                  )}
                  {modalIntake && (
                    <section className="admin-modal-section">
                      <h3 className="admin-modal-section-title">Intake</h3>
                      {modalIntake.completedAt ? (
                        <p className="admin-modal-meta">Completed {formatDate(modalIntake.completedAt)}</p>
                      ) : (
                        <p className="admin-modal-meta">Not completed</p>
                      )}
                      {modalIntake.responses?.length > 0 ? (
                        <dl className="admin-modal-dl">
                          {modalIntake.responses.map((r) => (
                            <span key={r.question_id}>
                              <dt>{getQuestionText(r.question_id)}</dt>
                              <dd>{formatIntakeAnswer(r.answer)}</dd>
                            </span>
                          ))}
                        </dl>
                      ) : (
                        <p className="admin-empty">No responses</p>
                      )}
                    </section>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {simPairModal && (
        <div
          className="admin-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="admin-sim-modal-title"
          onClick={(e) => e.target === e.currentTarget && setSimPairModal(null)}
        >
          <div className="admin-modal">
            <div className="admin-modal-header">
              <h2 id="admin-sim-modal-title">Match simulation details</h2>
              <button type="button" className="admin-modal-close" onClick={() => setSimPairModal(null)} aria-label="Close">
                ×
              </button>
            </div>
            <div className="admin-modal-body">
              <p className="admin-modal-meta">
                <strong>{simPairModal.userAName}</strong> ({simPairModal.userAGender ?? '—'}, {simPairModal.userAAge ?? '—'}) · {simPairModal.userACity ?? '—'}
              </p>
              <p className="admin-modal-meta">
                <strong>{simPairModal.userBName}</strong> ({simPairModal.userBGender ?? '—'}, {simPairModal.userBAge ?? '—'}) · {simPairModal.userBCity ?? '—'}
              </p>
              <p className="admin-modal-meta">
                Score: <strong>{simPairModal.score.toFixed(3)}</strong>
                {simPairModal.distanceKm != null ? ` · Distance: ${simPairModal.distanceKm.toFixed(1)} km` : ' · Distance: —'}
              </p>

              <div className="admin-modal-section">
                <h3 className="admin-modal-section-title">Top section factors</h3>
                <dl className="admin-modal-dl">
                  {Object.entries(simPairModal.sectionScores ?? {})
                    .sort((a, b) => b[1] - a[1])
                    .map(([k, v]) => (
                      <span key={k}>
                        <dt>{k.replace(/_/g, ' ')}</dt>
                        <dd>{v.toFixed(3)}</dd>
                      </span>
                    ))}
                </dl>
              </div>

              <div className="admin-modal-section">
                <h3 className="admin-modal-section-title">Context</h3>
                <p className="admin-modal-meta">Shared languages: {simPairModal.sharedLanguages?.length ? simPairModal.sharedLanguages.join(', ') : '—'}</p>
                <p className="admin-modal-meta">Hoping for: {simPairModal.hopingA ?? '—'} ↔ {simPairModal.hopingB ?? '—'}</p>
                <p className="admin-modal-meta">Shared interests: {simPairModal.overlapInterests?.length ? simPairModal.overlapInterests.slice(0, 8).join(', ') : '—'}</p>
                <p className="admin-modal-meta">Great Fika overlap: {simPairModal.overlapGreatFika?.length ? simPairModal.overlapGreatFika.slice(0, 6).join(', ') : '—'}</p>
              </div>

              <div className="admin-modal-section">
                <h3 className="admin-modal-section-title">Side-by-side responses</h3>
                {simPairModal.compareRows?.length ? (
                  <div className="admin-compare-grid-wrap">
                    <table className="admin-compare-grid">
                      <thead>
                        <tr>
                          <th>Question</th>
                          <th>{simPairModal.userAName}</th>
                          <th>{simPairModal.userBName}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {simPairModal.compareRows.map((row) => (
                          <tr key={row.label}>
                            <td>{row.label}</td>
                            <td>{row.a || '—'}</td>
                            <td>{row.b || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="admin-empty">No comparison data</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
