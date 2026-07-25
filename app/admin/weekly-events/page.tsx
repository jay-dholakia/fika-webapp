'use client'

import { useCallback, useEffect, useState } from 'react'
import { getSupabase } from '@/lib/supabase'

type VenueOption = { id: string; name: string; neighborhood: string | null; city: string }
type MarketOption = { slug: string; label: string }
type WeeklyEvent = {
  id: string
  market_slug: string
  week_ymd: string
  event_starts_at: string | null
  reveals_sent_at: string | null
  max_invites: number | null
  max_capacity: number | null
  opt_in_deadline_hours: number
  venue_id: string | null
  radius_miles: number | null
  gender_filter: string[] | null
  min_age: number | null
  max_age: number | null
  created_at: string | null
  venues: VenueOption | null
}
type EligibleUser = {
  id: string
  first_name: string | null
  phone: string | null
  gender: string | null
  age: number | null
  distance_miles: number | null
  already_invited: boolean
  already_rsvpd: boolean
  in_active_flow: boolean
  in_cooldown: boolean
}
type RsvpRow = {
  user_id: string
  decision: string
  decided_at: string | null
  profiles: { id: string; first_name: string | null; phone: string | null } | null
}
type RsvpCounts = { yes: number; no: number; cancelled: number; no_response: number }

const GENDER_OPTIONS = ['male', 'female', 'non-binary']

async function getAuthHeaders(): Promise<HeadersInit> {
  const supabase = getSupabase()
  const { data: { session } } = await supabase?.auth.getSession() ?? { data: { session: null } }
  const headers: HeadersInit = { 'Content-Type': 'application/json' }
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`
  return headers
}

function filterSummary(ev: WeeklyEvent): string {
  const parts: string[] = []
  if (ev.radius_miles) parts.push(`${ev.radius_miles} mi`)
  if (ev.gender_filter?.length) parts.push(ev.gender_filter.join(', '))
  if (ev.min_age || ev.max_age) parts.push(`${ev.min_age ?? '?'}–${ev.max_age ?? '?'} yrs`)
  return parts.length ? parts.join(' · ') : 'All market'
}

function formatEventTime(isoStr: string | null): string {
  if (!isoStr) return '—'
  const d = new Date(isoStr)
  return d.toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
    timeZone: 'America/Los_Angeles',
  })
}

function toLocalDatetimeInput(isoStr: string | null): string {
  if (!isoStr) return ''
  // Convert UTC ISO to local datetime-local format (YYYY-MM-DDTHH:MM)
  const d = new Date(isoStr)
  const tzOffset = d.getTimezoneOffset() * 60000
  return new Date(d.getTime() - tzOffset).toISOString().slice(0, 16)
}

export default function AdminWeeklyEventsPage() {
  const [events, setEvents] = useState<WeeklyEvent[]>([])
  const [markets, setMarkets] = useState<MarketOption[]>([])
  const [venues, setVenues] = useState<VenueOption[]>([])
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)

  // Form state
  const [marketSlug, setMarketSlug] = useState('')
  const [eventStartsAt, setEventStartsAt] = useState('')
  const [venueId, setVenueId] = useState('')
  const [venueSearch, setVenueSearch] = useState('')
  const [radiusMiles, setRadiusMiles] = useState('')
  const [genderFilter, setGenderFilter] = useState<string[]>([])
  const [minAge, setMinAge] = useState('')
  const [maxAge, setMaxAge] = useState('')
  const [maxInvites, setMaxInvites] = useState('')
  const [maxCapacity, setMaxCapacity] = useState('')
  const [deadlineHours, setDeadlineHours] = useState('24')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [formSuccess, setFormSuccess] = useState<string | null>(null)
  const [previewCount, setPreviewCount] = useState<number | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewUsers, setPreviewUsers] = useState<Array<{ id: string; first_name: string | null; gender: string | null; age: number | null; distance_miles: number | null; avatar_url: string | null }> | null>(null)
  const [previewUsersLoading, setPreviewUsersLoading] = useState(false)
  const [previewUsersOpen, setPreviewUsersOpen] = useState(false)

  // Per-event panel state
  const [openPanel, setOpenPanel] = useState<Record<string, 'preview' | 'rsvps' | 'matching' | null>>({})
  const [eligibleUsers, setEligibleUsers] = useState<Record<string, EligibleUser[]>>({})
  const [checkedUsers, setCheckedUsers] = useState<Record<string, Set<string>>>({})
  const [eligibleLoading, setEligibleLoading] = useState<Record<string, boolean>>({})
  const [sendingId, setSendingId] = useState<string | null>(null)
  const [sendResults, setSendResults] = useState<Record<string, string>>({})
  const [rsvpData, setRsvpData] = useState<Record<string, { rsvps: RsvpRow[]; counts: RsvpCounts }>>({})
  const [rsvpLoading, setRsvpLoading] = useState<Record<string, boolean>>({})
  const [matchingResults, setMatchingResults] = useState<Record<string, string>>({})
  const [matchingRunning, setMatchingRunning] = useState<Record<string, boolean>>({})
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    setListError(null)
    setLoading(true)
    try {
      const headers = await getAuthHeaders()
      const [evRes, mkRes] = await Promise.all([
        fetch('/api/admin/weekly-events', { credentials: 'include', headers }),
        fetch('/api/admin/markets', { credentials: 'include', headers }),
      ])
      if (!evRes.ok) { setListError('Could not load events'); setLoading(false); return }
      const evData = await evRes.json()
      setEvents(evData.events ?? [])
      if (mkRes.ok) {
        const mkData = await mkRes.json()
        const mkList: MarketOption[] = mkData.markets ?? []
        setMarkets(mkList)
        if (mkList.length > 0 && !marketSlug) setMarketSlug(mkList[0].slug)
      }
    } catch (e) {
      setListError(String(e))
    } finally {
      setLoading(false)
    }
  }, [marketSlug])

  useEffect(() => { loadData() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!marketSlug) { setVenues([]); return }
    getAuthHeaders().then(headers => {
      fetch(`/api/admin/venues?limit=200&market_slug=${encodeURIComponent(marketSlug)}`, { credentials: 'include', headers })
        .then(r => r.ok ? r.json() : null)
        .then(data => { if (data) setVenues(data.venues ?? []) })
    })
    setVenueId('')
    setVenueSearch('')
  }, [marketSlug]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!marketSlug) { setPreviewCount(null); setPreviewUsers(null); setPreviewUsersOpen(false); return }
    setPreviewLoading(true)
    setPreviewUsers(null)
    setPreviewUsersOpen(false)
    const t = setTimeout(async () => {
      try {
        const headers = await getAuthHeaders()
        const params = new URLSearchParams({ market_slug: marketSlug })
        if (venueId) params.set('venue_id', venueId)
        if (radiusMiles) params.set('radius_miles', radiusMiles)
        if (genderFilter.length > 0) params.set('gender_filter', genderFilter.join(','))
        if (minAge) params.set('min_age', minAge)
        if (maxAge) params.set('max_age', maxAge)
        const res = await fetch(`/api/admin/weekly-events/preview-count?${params}`, { credentials: 'include', headers })
        const json = await res.json()
        if (res.ok) setPreviewCount(json.count ?? null)
      } finally {
        setPreviewLoading(false)
      }
    }, 500)
    return () => clearTimeout(t)
  }, [marketSlug, venueId, radiusMiles, genderFilter, minAge, maxAge]) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadPreviewUsers() {
    if (!marketSlug) return
    if (previewUsersOpen) { setPreviewUsersOpen(false); return }
    setPreviewUsersLoading(true)
    setPreviewUsersOpen(true)
    try {
      const headers = await getAuthHeaders()
      const params = new URLSearchParams({ market_slug: marketSlug })
      if (venueId) params.set('venue_id', venueId)
      if (radiusMiles) params.set('radius_miles', radiusMiles)
      if (genderFilter.length > 0) params.set('gender_filter', genderFilter.join(','))
      if (minAge) params.set('min_age', minAge)
      if (maxAge) params.set('max_age', maxAge)
      const res = await fetch(`/api/admin/weekly-events/preview-users?${params}`, { credentials: 'include', headers })
      const json = await res.json()
      if (res.ok) setPreviewUsers(json.users ?? [])
    } finally {
      setPreviewUsersLoading(false)
    }
  }

  const filteredVenues = venueSearch.trim().length >= 2
    ? venues.filter(v =>
        v.name.toLowerCase().includes(venueSearch.toLowerCase()) ||
        (v.neighborhood ?? '').toLowerCase().includes(venueSearch.toLowerCase()) ||
        v.city.toLowerCase().includes(venueSearch.toLowerCase())
      )
    : venues.slice(0, 30)

  function toggleGender(g: string) {
    setGenderFilter(prev => prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g])
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    setFormSuccess(null)
    if (!marketSlug) { setFormError('Pick a market'); return }
    if (!eventStartsAt) { setFormError('Set event date & time'); return }
    setSubmitting(true)
    try {
      const headers = await getAuthHeaders()
      // Convert local datetime to UTC ISO string
      const localDate = new Date(eventStartsAt)
      const res = await fetch('/api/admin/weekly-events', {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({
          market_slug: marketSlug,
          event_starts_at: localDate.toISOString(),
          venue_id: venueId || null,
          radius_miles: radiusMiles ? parseFloat(radiusMiles) : null,
          gender_filter: genderFilter.length > 0 ? genderFilter : null,
          min_age: minAge ? parseInt(minAge) : null,
          max_age: maxAge ? parseInt(maxAge) : null,
          max_invites: maxInvites ? parseInt(maxInvites) : null,
          max_capacity: maxCapacity ? parseInt(maxCapacity) : null,
          opt_in_deadline_hours: deadlineHours ? parseInt(deadlineHours) : 24,
        }),
      })
      const json = await res.json()
      if (!res.ok) { setFormError(json.error ?? 'Error'); return }
      setFormSuccess(`Saved event for ${marketSlug}`)
      setVenueSearch('')
      setVenueId('')
      setRadiusMiles('')
      setGenderFilter([])
      setMinAge('')
      setMaxAge('')
      setMaxInvites('')
      setMaxCapacity('')
      setDeadlineHours('24')
      await loadData()
    } catch (e) {
      setFormError(String(e))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDeleteEvent(eventId: string) {
    if (!window.confirm('Delete this event? Users who RSVPed yes will be notified by SMS.')) return
    setDeletingId(eventId)
    try {
      const headers = await getAuthHeaders()
      const res = await fetch(`/api/admin/weekly-events/${eventId}`, { method: 'DELETE', credentials: 'include', headers })
      if (res.ok) {
        setEvents(prev => prev.filter(e => e.id !== eventId))
      } else {
        const json = await res.json().catch(() => ({}))
        alert(`Failed to delete: ${json.error ?? 'unknown error'}`)
      }
    } finally {
      setDeletingId(null)
    }
  }

  async function loadEligibleUsers(eventId: string) {
    setEligibleLoading(p => ({ ...p, [eventId]: true }))
    try {
      const headers = await getAuthHeaders()
      const res = await fetch(`/api/admin/weekly-events/${eventId}/eligible-users`, { credentials: 'include', headers })
      const json = await res.json()
      if (res.ok) {
        const users: EligibleUser[] = json.users ?? []
        setEligibleUsers(p => ({ ...p, [eventId]: users }))
        setCheckedUsers(p => ({
          ...p,
          [eventId]: new Set(users.filter(u => !u.already_invited && !u.already_rsvpd && !u.in_active_flow && !u.in_cooldown).map(u => u.id)),
        }))
      }
    } finally {
      setEligibleLoading(p => ({ ...p, [eventId]: false }))
    }
  }

  async function loadRsvps(eventId: string) {
    setRsvpLoading(p => ({ ...p, [eventId]: true }))
    try {
      const headers = await getAuthHeaders()
      const res = await fetch(`/api/admin/weekly-events/${eventId}/rsvps`, { credentials: 'include', headers })
      const json = await res.json()
      if (res.ok) {
        setRsvpData(p => ({ ...p, [eventId]: { rsvps: json.rsvps ?? [], counts: json.counts ?? { yes: 0, no: 0, cancelled: 0, no_response: 0 } } }))
      }
    } finally {
      setRsvpLoading(p => ({ ...p, [eventId]: false }))
    }
  }

  function togglePanel(eventId: string, panel: 'preview' | 'rsvps' | 'matching') {
    const current = openPanel[eventId]
    const next = current === panel ? null : panel
    setOpenPanel(p => ({ ...p, [eventId]: next }))
    if (next === 'preview' && !eligibleUsers[eventId]) loadEligibleUsers(eventId)
    if (next === 'rsvps' && !rsvpData[eventId]) loadRsvps(eventId)
  }

  function toggleUser(eventId: string, userId: string) {
    setCheckedUsers(p => {
      const set = new Set(p[eventId] ?? [])
      if (set.has(userId)) set.delete(userId)
      else set.add(userId)
      return { ...p, [eventId]: set }
    })
  }

  function toggleAllUsers(eventId: string, users: EligibleUser[]) {
    const eligible = users.filter(u => !u.already_invited && !u.already_rsvpd && !u.in_active_flow && !u.in_cooldown)
    const checked = checkedUsers[eventId] ?? new Set()
    const allChecked = eligible.every(u => checked.has(u.id))
    setCheckedUsers(p => ({
      ...p,
      [eventId]: allChecked ? new Set() : new Set(eligible.map(u => u.id)),
    }))
  }

  async function handleSendOptIns(eventId: string) {
    setSendingId(eventId)
    setSendResults(prev => ({ ...prev, [eventId]: '' }))
    try {
      const headers = await getAuthHeaders()
      const checked = checkedUsers[eventId]
      const body: Record<string, unknown> = {}
      if (checked && checked.size > 0) body.user_ids = Array.from(checked)
      const res = await fetch(`/api/admin/weekly-events/${eventId}/send-opt-in`, {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) {
        setSendResults(prev => ({ ...prev, [eventId]: `Error: ${json.error ?? 'unknown'}` }))
      } else {
        setSendResults(prev => ({ ...prev, [eventId]: `Sent ${json.sent ?? 0}, skipped ${json.skipped ?? 0}` }))
        await loadEligibleUsers(eventId)
      }
    } catch (e) {
      setSendResults(prev => ({ ...prev, [eventId]: `Error: ${String(e)}` }))
    } finally {
      setSendingId(null)
    }
  }

  async function handleRunMatching(eventId: string) {
    setMatchingRunning(p => ({ ...p, [eventId]: true }))
    setMatchingResults(p => ({ ...p, [eventId]: '' }))
    try {
      const headers = await getAuthHeaders()
      const res = await fetch(`/api/admin/weekly-events/${eventId}/run-matching`, {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({}),
      })
      const json = await res.json()
      if (!res.ok) {
        setMatchingResults(p => ({ ...p, [eventId]: `Error: ${json.error ?? 'unknown'}` }))
      } else {
        setMatchingResults(p => ({ ...p, [eventId]: `${json.matched ?? 0} matched, ${json.unmatched ?? 0} unmatched` }))
      }
    } catch (e) {
      setMatchingResults(p => ({ ...p, [eventId]: `Error: ${String(e)}` }))
    } finally {
      setMatchingRunning(p => ({ ...p, [eventId]: false }))
    }
  }

  return (
    <main style={{ maxWidth: 900, margin: '0 auto', padding: '2rem 1rem' }}>
      <h1 style={{ fontSize: '1.4rem', fontWeight: 700, marginBottom: '1.5rem' }}>Weekly events</h1>

      <section style={{ marginBottom: '2.5rem' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>Create event</h2>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxWidth: 520 }}>
          <div>
            <label style={labelStyle}>Market</label>
            <select value={marketSlug} onChange={e => setMarketSlug(e.target.value)} style={inputStyle}>
              {markets.map(m => <option key={m.slug} value={m.slug}>{m.label ?? m.slug}</option>)}
            </select>
          </div>

          <div>
            <label style={labelStyle}>Event date & time (local PT)</label>
            <input
              type="datetime-local"
              value={eventStartsAt}
              onChange={e => setEventStartsAt(e.target.value)}
              style={inputStyle}
            />
            <p style={{ margin: '4px 0 0', fontSize: '0.78rem', color: '#888' }}>
              Create events and send invites at least 3 days out — the day-before confirmation fires automatically 24h before.
            </p>
          </div>

          <div>
            <label style={labelStyle}>Venue (optional)</label>
            <input
              type="text"
              placeholder="Search venue..."
              value={venueSearch}
              onChange={e => { setVenueSearch(e.target.value); setVenueId('') }}
              style={{ ...inputStyle, marginBottom: 4 }}
            />
            <select
              value={venueId}
              onChange={e => setVenueId(e.target.value)}
              size={Math.min(filteredVenues.length + 1, 6)}
              style={{ width: '100%', padding: '0.2rem', borderRadius: 4, border: '1px solid #ccc' }}
            >
              <option value="">— No venue —</option>
              {filteredVenues.map(v => (
                <option key={v.id} value={v.id}>
                  {v.name}{v.neighborhood ? ` (${v.neighborhood})` : ''} — {v.city}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={labelStyle}>Radius (miles, optional)</label>
            <input
              type="number" min={0} step={0.5} placeholder="Leave blank for entire market"
              value={radiusMiles} onChange={e => setRadiusMiles(e.target.value)}
              style={{ ...inputStyle, maxWidth: 200 }}
            />
          </div>

          <div>
            <label style={labelStyle}>Gender filter (leave all unchecked for any)</label>
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              {GENDER_OPTIONS.map(g => (
                <label key={g} style={{ fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                  <input type="checkbox" checked={genderFilter.includes(g)} onChange={() => toggleGender(g)} />
                  {g.charAt(0).toUpperCase() + g.slice(1)}
                </label>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '1rem' }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Min age</label>
              <input type="number" min={18} max={99} placeholder="e.g. 25" value={minAge} onChange={e => setMinAge(e.target.value)} style={inputStyle} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Max age</label>
              <input type="number" min={18} max={99} placeholder="e.g. 40" value={maxAge} onChange={e => setMaxAge(e.target.value)} style={inputStyle} />
            </div>
          </div>

          <div style={{ display: 'flex', gap: '1rem' }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Max invites (opt-in cap)</label>
              <input type="number" min={1} placeholder="No limit" value={maxInvites} onChange={e => setMaxInvites(e.target.value)} style={inputStyle} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Max Yes RSVPs (capacity)</label>
              <input type="number" min={1} placeholder="No limit" value={maxCapacity} onChange={e => setMaxCapacity(e.target.value)} style={inputStyle} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Opt-in deadline (hrs)</label>
              <input type="number" min={1} max={72} value={deadlineHours} onChange={e => setDeadlineHours(e.target.value)} style={inputStyle} />
            </div>
          </div>

          <div style={{ minHeight: '1.2em', marginBottom: '0.5rem' }}>
            {previewLoading
              ? <span style={{ fontSize: '0.85rem', color: '#999' }}>Counting eligible users…</span>
              : previewCount !== null
                ? <button type="button" onClick={loadPreviewUsers} style={{ background: 'none', border: 'none', padding: 0, fontSize: '0.85rem', color: '#0070f3', cursor: 'pointer', textDecoration: 'underline' }}>
                    {previewCount} eligible user{previewCount === 1 ? '' : 's'} with these filters
                  </button>
                : null}
          </div>
          {previewUsersOpen && (
            <div style={{ border: '1px solid #eee', borderRadius: 4, marginBottom: '0.75rem', maxHeight: 220, overflowY: 'auto' }}>
              {previewUsersLoading
                ? <p style={{ padding: '0.5rem 0.75rem', fontSize: '0.82rem', color: '#999' }}>Loading…</p>
                : (previewUsers ?? []).length === 0
                  ? <p style={{ padding: '0.5rem 0.75rem', fontSize: '0.82rem', color: '#999' }}>No users found.</p>
                  : (previewUsers ?? []).map(u => (
                    <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.35rem 0.75rem', borderBottom: '1px solid #f0f0f0', fontSize: '0.82rem' }}>
                      {u.avatar_url
                        ? <img src={u.avatar_url} alt="" style={{ width: 24, height: 24, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                        : <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#e0e0e0', flexShrink: 0 }} />}
                      <span style={{ flex: 1 }}>{u.first_name || '—'}</span>
                      {u.gender && <span style={{ color: '#888' }}>{u.gender}</span>}
                      {u.age && <span style={{ color: '#888' }}>{u.age}y</span>}
                      {u.distance_miles != null && <span style={{ color: '#aaa' }}>{u.distance_miles}mi</span>}
                    </div>
                  ))}
            </div>
          )}

          {formError && <p style={{ color: '#c00', fontSize: '0.85rem' }}>{formError}</p>}
          {formSuccess && <p style={{ color: '#090', fontSize: '0.85rem' }}>{formSuccess}</p>}
          <button type="submit" disabled={submitting} style={btnStyle(submitting)}>
            {submitting ? 'Saving…' : 'Create event'}
          </button>
        </form>
      </section>

      <section>
        <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>Recent events</h2>
        {loading && <p style={{ color: '#666', fontSize: '0.9rem' }}>Loading…</p>}
        {listError && <p style={{ color: '#c00', fontSize: '0.9rem' }}>{listError}</p>}
        {!loading && !listError && events.length === 0 && (
          <p style={{ color: '#666', fontSize: '0.9rem' }}>No events yet.</p>
        )}
        {!loading && events.map(ev => (
          <div key={ev.id} style={{ border: '1px solid #ddd', borderRadius: 6, marginBottom: '1rem', overflow: 'hidden' }}>
            {/* Event header row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.75rem 1rem', background: '#fafafa', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{ev.market_slug}</div>
                <div style={{ fontSize: '0.85rem', color: '#555' }}>{formatEventTime(ev.event_starts_at)}</div>
                {ev.venues && (
                  <div style={{ fontSize: '0.8rem', color: '#777' }}>
                    {ev.venues.name}{ev.venues.neighborhood ? ` · ${ev.venues.neighborhood}` : ''}
                  </div>
                )}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#888' }}>{filterSummary(ev)}</div>
              <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
                <PanelButton label="Send" active={openPanel[ev.id] === 'preview'} onClick={() => togglePanel(ev.id, 'preview')} />
                <PanelButton label="RSVPs" active={openPanel[ev.id] === 'rsvps'} onClick={() => togglePanel(ev.id, 'rsvps')} />
                <PanelButton label="Matching" active={openPanel[ev.id] === 'matching'} onClick={() => togglePanel(ev.id, 'matching')} />
                <button
                  onClick={() => handleDeleteEvent(ev.id)}
                  disabled={deletingId === ev.id}
                  style={{ padding: '0.3rem 0.7rem', fontSize: '0.78rem', borderRadius: 4, border: '1px solid #e55', background: 'transparent', color: '#c33', cursor: 'pointer', opacity: deletingId === ev.id ? 0.5 : 1 }}
                >
                  {deletingId === ev.id ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </div>

            {/* SMS timeline */}
            {ev.event_starts_at && (
              <div style={{ padding: '0.4rem 1rem', borderTop: '1px solid #f0f0f0', fontSize: '0.75rem', color: '#888', display: 'flex', gap: '1.25rem', flexWrap: 'wrap', background: '#fafafa' }}>
                <span><b style={{ color: '#555' }}>Day-before SMS</b> {formatEventTime(new Date(new Date(ev.event_starts_at).getTime() - 24 * 60 * 60 * 1000).toISOString())}</span>
                <span><b style={{ color: '#555' }}>Cutoff</b> {formatEventTime(new Date(new Date(ev.event_starts_at).getTime() - 6 * 60 * 60 * 1000).toISOString())}</span>
                <span><b style={{ color: '#555' }}>Pre-event SMS</b> {formatEventTime(new Date(new Date(ev.event_starts_at).getTime() - 5 * 60 * 60 * 1000).toISOString())}</span>
                <span><b style={{ color: '#555' }}>Reveal</b> {formatEventTime(new Date(new Date(ev.event_starts_at).getTime() - 30 * 60 * 1000).toISOString())}</span>
              </div>
            )}

            {/* Panel A — Preview & Send */}
            {openPanel[ev.id] === 'preview' && (
              <div style={{ padding: '1rem', borderTop: '1px solid #eee' }}>
                {eligibleLoading[ev.id] && <p style={{ fontSize: '0.85rem', color: '#666' }}>Loading eligible users…</p>}
                {!eligibleLoading[ev.id] && eligibleUsers[ev.id] && (() => {
                  const users = eligibleUsers[ev.id]!
                  const checked = checkedUsers[ev.id] ?? new Set()
                  const eligible = users.filter(u => !u.already_invited && !u.already_rsvpd && !u.in_active_flow && !u.in_cooldown)
                  const allChecked = eligible.length > 0 && eligible.every(u => checked.has(u.id))
                  return (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.85rem' }}>
                          <b>{users.length}</b> in market · <b>{eligible.length}</b> will receive invite · <b>{checked.size}</b> selected
                        </span>
                        <button onClick={() => toggleAllUsers(ev.id, users)} style={{ ...btnStyle(false), padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}>
                          {allChecked ? 'Deselect all' : 'Select all new'}
                        </button>
                        <button onClick={() => loadEligibleUsers(ev.id)} style={{ ...btnStyle(false), padding: '0.25rem 0.6rem', fontSize: '0.75rem', background: '#666' }}>
                          Refresh
                        </button>
                      </div>
                      <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid #eee', borderRadius: 4, marginBottom: '0.75rem' }}>
                        {users.map(u => {
                          const isChecked = checked.has(u.id)
                          const disabled = u.already_invited || u.already_rsvpd || u.in_active_flow || u.in_cooldown
                          return (
                            <label key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.4rem 0.6rem', borderBottom: '1px solid #f0f0f0', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1 }}>
                              <input
                                type="checkbox"
                                checked={isChecked}
                                disabled={disabled}
                                onChange={() => !disabled && toggleUser(ev.id, u.id)}
                              />
                              <span style={{ fontSize: '0.82rem', flex: 1 }}>
                                {u.first_name ?? u.id.slice(0, 8)}
                                {u.gender ? ` · ${u.gender}` : ''}
                                {u.age ? ` · ${u.age}` : ''}
                                {u.distance_miles != null ? ` · ${u.distance_miles} mi` : ''}
                              </span>
                              {u.already_rsvpd && <span style={{ fontSize: '0.72rem', color: '#090' }}>RSVPd</span>}
                              {u.already_invited && !u.already_rsvpd && <span style={{ fontSize: '0.72rem', color: '#c70' }}>Invited</span>}
                              {u.in_active_flow && !u.already_invited && !u.already_rsvpd && <span style={{ fontSize: '0.72rem', color: '#999' }}>In flow</span>}
                              {u.in_cooldown && !u.in_active_flow && !u.already_invited && !u.already_rsvpd && <span style={{ fontSize: '0.72rem', color: '#999' }}>Cooldown</span>}
                            </label>
                          )
                        })}
                      </div>
                      {ev.event_starts_at && (() => {
                        const hoursUntil = (new Date(ev.event_starts_at).getTime() - Date.now()) / (1000 * 60 * 60)
                        return hoursUntil > 0 && hoursUntil < 48
                          ? <div style={{ background: '#fffbe6', border: '1px solid #e6c700', borderRadius: 4, padding: '0.45rem 0.7rem', fontSize: '0.81rem', color: '#7a5c00', marginBottom: '0.75rem' }}>
                              ⚠️ This event starts in {Math.round(hoursUntil)}h — the day-before confirmation SMS may fire before users have had time to RSVP.
                            </div>
                          : null
                      })()}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                        <button
                          onClick={() => handleSendOptIns(ev.id)}
                          disabled={sendingId === ev.id || checked.size === 0}
                          style={{ ...btnStyle(sendingId === ev.id || checked.size === 0), padding: '0.4rem 1rem', fontSize: '0.85rem' }}
                        >
                          {sendingId === ev.id ? 'Sending…' : `Send to ${checked.size} users`}
                        </button>
                        {sendResults[ev.id] && (
                          <span style={{ fontSize: '0.82rem', color: sendResults[ev.id].startsWith('Error') ? '#c00' : '#090' }}>
                            {sendResults[ev.id]}
                          </span>
                        )}
                      </div>
                    </>
                  )
                })()}
              </div>
            )}

            {/* Panel B — RSVPs */}
            {openPanel[ev.id] === 'rsvps' && (
              <div style={{ padding: '1rem', borderTop: '1px solid #eee' }}>
                {rsvpLoading[ev.id] && <p style={{ fontSize: '0.85rem', color: '#666' }}>Loading RSVPs…</p>}
                {!rsvpLoading[ev.id] && rsvpData[ev.id] && (() => {
                  const { rsvps, counts } = rsvpData[ev.id]!
                  return (
                    <>
                      <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '0.75rem', fontSize: '0.85rem', flexWrap: 'wrap' }}>
                        <span style={{ color: '#090' }}><b>{counts.yes}</b> Yes</span>
                        <span style={{ color: '#c00' }}><b>{counts.no}</b> No</span>
                        <span style={{ color: '#c70' }}><b>{counts.cancelled}</b> Cancelled</span>
                        <span style={{ color: '#999' }}><b>{counts.no_response}</b> No response</span>
                        <button onClick={() => loadRsvps(ev.id)} style={{ ...btnStyle(false), padding: '0.15rem 0.5rem', fontSize: '0.72rem', background: '#666' }}>Refresh</button>
                      </div>
                      {rsvps.length === 0 && <p style={{ color: '#888', fontSize: '0.85rem' }}>No RSVPs yet.</p>}
                      <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid #eee', borderRadius: 4 }}>
                        {rsvps.map((r, i) => {
                          const p = r.profiles
                          const name = p?.first_name ?? r.user_id.slice(0, 8)
                          const decisionColor = r.decision === 'yes' ? '#090' : r.decision === 'no' ? '#c00' : r.decision === 'cancelled' ? '#c70' : '#999'
                          return (
                            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.35rem 0.6rem', borderBottom: '1px solid #f0f0f0', fontSize: '0.82rem' }}>
                              <span style={{ flex: 1 }}>{name}</span>
                              <span style={{ color: decisionColor, fontWeight: 600 }}>{r.decision}</span>
                              {r.decided_at && <span style={{ color: '#aaa', fontSize: '0.72rem' }}>{new Date(r.decided_at).toLocaleDateString()}</span>}
                            </div>
                          )
                        })}
                      </div>
                    </>
                  )
                })()}
              </div>
            )}

            {/* Panel C — Matching & Reveals */}
            {openPanel[ev.id] === 'matching' && (
              <div style={{ padding: '1rem', borderTop: '1px solid #eee' }}>
                <div style={{ fontSize: '0.85rem', marginBottom: '0.75rem', color: '#555' }}>
                  {ev.reveals_sent_at
                    ? `Reveals sent at ${formatEventTime(ev.reveals_sent_at)}.`
                    : ev.event_starts_at
                      ? `Reveals auto-fire 30 min before event (${formatEventTime(new Date(new Date(ev.event_starts_at).getTime() - 30 * 60000).toISOString())}).`
                      : 'Set event start time to enable auto-reveal.'}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <button
                    onClick={() => handleRunMatching(ev.id)}
                    disabled={matchingRunning[ev.id]}
                    style={{ ...btnStyle(matchingRunning[ev.id]), padding: '0.4rem 1rem', fontSize: '0.85rem' }}
                  >
                    {matchingRunning[ev.id] ? 'Running…' : 'Run matching'}
                  </button>
                  {matchingResults[ev.id] && (
                    <span style={{ fontSize: '0.82rem', color: matchingResults[ev.id].startsWith('Error') ? '#c00' : '#090' }}>
                      {matchingResults[ev.id]}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </section>
    </main>
  )
}

function PanelButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '0.25rem 0.65rem',
        fontSize: '0.78rem',
        borderRadius: 4,
        border: '1px solid #ccc',
        background: active ? '#222' : '#fff',
        color: active ? '#fff' : '#333',
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  )
}

const labelStyle: React.CSSProperties = { fontSize: '0.85rem', display: 'block', marginBottom: 4 }
const inputStyle: React.CSSProperties = { width: '100%', padding: '0.4rem 0.5rem', borderRadius: 4, border: '1px solid #ccc', boxSizing: 'border-box' }
function btnStyle(disabled: boolean): React.CSSProperties {
  return { padding: '0.5rem 1.2rem', borderRadius: 4, background: '#222', color: '#fff', border: 'none', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.6 : 1, alignSelf: 'flex-start' }
}
