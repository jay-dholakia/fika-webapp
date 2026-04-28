'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  fikaStartsAtIsoFromDateAndTimeInZone,
  mondayAnchorFromGregorianDateYmd,
} from '@/lib/fika-social-draft-options'
import { getMarketFromCity } from '@/lib/markets'
import { getIanaTimezoneForMarketSlug } from '@/lib/market-timezones'
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
  opt_in_invite_sent_at: string | null
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

function todayYmdLocal(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

type MarketOption = {
  slug: string
  label: string
  active: boolean
  default_radius_miles: number
}

type VenueOption = {
  id: string
  name: string
  neighborhood: string | null
  city: string
}

type IanaOption = { value: string; label: string }

type EligibleProfileRow = {
  id: string
  first_name: string | null
  city: string | null
  distance_miles: number
}

function draftExclusionsStorageKey(params: {
  venueId: string
  fikaDate: string
  fikaTime: string
  radiusMiles: string
  marketSlug: string | null
}): string {
  const venue = params.venueId.trim() || 'no-venue'
  const date = params.fikaDate.trim() || 'no-date'
  const time = params.fikaTime.trim() || 'no-time'
  const radius = params.radiusMiles.trim() || 'no-radius'
  const market = (params.marketSlug ?? '').trim() || 'no-market'
  return `fika_social_draft_exclusions:v1:${market}:${venue}:${date}:${time}:${radius}`
}

function readExcludedIdsFromStorage(key: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((x): x is string => typeof x === 'string' && x.trim().length > 0))
  } catch {
    return new Set()
  }
}

function writeExcludedIdsToStorage(key: string, ids: Set<string>) {
  try {
    window.localStorage.setItem(key, JSON.stringify(Array.from(ids)))
  } catch {
    // ignore
  }
}

export default function AdminFikaSocialsPage() {
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<DetailResponse | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const [venueId, setVenueId] = useState('')
  const [fikaDate, setFikaDate] = useState('')
  const [fikaTime, setFikaTime] = useState('')
  const [radius, setRadius] = useState('4')
  const [optInClosesLocal, setOptInClosesLocal] = useState('')
  const [previewCount, setPreviewCount] = useState<number | null>(null)
  const [eligibleOpen, setEligibleOpen] = useState(false)
  const [eligibleLoading, setEligibleLoading] = useState(false)
  const [eligibleError, setEligibleError] = useState<string | null>(null)
  const [eligibleProfiles, setEligibleProfiles] = useState<EligibleProfileRow[]>([])
  const [eligibleExcluded, setEligibleExcluded] = useState<Record<string, boolean>>({})
  const [eligibleForSessionId, setEligibleForSessionId] = useState<string | null>(null)
  const [eligibleDraftStorageKey, setEligibleDraftStorageKey] = useState<string | null>(null)

  const [marketOptions, setMarketOptions] = useState<MarketOption[]>([])
  const [venueOptions, setVenueOptions] = useState<VenueOption[]>([])
  const [venuesNote, setVenuesNote] = useState<string | null>(null)
  const [ianaOptions, setIanaOptions] = useState<IanaOption[]>([])
  const [radiusPresets, setRadiusPresets] = useState<number[]>([2, 3, 4, 5, 6, 8, 10, 12, 15])
  const [draftOptionsLoading, setDraftOptionsLoading] = useState(false)

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

  useEffect(() => {
    setFikaDate(todayYmdLocal())
    setFikaTime('18:00')
  }, [])

  const loadDraftOptions = useCallback(async () => {
    setDraftOptionsLoading(true)
    try {
      const res = await fetch(`/api/admin/fika-socials/draft-options`, {
        credentials: 'include',
        headers: await getAuthHeaders(),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error ?? 'Failed to load draft options')
      const markets = (json.markets ?? []) as MarketOption[]
      const venues = (json.venues ?? []) as VenueOption[]
      setMarketOptions(markets)
      setVenueOptions(venues)
      setVenuesNote(typeof json.venues_note === 'string' ? json.venues_note : null)
      setIanaOptions(Array.isArray(json.iana_timezones) ? json.iana_timezones : [])
      if (Array.isArray(json.radius_presets) && json.radius_presets.length > 0) {
        setRadiusPresets(json.radius_presets.map((n: unknown) => Number(n)).filter((n: number) => Number.isFinite(n)))
      }
      setVenueId((prev) => (venues.some((v) => v.id === prev) ? prev : ''))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load draft options')
    } finally {
      setDraftOptionsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadDraftOptions()
  }, [loadDraftOptions])

  const selectedVenue = useMemo(
    () => venueOptions.find((v) => v.id === venueId) ?? null,
    [venueOptions, venueId]
  )

  const inferredMarket = useMemo(() => {
    if (!selectedVenue?.city?.trim()) return null
    return getMarketFromCity(selectedVenue.city)
  }, [selectedVenue])

  const inferredTz = useMemo(
    () => (inferredMarket ? getIanaTimezoneForMarketSlug(inferredMarket.slug) : ''),
    [inferredMarket]
  )

  const inferredWeekAnchor = useMemo(() => {
    if (!fikaDate.trim()) return null
    return mondayAnchorFromGregorianDateYmd(fikaDate.trim())
  }, [fikaDate])

  const ianaLabel = useMemo(() => {
    const opt = ianaOptions.find((z) => z.value === inferredTz)
    return opt?.label ?? inferredTz
  }, [ianaOptions, inferredTz])

  useEffect(() => {
    if (!inferredMarket || !marketOptions.length) return
    const row = marketOptions.find((m) => m.slug === inferredMarket.slug)
    if (row?.default_radius_miles != null && Number.isFinite(row.default_radius_miles)) {
      setRadius(String(row.default_radius_miles))
    }
  }, [inferredMarket?.slug, marketOptions, venueId])

  async function previewEligibility() {
    setError(null)
    setPreviewCount(null)
    try {
      if (!inferredMarket) throw new Error('Choose a venue we can map to a market (check venue city / lib/markets patterns).')
      const params = new URLSearchParams({
        market_slug: inferredMarket.slug,
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

  async function openEligibleChecklist(params: { market_slug: string; venue_id: string; radius_miles: string; session_id?: string | null }) {
    setEligibleOpen(true)
    setEligibleLoading(true)
    setEligibleError(null)
    setEligibleForSessionId(params.session_id ?? null)
    const draftKey =
      !params.session_id && typeof window !== 'undefined'
        ? draftExclusionsStorageKey({
            venueId: params.venue_id,
            fikaDate,
            fikaTime,
            radiusMiles: params.radius_miles,
            marketSlug: params.market_slug,
          })
        : null
    setEligibleDraftStorageKey(draftKey)
    try {
      const q = new URLSearchParams({
        market_slug: params.market_slug,
        venue_id: params.venue_id,
        radius_miles: params.radius_miles,
        limit: '400',
      })
      const res = await fetch(`/api/admin/fika-socials/eligibility-profiles?${q.toString()}`, {
        credentials: 'include',
        headers: await getAuthHeaders(),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error ?? 'Failed to load profiles')
      const rows = (json.profiles ?? []) as EligibleProfileRow[]
      setEligibleProfiles(rows)

      if (params.session_id) {
        const exclRes = await fetch(`/api/admin/fika-socials/${encodeURIComponent(params.session_id)}/invite-exclusions`, {
          credentials: 'include',
          headers: await getAuthHeaders(),
        })
        const exclJson = await exclRes.json().catch(() => ({}))
        if (!exclRes.ok) throw new Error(exclJson?.error ?? 'Failed to load exclusions')
        const excludedIds = new Set<string>((exclJson.excluded_user_ids ?? []) as string[])
        setEligibleExcluded(Object.fromEntries(rows.map((r) => [r.id, excludedIds.has(r.id)])))
      } else {
        const excludedIds = draftKey ? readExcludedIdsFromStorage(draftKey) : new Set<string>()
        setEligibleExcluded(Object.fromEntries(rows.map((r) => [r.id, excludedIds.has(r.id)])))
      }
    } catch (e) {
      setEligibleError(e instanceof Error ? e.message : 'Failed to load profiles')
    } finally {
      setEligibleLoading(false)
    }
  }

  async function saveEligibleExclusions() {
    if (!eligibleForSessionId) return
    setEligibleLoading(true)
    setEligibleError(null)
    try {
      const excluded_user_ids = Object.entries(eligibleExcluded)
        .filter(([, v]) => v)
        .map(([k]) => k)
      const res = await fetch(`/api/admin/fika-socials/${encodeURIComponent(eligibleForSessionId)}/invite-exclusions`, {
        method: 'PATCH',
        credentials: 'include',
        headers: await getAuthHeaders(),
        body: JSON.stringify({ excluded_user_ids }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error ?? 'Failed to save exclusions')
    } catch (e) {
      setEligibleError(e instanceof Error ? e.message : 'Failed to save exclusions')
    } finally {
      setEligibleLoading(false)
    }
  }

  async function createSession() {
    setError(null)
    try {
      if (!venueId.trim()) throw new Error('Choose a venue')
      if (!inferredMarket) {
        throw new Error(
          'Cannot infer market from this venue’s city. Fix the venue city in the database or add a matching pattern in lib/markets.'
        )
      }
      const tz = getIanaTimezoneForMarketSlug(inferredMarket.slug)
      const weekAnchor = mondayAnchorFromGregorianDateYmd(fikaDate.trim())
      if (!weekAnchor) throw new Error('Pick a valid Fika date')
      const fikaIso = fikaStartsAtIsoFromDateAndTimeInZone(fikaDate.trim(), fikaTime.trim(), tz)
      if (!fikaIso) throw new Error('Set a valid Fika time (HH:MM) — interpreted in the market timezone shown below.')
      const res = await fetch('/api/admin/fika-socials', {
        method: 'POST',
        credentials: 'include',
        headers: await getAuthHeaders(),
        body: JSON.stringify({
          market_slug: inferredMarket.slug,
          venue_id: venueId.trim(),
          week_anchor_monday: weekAnchor,
          fika_starts_at: fikaIso,
          radius_miles: Number(radius) || 4,
          iana_tz: tz,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error ?? 'Create failed')
      await loadSessions()
      if (json.session?.id) {
        const sessionId = String(json.session.id)
        // If the admin excluded profiles while previewing before creation, persist them now.
        if (typeof window !== 'undefined' && inferredMarket) {
          const key = draftExclusionsStorageKey({
            venueId: venueId.trim(),
            fikaDate: fikaDate.trim(),
            fikaTime: fikaTime.trim(),
            radiusMiles: radius.trim() || '4',
            marketSlug: inferredMarket.slug,
          })
          const excluded = Array.from(readExcludedIdsFromStorage(key))
          if (excluded.length > 0) {
            await fetch(`/api/admin/fika-socials/${encodeURIComponent(sessionId)}/invite-exclusions`, {
              method: 'PATCH',
              credentials: 'include',
              headers: await getAuthHeaders(),
              body: JSON.stringify({ excluded_user_ids: excluded }),
            }).catch(() => null)
          }
          try {
            window.localStorage.removeItem(key)
          } catch {
            // ignore
          }
        }
        await loadDetail(sessionId)
      }
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
        <p style={{ fontSize: '0.88rem', color: '#555', marginBottom: '0.65rem', marginTop: 0 }}>
          Enter <strong>venue</strong>, <strong>Fika date</strong>, <strong>time</strong> (wall clock in the market timezone below), and <strong>radius</strong>. Market, timezone, and week anchor are inferred automatically.
        </p>
        {draftOptionsLoading ? (
          <p style={{ fontSize: '0.9rem', color: '#666', marginBottom: '0.65rem' }}>Loading markets and venues…</p>
        ) : null}
        <div style={{ display: 'grid', gap: '0.65rem', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
          <label style={{ gridColumn: '1 / -1' }}>
            <span style={{ display: 'block', fontSize: '0.8rem', marginBottom: 2 }}>Venue</span>
            <select
              value={venueId}
              onChange={(e) => setVenueId(e.target.value)}
              style={{ width: '100%', maxWidth: '100%' }}
              disabled={draftOptionsLoading || venueOptions.length === 0}
            >
              <option value="">{draftOptionsLoading ? 'Loading…' : 'Choose a venue…'}</option>
              {venueOptions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                  {v.neighborhood ? ` (${v.neighborhood})` : ''} — {v.city || '—'}
                </option>
              ))}
            </select>
          </label>
          {venuesNote ? (
            <p style={{ gridColumn: '1 / -1', fontSize: '0.82rem', color: '#856404', margin: 0 }}>{venuesNote}</p>
          ) : null}
          {selectedVenue && inferredMarket && inferredTz ? (
            <div
              style={{
                gridColumn: '1 / -1',
                fontSize: '0.85rem',
                color: '#333',
                padding: '0.5rem 0.65rem',
                background: '#f5f7fa',
                borderRadius: 6,
                border: '1px solid #e2e6ec',
              }}
            >
              <div>
                <strong>Inferred market:</strong> {inferredMarket.label} ({inferredMarket.slug})
              </div>
              <div>
                <strong>Timezone:</strong> {ianaLabel || inferredTz} ({inferredTz})
              </div>
              {inferredWeekAnchor ? (
                <div>
                  <strong>Week anchor (Monday):</strong> {inferredWeekAnchor}
                </div>
              ) : null}
            </div>
          ) : selectedVenue && !inferredMarket ? (
            <p style={{ gridColumn: '1 / -1', fontSize: '0.85rem', color: '#b00020', margin: 0 }}>
              No market matches venue city &quot;{selectedVenue.city || '—'}&quot;. Update the venue&apos;s city in the database or add patterns in{' '}
              <code>lib/markets</code>.
            </p>
          ) : null}
          <label>
            <span style={{ display: 'block', fontSize: '0.8rem', marginBottom: 2 }}>Fika date</span>
            <input type="date" value={fikaDate} onChange={(e) => setFikaDate(e.target.value)} style={{ width: '100%' }} />
          </label>
          <label>
            <span style={{ display: 'block', fontSize: '0.8rem', marginBottom: 2 }}>
              Fika time (market local, 24h)
            </span>
            <input type="time" value={fikaTime} onChange={(e) => setFikaTime(e.target.value)} style={{ width: '100%' }} />
          </label>
          <label>
            <span style={{ display: 'block', fontSize: '0.8rem', marginBottom: 2 }}>Radius (miles)</span>
            <select value={radius} onChange={(e) => setRadius(e.target.value)} style={{ width: '100%' }}>
              {radiusPresets.map((n) => (
                <option key={n} value={String(n)}>
                  {n} mi
                </option>
              ))}
            </select>
          </label>
        </div>
        <div style={{ marginTop: '0.85rem', display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
          <button type="button" className="admin-btn" onClick={() => void previewEligibility()}>
            Preview pool count
          </button>
          {previewCount != null ? (
            <button
              type="button"
              className="admin-btn"
              onClick={() => {
                if (!inferredMarket) {
                  setError('Choose a venue we can map to a market first.')
                  return
                }
                void openEligibleChecklist({
                  market_slug: inferredMarket.slug,
                  venue_id: venueId.trim(),
                  radius_miles: radius.trim() || '4',
                })
              }}
              style={{ alignSelf: 'center' }}
            >
              {previewCount} profiles in radius (review)
            </button>
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

              <div style={{ marginBottom: '0.75rem' }}>
                <button
                  type="button"
                  className="admin-btn"
                  onClick={() => {
                    const s = detail.session
                    void openEligibleChecklist({
                      market_slug: s.market_slug,
                      venue_id: s.venue_id,
                      radius_miles: String(s.radius_miles ?? 4),
                      session_id: s.id,
                    })
                  }}
                >
                  Review invite pool (checklist)
                </button>
              </div>

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
                      const raw = optInClosesLocal.trim()
                      if (!raw) {
                        setError('Set opt-in closes (local) before publish')
                        return
                      }
                      const iso = new Date(raw).toISOString()
                      if (Number.isNaN(Date.parse(raw))) {
                        setError('Invalid opt-in close date/time')
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
                    <button type="button" className="admin-btn" onClick={() => void patchSession(detail.session.id, { action: 'record_opt_in_invite' })}>
                      Record invite sent
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

      {eligibleOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem',
            zIndex: 50,
          }}
          onClick={() => {
            if (eligibleLoading) return
            setEligibleOpen(false)
          }}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 10,
              width: 'min(900px, 100%)',
              maxHeight: '80vh',
              overflow: 'auto',
              border: '1px solid #ddd',
              padding: '0.9rem',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'flex-start' }}>
              <div>
                <h2 style={{ fontSize: '1.05rem', margin: 0 }}>Profiles in radius</h2>
                <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: '#555' }}>
                  Uncheck (exclude) people you don’t want invited to this Fika social.
                </p>
              </div>
              <div style={{ display: 'inline-flex', gap: '0.5rem' }}>
                {eligibleForSessionId ? (
                  <button
                    type="button"
                    className="admin-btn admin-btn-primary"
                    onClick={() => void saveEligibleExclusions()}
                    disabled={eligibleLoading}
                  >
                    Save exclusions
                  </button>
                ) : null}
                <button
                  type="button"
                  className="admin-btn"
                  onClick={() => setEligibleOpen(false)}
                  disabled={eligibleLoading}
                >
                  Close
                </button>
              </div>
            </div>

            {eligibleError ? (
              <p style={{ color: '#b00020', marginTop: '0.75rem' }} role="alert">
                {eligibleError}
              </p>
            ) : null}
            {eligibleLoading ? <p style={{ marginTop: '0.75rem' }}>Loading…</p> : null}

            {!eligibleLoading && eligibleProfiles.length > 0 ? (
              <table style={{ width: '100%', marginTop: '0.75rem', fontSize: '0.9rem', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: '6px 0' }}>Include</th>
                    <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: '6px 0' }}>Name</th>
                    <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: '6px 0' }}>City</th>
                    <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: '6px 0' }}>Miles</th>
                  </tr>
                </thead>
                <tbody>
                  {eligibleProfiles.map((p) => {
                    const excluded = Boolean(eligibleExcluded[p.id])
                    return (
                      <tr key={p.id}>
                        <td style={{ padding: '6px 0' }}>
                          <input
                            type="checkbox"
                            checked={!excluded}
                            onChange={(e) => {
                              const include = e.target.checked
                              setEligibleExcluded((prev) => {
                                const next = { ...prev, [p.id]: !include }
                                if (!eligibleForSessionId && eligibleDraftStorageKey) {
                                  const ids = new Set<string>(
                                    Object.entries(next)
                                      .filter(([, v]) => v)
                                      .map(([k]) => k)
                                  )
                                  writeExcludedIdsToStorage(eligibleDraftStorageKey, ids)
                                }
                                return next
                              })
                            }}
                            aria-label={`Include ${p.first_name ?? p.id}`}
                          />
                        </td>
                        <td style={{ padding: '6px 0' }}>{p.first_name ?? '—'}</td>
                        <td style={{ padding: '6px 0' }}>{p.city ?? '—'}</td>
                        <td style={{ padding: '6px 0' }}>{p.distance_miles.toFixed(1)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            ) : null}
          </div>
        </div>
      ) : null}
    </main>
  )
}
