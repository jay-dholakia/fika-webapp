'use client'

import './leaflet-flat-patch'
import { useCallback, useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import type { FeatureGroup as LeafletFeatureGroup } from 'leaflet'
import { getSupabase } from '@/lib/supabase'

import 'leaflet-draw'
import { CircleMarker, MapContainer, Pane, Polygon, Popup, TileLayer, useMap } from 'react-leaflet'

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

interface MapPoint {
  id: string
  lat: number
  lng: number
  market: string | null
  city: string | null
  first_name: string | null
  created_at: string | null
}

interface MapPolygon {
  slug: string
  label: string
  coordinates: number[][][]
}

interface MarketRow {
  slug: string
  label: string
  active: boolean
}

function startOfDayIso(d: Date): string {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x.toISOString().slice(0, 10)
}

function formatDayLabel(yyyyMmDd: string): string {
  try {
    const d = new Date(`${yyyyMmDd}T00:00:00Z`)
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  } catch {
    return yyyyMmDd
  }
}

function DailyGrowthChart(props: { points: MapPoint[]; title: string }) {
  const byDay: Record<string, number> = {}
  for (const p of props.points) {
    const day = typeof p.created_at === 'string' && p.created_at ? p.created_at.slice(0, 10) : null
    if (!day) continue
    byDay[day] = (byDay[day] ?? 0) + 1
  }
  const days = Object.keys(byDay).sort()
  const last30 = days.slice(-30)
  const counts = last30.map((d) => byDay[d] ?? 0)
  const max = Math.max(1, ...counts)
  let cumulative = 0
  const cum = counts.map((c) => { cumulative += c; return cumulative })
  const cumMax = Math.max(1, ...cum)

  return (
    <div style={{ padding: '12px 12px 10px 12px', border: '1px solid var(--color-border, #e5e5e5)', borderRadius: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, marginBottom: 8 }}>
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>{props.title}</h2>
        <div style={{ fontSize: 12, color: 'var(--color-textSecondary, #666)' }}>
          Last 30 days · total {props.points.length}
        </div>
      </div>
      {last30.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--color-textSecondary, #666)' }}>No signups with created_at.</div>
      ) : (
        <svg viewBox="0 0 600 140" width="100%" height="140" role="img" aria-label="Daily signups and cumulative growth">
          {/* axes baseline */}
          <line x1="24" y1="120" x2="596" y2="120" stroke="#ddd" strokeWidth="1" />
          {/* bars */}
          {counts.map((c, i) => {
            const x0 = 30 + i * (560 / counts.length)
            const w = (560 / counts.length) - 2
            const h = (c / max) * 90
            const y = 120 - h
            return <rect key={last30[i]} x={x0} y={y} width={Math.max(1, w)} height={h} fill="#ef4444" opacity="0.75" />
          })}
          {/* cumulative line */}
          <polyline
            fill="none"
            stroke="#2563eb"
            strokeWidth="2"
            points={cum.map((c, i) => {
              const x = 30 + i * (560 / counts.length) + ((560 / counts.length) - 2) / 2
              const y = 120 - (c / cumMax) * 90
              return `${x},${y}`
            }).join(' ')}
          />
          {/* x labels (sparse) */}
          {last30.map((d, i) => {
            if (i % 7 !== 0 && i !== last30.length - 1) return null
            const x = 30 + i * (560 / counts.length)
            return (
              <text key={`${d}-lbl`} x={x} y={135} fontSize="10" fill="#666">
                {formatDayLabel(d)}
              </text>
            )
          })}
        </svg>
      )}
    </div>
  )
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

function EditLayerManager(props: {
  enabled: boolean
  marketSlug: string | null
  initialRing: [number, number][] | null
  featureGroupVersion: number
  featureGroupRef: React.MutableRefObject<LeafletFeatureGroup | null>
  onFeatureGroupReady: () => void
  onCreated: (e: unknown) => void
  onEdited: () => void
  onDeleted: () => void
}) {
  const map = useMap()

  useEffect(() => {
    if (!props.enabled) {
      if (props.featureGroupRef.current) {
        adminMapLog('EditLayerManager: removing featureGroup')
        map.removeLayer(props.featureGroupRef.current)
        props.featureGroupRef.current = null
        props.onFeatureGroupReady()
      }
      return
    }

    if (!props.featureGroupRef.current) {
      adminMapLog('EditLayerManager: creating featureGroup')
      const fg = L.featureGroup()
      fg.addTo(map)
      props.featureGroupRef.current = fg as unknown as LeafletFeatureGroup
      props.onFeatureGroupReady()
    }

    const fg = props.featureGroupRef.current
    if (fg && props.initialRing?.length) {
      // Load the current polygon as a layer in the feature group.
      ;(fg as unknown as { clearLayers?: () => void }).clearLayers?.()
      const latlngs = props.initialRing.map(([lng, lat]) => [lat, lng]) as [number, number][]
      const polyLayer = L.polygon(latlngs, {
        color: '#2563eb',
        fillColor: '#3b82f6',
        fillOpacity: 0.2,
        weight: 2,
      })
      ;(fg as unknown as { addLayer: (l: unknown) => void }).addLayer(polyLayer)
      adminMapLog('EditLayerManager: loaded polygon layer', { market: props.marketSlug })
    }
    // Only re-run when the market changes; edits are handled by draw events.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, props.enabled, props.marketSlug])

  return (
    <DrawToolbar
      enabled={props.enabled}
      featureGroupVersion={props.featureGroupVersion}
      featureGroupRef={props.featureGroupRef}
      onCreated={props.onCreated}
      onEdited={props.onEdited}
      onDeleted={props.onDeleted}
    />
  )
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
  const [data, setData] = useState<{ points: MapPoint[]; polygons: MapPolygon[]; markets: MarketRow[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [editMarketSlug, setEditMarketSlug] = useState<string | null>(null)
  const [filterMarket, setFilterMarket] = useState<string>('')
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
    return { points: json.points ?? [], polygons: json.polygons ?? [], markets: json.markets ?? [] }
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

  // FeatureGroup + layer are managed imperatively inside the map via EditLayerManager.

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

  const pointsFiltered = filterMarket
    ? data.points.filter((p) => p.market === filterMarket)
    : data.points

  return (
    <div className="admin-card">
      <h1 className="admin-title">Sign-ups map</h1>
      <p className="admin-description" style={{ marginBottom: '1rem' }}>
        Exact lat/lng with zone boundaries. Only profiles with location set are shown.
      </p>
      <div style={{ marginBottom: '0.75rem' }}>
        <DailyGrowthChart
          points={pointsFiltered}
          title={filterMarket ? `Daily signups — ${data.markets.find((m) => m.slug === filterMarket)?.label ?? filterMarket}` : 'Daily signups — all markets'}
        />
      </div>
      <p className="admin-description" style={{ marginBottom: '0.75rem', fontSize: '0.9rem', color: 'var(--color-textSecondary, #666)' }}>
        To update a market’s zone: choose the market below, edit the polygon on the map (drag vertices or draw a new shape with the toolbar), then click <strong>Save boundary</strong>. The boundary is stored in the <code>markets</code> table and used for point-in-polygon resolution.
      </p>
      <div style={{ marginBottom: '0.75rem', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.75rem' }}>
        <label htmlFor="admin-map-filter-market" style={{ fontWeight: 500 }}>
          Filter market:
        </label>
        <select
          id="admin-map-filter-market"
          value={filterMarket}
          onChange={(e) => setFilterMarket(e.target.value)}
          style={{ padding: '4px 8px', borderRadius: 4 }}
        >
          <option value="">All markets</option>
          {data.markets.map((m) => (
            <option key={m.slug} value={m.slug}>
              {m.label || m.slug}
            </option>
          ))}
        </select>

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
          <Pane name="polygons" style={{ zIndex: 400 }} />
          <Pane name="markers" style={{ zIndex: 650 }} />
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
                  pane="polygons"
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
          <EditLayerManager
            enabled={!!editMarketSlug && !!editingPolygon}
            marketSlug={editMarketSlug}
            initialRing={(editingPolygon?.coordinates?.[0] as [number, number][] | undefined) ?? null}
            featureGroupVersion={editGroupVersion}
            featureGroupRef={editGroupRef}
            onFeatureGroupReady={() => setEditGroupVersion((v) => v + 1)}
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
          {pointsFiltered.map((p) => (
            <CircleMarker
              key={p.id}
              center={[p.lat, p.lng]}
              radius={6}
              pane="markers"
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
