'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { FeatureGroup as LeafletFeatureGroup } from 'leaflet'
import { getSupabase } from '@/lib/supabase'
import dynamic from 'next/dynamic'

const MapContainer = dynamic(
  () => import('react-leaflet').then((m) => m.MapContainer),
  { ssr: false }
)
const TileLayer = dynamic(
  () => import('react-leaflet').then((m) => m.TileLayer),
  { ssr: false }
)
const Polygon = dynamic(
  () => import('react-leaflet').then((m) => m.Polygon),
  { ssr: false }
)
const FeatureGroup = dynamic(
  () => import('react-leaflet').then((m) => m.FeatureGroup),
  { ssr: false }
)
const CircleMarker = dynamic(
  () => import('react-leaflet').then((m) => m.CircleMarker),
  { ssr: false }
)
const Popup = dynamic(
  () => import('react-leaflet').then((m) => m.Popup),
  { ssr: false }
)
const EditControl = dynamic(
  () => import('react-leaflet-draw').then((m) => m.EditControl),
  { ssr: false }
)

interface MapPoint {
  id: string
  lat: number
  lng: number
  market: string | null
  city: string | null
  first_name: string | null
}

interface MapPolygon {
  slug: string
  label: string
  coordinates: number[][][]
}

function getFirstPolygonGeometry(geo: GeoJSON.GeoJSON): GeoJSON.Polygon | null {
  if (geo.type === 'Polygon') return geo
  if (geo.type === 'FeatureCollection' && geo.features?.length) {
    const f = geo.features.find((feat) => feat.geometry?.type === 'Polygon')
    return f?.geometry as GeoJSON.Polygon ?? null
  }
  if (geo.type === 'Feature' && geo.geometry?.type === 'Polygon') return geo.geometry
  return null
}

export default function AdminMapClient() {
  const [data, setData] = useState<{ points: MapPoint[]; polygons: MapPolygon[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [editMarketSlug, setEditMarketSlug] = useState<string | null>(null)
  const [hasEdited, setHasEdited] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const editGroupRef = useRef<LeafletFeatureGroup | null>(null)

  const loadData = useCallback(async () => {
    const supabase = getSupabase()
    const { data: { session } } = await supabase?.auth.getSession() ?? { data: { session: null } }
    const headers: HeadersInit = { 'Content-Type': 'application/json' }
    if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`
    const res = await fetch('/api/admin/map-data', { credentials: 'include', headers })
    if (res.status === 401) {
      const d = await res.json().catch(() => ({}))
      if (d?.code === 'NO_SESSION') window.location.href = '/login?next=/admin/map'
      throw new Error('Not signed in')
    }
    if (res.status === 403) throw new Error("Your account doesn't have admin access.")
    if (!res.ok) throw new Error('Failed to load map data')
    const json = await res.json()
    return { points: json.points ?? [], polygons: json.polygons ?? [] }
  }, [])

  useEffect(() => {
    let cancelled = false
    loadData()
      .then((d) => {
        if (!cancelled) {
          setData(d)
          setError(null)
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [loadData])

  async function handleSaveBoundary() {
    const layer = editGroupRef.current
    if (!editMarketSlug || !layer?.toGeoJSON) return
    const geo = layer.toGeoJSON()
    const polygon = getFirstPolygonGeometry(geo)
    if (!polygon) {
      setSaveError('No polygon to save. Draw or edit a polygon first.')
      return
    }
    setSaveError(null)
    setSaving(true)
    try {
      const supabase = getSupabase()
      const { data: { session } } = await supabase?.auth.getSession() ?? { data: { session: null } }
      const res = await fetch(`/api/admin/markets/${encodeURIComponent(editMarketSlug)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ boundary: polygon }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error((err as { error?: string }).error || res.statusText)
      }
      const next = await loadData()
      setData(next)
      setEditMarketSlug(null)
      setHasEdited(false)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="admin-loading">Loading map…</div>
  }
  if (error) {
    return (
      <div className="admin-card admin-card-narrow">
        <p className="admin-error" role="alert">{error}</p>
      </div>
    )
  }
  if (!data) return null

  const editingPolygon = editMarketSlug ? data.polygons.find((p) => p.slug === editMarketSlug) : null

  return (
    <div className="admin-card">
      <h1 className="admin-title">Sign-ups map</h1>
      <p className="admin-description" style={{ marginBottom: '1rem' }}>
        Exact lat/lng with zone boundaries. Only profiles with location set are shown.
      </p>
      <div style={{ marginBottom: '0.75rem', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem' }}>
        <label htmlFor="admin-map-edit-market" style={{ fontWeight: 500 }}>
          Edit boundary:
        </label>
        <select
          id="admin-map-edit-market"
          value={editMarketSlug ?? ''}
          onChange={(e) => {
            setEditMarketSlug(e.target.value || null)
            setHasEdited(false)
            setSaveError(null)
          }}
          style={{ padding: '4px 8px', borderRadius: 4 }}
        >
          <option value="">View only</option>
          {data.polygons.map((p) => (
            <option key={p.slug} value={p.slug}>
              {p.label}
            </option>
          ))}
        </select>
        {editMarketSlug && (
          <>
            <button
              type="button"
              onClick={handleSaveBoundary}
              disabled={saving || !hasEdited}
              className="admin-button"
            >
              {saving ? 'Saving…' : 'Save boundary'}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditMarketSlug(null)
                setHasEdited(false)
                setSaveError(null)
              }}
              className="admin-button"
              style={{ marginLeft: 4 }}
            >
              Cancel
            </button>
          </>
        )}
      </div>
      {saveError && (
        <p className="admin-error" style={{ marginBottom: '0.75rem' }} role="alert">
          {saveError}
        </p>
      )}
      <div style={{ height: 560, width: '100%', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--color-border, #e5e5e5)' }}>
        <MapContainer
          center={[39, -98]}
          zoom={4}
          style={{ height: '100%', width: '100%' }}
          scrollWheelZoom
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {data.polygons
            .filter((poly) => poly.slug !== editMarketSlug)
            .map((poly) => {
              const ring = poly.coordinates[0]
              if (!ring?.length) return null
              const positions: [number, number][] = ring.map(([lng, lat]) => [lat, lng])
              return (
                <Polygon
                  key={poly.slug}
                  positions={positions}
                  pathOptions={{
                    color: '#2563eb',
                    fillColor: '#3b82f6',
                    fillOpacity: 0.15,
                    weight: 2,
                  }}
                  eventHandlers={{
                    mouseover: (e) => {
                      e.target.setStyle({ fillOpacity: 0.25 })
                      e.target.bringToFront()
                    },
                    mouseout: (e) => {
                      e.target.setStyle({ fillOpacity: 0.15 })
                    },
                  }}
                >
                  <Popup>{poly.label}</Popup>
                </Polygon>
              )
            })}
          {editMarketSlug && editingPolygon && (
            <FeatureGroup ref={editGroupRef}>
              {editingPolygon.coordinates[0]?.length > 0 && (
                <Polygon
                  key={editingPolygon.slug}
                  positions={editingPolygon.coordinates[0].map(([lng, lat]) => [lat, lng])}
                  pathOptions={{
                    color: '#2563eb',
                    fillColor: '#3b82f6',
                    fillOpacity: 0.2,
                    weight: 2,
                  }}
                />
              )}
              <EditControl
                position="topright"
                draw={{
                  polygon: true,
                  rectangle: false,
                  circle: false,
                  marker: false,
                  polyline: false,
                  circlemarker: false,
                }}
                edit={{ edit: true, remove: true }}
                onCreated={() => setHasEdited(true)}
                onEdited={() => setHasEdited(true)}
                onDeleted={() => setHasEdited(true)}
              />
            </FeatureGroup>
          )}
          {data.points.map((p) => (
            <CircleMarker
              key={p.id}
              center={[p.lat, p.lng]}
              radius={6}
              pathOptions={{ color: '#dc2626', fillColor: '#ef4444', fillOpacity: 0.9, weight: 1 }}
            >
              <Popup>
                <div style={{ minWidth: 160 }}>
                  <p style={{ margin: 0, fontWeight: 600 }}>{p.first_name || '—'}</p>
                  <p style={{ margin: '4px 0 0 0', fontSize: 12, color: '#666' }}>
                    {p.city || '—'} · {p.market || 'no market'}
                  </p>
                  <p style={{ margin: '4px 0 0 0', fontSize: 11, fontFamily: 'monospace' }}>
                    {p.lat.toFixed(6)}, {p.lng.toFixed(6)}
                  </p>
                </div>
              </Popup>
            </CircleMarker>
          ))}
        </MapContainer>
      </div>
    </div>
  )
}
