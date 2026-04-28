'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { getSupabase } from '@/lib/supabase'

type VenueRow = {
  id: string
  name: string
  neighborhood: string | null
  city: string
  address: string | null
  lat: number | string | null
  lng: number | string | null
  google_place_id: string | null
  google_permanently_closed: boolean | null
  created_at: string | null
}

async function getAuthHeaders(): Promise<HeadersInit> {
  const supabase = getSupabase()
  const {
    data: { session },
  } = await supabase?.auth.getSession() ?? { data: { session: null } }
  const headers: HeadersInit = { 'Content-Type': 'application/json' }
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`
  return headers
}

export default function AdminVenuesPage() {
  const [venues, setVenues] = useState<VenueRow[]>([])
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [city, setCity] = useState('')
  const [neighborhood, setNeighborhood] = useState('')
  const [address, setAddress] = useState('')
  const [lat, setLat] = useState('')
  const [lng, setLng] = useState('')
  const [googlePlaceId, setGooglePlaceId] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [formSuccess, setFormSuccess] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [geocoding, setGeocoding] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400)
    return () => clearTimeout(t)
  }, [search])

  const loadVenues = useCallback(async () => {
    setListError(null)
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: '100' })
      const q = debouncedSearch.trim()
      if (q.length >= 2) params.set('q', q)
      const res = await fetch(`/api/admin/venues?${params}`, {
        credentials: 'include',
        headers: await getAuthHeaders(),
      })
      const json = await res.json().catch(() => ({}))
      if (res.status === 403 && json?.code === 'NOT_ADMIN') {
        window.location.href = '/login?next=/admin/venues'
        return
      }
      if (!res.ok) throw new Error(json?.error ?? 'Failed to load venues')
      setVenues(json.venues ?? [])
    } catch (e) {
      setListError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [debouncedSearch])

  useEffect(() => {
    void loadVenues()
  }, [loadVenues])

  async function fillLatLngFromGoogle() {
    setFormError(null)
    setFormSuccess(null)
    setGeocoding(true)
    try {
      const res = await fetch('/api/admin/venues/geocode-suggest', {
        method: 'POST',
        credentials: 'include',
        headers: await getAuthHeaders(),
        body: JSON.stringify({
          name,
          neighborhood,
          address,
          city,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error ?? 'Geocode failed')
      setLat(String(json.lat))
      setLng(String(json.lng))
      if (json.formatted_address) {
        setFormSuccess(`Google: ${json.formatted_address as string}`)
      } else {
        setFormSuccess('Coordinates filled from Google.')
      }
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Geocode failed')
    } finally {
      setGeocoding(false)
    }
  }

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    setFormSuccess(null)
    setSubmitting(true)
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        city: city.trim(),
        neighborhood: neighborhood.trim() || undefined,
        address: address.trim() || undefined,
        google_place_id: googlePlaceId.trim() || undefined,
      }
      if (lat.trim() && lng.trim()) {
        body.lat = Number(lat.trim())
        body.lng = Number(lng.trim())
      }
      const res = await fetch('/api/admin/venues', {
        method: 'POST',
        credentials: 'include',
        headers: await getAuthHeaders(),
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error ?? 'Create failed')
      setFormSuccess(`Saved. Venue id: ${json.venue?.id ?? '—'}`)
      setName('')
      setNeighborhood('')
      setAddress('')
      setLat('')
      setLng('')
      setGooglePlaceId('')
      await loadVenues()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Create failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="admin-markets-page" style={{ maxWidth: 960, margin: '0 auto', padding: '1.25rem 1rem 3rem' }}>
      <h1 style={{ fontSize: '1.35rem', marginBottom: '0.35rem' }}>Venues</h1>
      <p style={{ color: 'var(--color-textSecondary, #666)', marginBottom: '1.25rem', fontSize: '0.95rem' }}>
        Add rows to <code>public.venues</code> for SMS venue pick, admin map, and Fika socials session setup. Coordinates are
        required for distance-based matching; use Google fill when an API key is configured.
      </p>

      <section
        style={{
          border: '1px solid var(--color-border, #ddd)',
          borderRadius: 8,
          padding: '1rem',
          marginBottom: '1.5rem',
        }}
      >
        <h2 style={{ fontSize: '1.05rem', marginBottom: '0.75rem' }}>Add venue</h2>
        <form onSubmit={submitCreate}>
          <div style={{ display: 'grid', gap: '0.65rem', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
            <label>
              <span style={{ display: 'block', fontSize: '0.8rem', marginBottom: 2 }}>Name *</span>
              <input value={name} onChange={(e) => setName(e.target.value)} required style={{ width: '100%' }} />
            </label>
            <label>
              <span style={{ display: 'block', fontSize: '0.8rem', marginBottom: 2 }}>City *</span>
              <input value={city} onChange={(e) => setCity(e.target.value)} required style={{ width: '100%' }} />
            </label>
            <label>
              <span style={{ display: 'block', fontSize: '0.8rem', marginBottom: 2 }}>Neighborhood</span>
              <input value={neighborhood} onChange={(e) => setNeighborhood(e.target.value)} style={{ width: '100%' }} />
            </label>
            <label style={{ gridColumn: 'span 2 / auto' }}>
              <span style={{ display: 'block', fontSize: '0.8rem', marginBottom: 2 }}>Street address</span>
              <input value={address} onChange={(e) => setAddress(e.target.value)} style={{ width: '100%' }} />
            </label>
            <label>
              <span style={{ display: 'block', fontSize: '0.8rem', marginBottom: 2 }}>Latitude</span>
              <input
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                inputMode="decimal"
                placeholder="34.05"
                style={{ width: '100%' }}
              />
            </label>
            <label>
              <span style={{ display: 'block', fontSize: '0.8rem', marginBottom: 2 }}>Longitude</span>
              <input
                value={lng}
                onChange={(e) => setLng(e.target.value)}
                inputMode="decimal"
                placeholder="-118.24"
                style={{ width: '100%' }}
              />
            </label>
            <label style={{ gridColumn: 'span 2 / auto' }}>
              <span style={{ display: 'block', fontSize: '0.8rem', marginBottom: 2 }}>Google Place ID (optional, dedupe)</span>
              <input value={googlePlaceId} onChange={(e) => setGooglePlaceId(e.target.value)} style={{ width: '100%' }} />
            </label>
          </div>
          <div style={{ marginTop: '0.85rem', display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
            <button type="submit" className="admin-btn admin-btn-primary" disabled={submitting}>
              {submitting ? 'Saving…' : 'Create venue'}
            </button>
            <button type="button" className="admin-btn" disabled={geocoding} onClick={() => void fillLatLngFromGoogle()}>
              {geocoding ? 'Geocoding…' : 'Fill lat/lng from Google'}
            </button>
          </div>
          {formError ? (
            <p style={{ color: '#b00020', marginTop: '0.75rem', marginBottom: 0 }} role="alert">
              {formError}
            </p>
          ) : null}
          {formSuccess ? (
            <p style={{ color: 'var(--color-success, #0a0)', marginTop: '0.75rem', marginBottom: 0 }}>{formSuccess}</p>
          ) : null}
        </form>
      </section>

      <section
        style={{
          border: '1px solid var(--color-border, #ddd)',
          borderRadius: 8,
          padding: '1rem',
        }}
      >
        <h2 style={{ fontSize: '1.05rem', marginBottom: '0.75rem' }}>Recent venues</h2>
        <label style={{ display: 'block', marginBottom: '0.65rem', maxWidth: 320 }}>
          <span style={{ display: 'block', fontSize: '0.8rem', marginBottom: 2 }}>Search name or city</span>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Min 2 characters" style={{ width: '100%' }} />
        </label>
        {listError ? (
          <p style={{ color: '#b00020' }} role="alert">
            {listError}
          </p>
        ) : null}
        {loading ? (
          <p>Loading…</p>
        ) : venues.length === 0 ? (
          <p style={{ color: '#666' }}>No venues yet.</p>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table" style={{ fontSize: '0.85rem' }}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>City</th>
                  <th className="admin-table-num">Lat</th>
                  <th className="admin-table-num">Lng</th>
                  <th>Closed</th>
                </tr>
              </thead>
              <tbody>
                {venues.map((v) => (
                  <tr key={v.id}>
                    <td>{v.name}</td>
                    <td>{v.city}</td>
                    <td className="admin-table-num">{v.lat != null ? String(v.lat).slice(0, 9) : '—'}</td>
                    <td className="admin-table-num">{v.lng != null ? String(v.lng).slice(0, 10) : '—'}</td>
                    <td>{v.google_permanently_closed ? 'yes' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="admin-back" style={{ marginTop: '1.25rem' }}>
        <Link href="/admin/fika-socials">Fika socials</Link>
        {' · '}
        <Link href="/admin">Admin home</Link>
      </p>
    </main>
  )
}
