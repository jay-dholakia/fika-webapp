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
  pronouns: string | null
  relationshipStatus: string | null
  city: string | null
  market: string | null
  marketLabel: string | null
  phone: string | null
  avatarUrl: string | null
  intentConfirmedAt: string | null
  lastFikaAt: string | null
  createdAt: string | null
  updatedAt: string | null
}
type IntakeDetail = {
  responses: IntakeResponseItem[]
  availabilityTimes: string[] | null
  completedAt: string | null
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

          {error && <p className="admin-error admin-error-inline" role="alert">{error}</p>}

          <p className="admin-back">
            <Link href="/app/yourfika">Back to app</Link>
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
                    <>
                      <div className="admin-people-modal-photo-wrap">
                        {modalProfile.avatarUrl ? (
                          <img
                            src={modalProfile.avatarUrl}
                            alt={
                              modalProfile.firstName?.trim()
                                ? `Profile photo of ${modalProfile.firstName.trim()}`
                                : 'Profile photo'
                            }
                            className="admin-people-modal-photo"
                            width={88}
                            height={88}
                            decoding="async"
                          />
                        ) : (
                          <div
                            className="admin-people-modal-photo admin-people-modal-photo-placeholder"
                            role="img"
                            aria-label={
                              modalProfile.firstName?.trim()
                                ? `No profile photo; ${modalProfile.firstName.trim()}`
                                : 'No profile photo'
                            }
                          >
                            {(modalProfile.firstName?.trim()?.[0] ?? '?').toUpperCase()}
                          </div>
                        )}
                      </div>
                      <section className="admin-modal-section">
                        <h3 className="admin-modal-section-title">Profile</h3>
                        <dl className="admin-modal-dl">
                          <dt>Name</dt>
                          <dd>
                            {modalProfile.firstName ?? '—'}
                          </dd>
                          <dt>City</dt>
                          <dd>{modalProfile.city ?? '—'}</dd>
                          <dt>Market</dt>
                          <dd>{modalProfile.marketLabel ?? modalProfile.market ?? '—'}</dd>
                          <dt>Birthdate</dt>
                          <dd>{modalProfile.birthdate ?? '—'}</dd>
                          <dt>Pronouns</dt>
                          <dd>{modalProfile.pronouns ?? '—'}</dd>
                          <dt>Relationship status</dt>
                          <dd>{modalProfile.relationshipStatus ?? '—'}</dd>
                          <dt>Intent confirmed</dt>
                          <dd>{modalProfile.intentConfirmedAt ? formatDate(modalProfile.intentConfirmedAt) : '—'}</dd>
                          <dt>Last fika</dt>
                          <dd>{modalProfile.lastFikaAt ? formatDate(modalProfile.lastFikaAt) : '—'}</dd>
                          <dt>Created</dt>
                          <dd>{formatDate(modalProfile.createdAt)}</dd>
                        </dl>
                      </section>
                    </>
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

    </>
  )
}
