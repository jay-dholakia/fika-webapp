'use client'

import './leaflet-flat-patch'
import { useCallback, useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import type { FeatureGroup as LeafletFeatureGroup } from 'leaflet'
import { getSupabase } from '@/lib/supabase'
import dynamic from 'next/dynamic'

import 'leaflet-draw'
import { useMap } from 'react-leaflet'

function adminMapLog(...args: unknown[]) {
  try {
    if (typeof window === 'undefined') return
    if (window.localStorage?.getItem('debugAdminMap') !== '1') return
    // eslint-disable-next-line no-console
    console.info('[admin-map]', ...args)
  } catch {
    // ignore
  }
}

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

function DrawToolbar(props: {
  enabled: boolean
  featureGroupVersion: number
  featureGroupRef: React.MutableRefObject<LeafletFeatureGroup | null>
  onCreated: (e: unknown) => void
  onEdited: () => void
  onDeleted: () => void
}) {
  const map = useMap()
  const onCreatedRef = useRef(props.onCreated)
  const onEditedRef = useRef(props.onEdited)
  const onDeletedRef = useRef(props.onDeleted)

  useEffect(() => {
    onCreatedRef.current = props.onCreated
    onEditedRef.current = props.onEdited
    onDeletedRef.current = props.onDeleted
  }, [props.onCreated, props.onEdited, props.onDeleted])

  useEffect(() => {
    adminMapLog('DrawToolbar effect', { enabled: props.enabled, featureGroupVersion: props.featureGroupVersion })
    if (!props.enabled) return
    const group = props.featureGroupRef.current
    if (!group) {
      adminMapLog('DrawToolbar: no featureGroup yet')
      return
    }

    const DrawCtor = (L as unknown as { Control?: { Draw?: new (opts: unknown) => L.Control } }).Control?.Draw
    if (typeof DrawCtor !== 'function') {
      adminMapLog('DrawToolbar: L.Control.Draw missing', {
        hasLeafletDraw: !!(L as unknown as { Draw?: unknown }).Draw,
        controlKeys: Object.keys(L.Control as unknown as object),
      })
      return
    }

    const drawControl = new DrawCtor({
      draw: {
        polygon: true,
        rectangle: false,
        circle: false,
        marker: false,
        polyline: false,
        circlemarker: false,
      },
      edit: {
        featureGroup: group,
        edit: true,
        remove: true,
      },
    })
    map.addControl(drawControl)
    adminMapLog('DrawToolbar: control added')

    const Draw = (L as unknown as { Draw?: { Event?: Record<string, string> } }).Draw
    const CREATED = Draw?.Event?.CREATED ?? 'draw:created'
    const EDITED = Draw?.Event?.EDITED ?? 'draw:edited'
    const DELETED = Draw?.Event?.DELETED ?? 'draw:deleted'

    const createdHandler = (e: unknown) => onCreatedRef.current(e)
    const editedHandler = () => onEditedRef.current()
    const deletedHandler = () => onDeletedRef.current()

    map.on(CREATED, createdHandler)
    map.on(EDITED, editedHandler)
    map.on(DELETED, deletedHandler)
    adminMapLog('DrawToolbar: handlers attached', { CREATED, EDITED, DELETED })

    return () => {
      map.off(CREATED, createdHandler)
      map.off(EDITED, editedHandler)
      map.off(DELETED, deletedHandler)
      map.removeControl(drawControl)
      adminMapLog('DrawToolbar: cleaned up')
    }
  }, [map, props.enabled, props.featureGroupVersion, props.featureGroupRef])

  return null
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
  /** Current edited ring in GeoJSON order [lng, lat][] so the polygon sticks after drag; cleared when changing market. */
  const [editedRing, setEditedRing] = useState<[number, number][] | null>(null)
  const editGroupRef = useRef<LeafletFeatureGroup | null>(null)
  const [editGroupVersion, setEditGroupVersion] = useState(0)
  const initializedSlugRef = useRef<string | null>(null)

  function captureEditedShape() {
    const layer = editGroupRef.current
    if (!layer?.toGeoJSON) return
    const geo = layer.toGeoJSON()
    if (geo.type === 'FeatureCollection' && Array.isArray(geo.features)) {
      const polys = geo.features.filter((f) => f.geometry?.type === 'Polygon')
      const last = polys[polys.length - 1]?.geometry as GeoJSON.Polygon | undefined
      if (last?.coordinates?.[0]?.length) setEditedRing(last.coordinates[0] as [number, number][])
      return
    }
    const poly = getFirstPolygonGeometry(geo)
    if (poly?.coordinates?.[0]?.length) setEditedRing(poly.coordinates[0] as [number, number][])
  }

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
    const polygon: GeoJSON.Polygon | null =
      editedRing?.length
        ? ({ type: 'Polygon', coordinates: [editedRing] } as GeoJSON.Polygon)
        : getFirstPolygonGeometry(layer.toGeoJSON())
    if (!polygon?.coordinates?.[0]?.length) {
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
      setEditedRing(null)
      initializedSlugRef.current = null
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const editingPolygon = editMarketSlug ? data?.polygons?.find((p) => p.slug === editMarketSlug) : null

  function initEditLayer(group: LeafletFeatureGroup, ring: [number, number][]) {
    ;(group as unknown as { clearLayers?: () => void }).clearLayers?.()
    const latlngs = ring.map(([lng, lat]) => [lat, lng]) as [number, number][]
    const polyLayer = L.polygon(latlngs, {
      color: '#2563eb',
      fillColor: '#3b82f6',
      fillOpacity: 0.2,
      weight: 2,
    })
    ;(group as unknown as { addLayer: (l: unknown) => void }).addLayer(polyLayer)
    setEditedRing(ring)
  }

  // Populate the FeatureGroup with a Leaflet layer when entering edit mode for a market
  // and when the FeatureGroup ref becomes available. Never clear it again once editing has started.
  useEffect(() => {
    const slug = editMarketSlug
    const group = editGroupRef.current
    if (!slug || !group || !editingPolygon) {
      initializedSlugRef.current = null
      return
    }
    if (hasEdited) return
    if (initializedSlugRef.current === slug) return
    initializedSlugRef.current = slug

    try {
      const ring = editingPolygon.coordinates?.[0] as [number, number][] | undefined
      if (!ring?.length) {
        setEditedRing(null)
        return
      }
      initEditLayer(group, ring)
    } catch {
      // ignore
    }
  }, [editMarketSlug, editingPolygon, editGroupVersion, hasEdited])

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

  return (
    <div className="admin-card">
      <h1 className="admin-title">Sign-ups map</h1>
      <p className="admin-description" style={{ marginBottom: '1rem' }}>
        Exact lat/lng with zone boundaries. Only profiles with location set are shown.
      </p>
      <p className="admin-description" style={{ marginBottom: '0.75rem', fontSize: '0.9rem', color: 'var(--color-textSecondary, #666)' }}>
        To update a market’s zone: choose the market below, edit the polygon on the map (drag vertices or draw a new shape with the toolbar), then click <strong>Save boundary</strong>. The boundary is stored in the <code>markets</code> table and used for point-in-polygon resolution.
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
            setEditedRing(null)
            initializedSlugRef.current = null
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
              disabled={saving}
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
                setEditedRing(null)
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
          {data.polygons.map((poly) => {
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
            <FeatureGroup
              ref={(fg) => {
                if (fg !== editGroupRef.current) {
                  editGroupRef.current = fg
                  setEditGroupVersion((v) => v + 1)
                  adminMapLog('FeatureGroup ref set', { hasFg: !!fg, editGroupVersionNext: true })
                }
              }}
            />
          )}
          <DrawToolbar
            enabled={!!editMarketSlug && !!editingPolygon}
            featureGroupVersion={editGroupVersion}
            featureGroupRef={editGroupRef}
            onCreated={(e) => {
              const group = editGroupRef.current
              const layer = (e as { layer?: unknown }).layer
              if (group && layer) {
                ;(group as unknown as { clearLayers?: () => void }).clearLayers?.()
                ;(group as unknown as { addLayer: (l: unknown) => void }).addLayer(layer)
                adminMapLog('draw:created -> layer added', { market: editMarketSlug })
              } else {
                adminMapLog('draw:created -> missing group/layer', { hasGroup: !!group, hasLayer: !!layer })
              }
              setHasEdited(true)
              setTimeout(captureEditedShape, 0)
            }}
            onEdited={() => {
              setHasEdited(true)
              adminMapLog('draw:edited', { market: editMarketSlug })
              setTimeout(captureEditedShape, 0)
            }}
            onDeleted={() => {
              setHasEdited(true)
              adminMapLog('draw:deleted', { market: editMarketSlug })
              setEditedRing(null)
            }}
          />
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
