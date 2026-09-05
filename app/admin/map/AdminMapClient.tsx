'use client'

import './leaflet-flat-patch'
import './admin-map-venues.css'
import { useCallback, useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import type { FeatureGroup as LeafletFeatureGroup } from 'leaflet'
import { getSupabase } from '@/lib/supabase'
import { getQuestionText, formatIntakeAnswer } from '@/lib/intro-detail'
import type { IntakeResponseItem } from '@/lib/db-types'

import 'leaflet-draw'
import { CircleMarker, MapContainer, Marker, Pane, Polygon, Popup, TileLayer, useMap } from 'react-leaflet'

const VENUE_COFFEE_ICON = L.divIcon({
  className: 'admin-map-venue-coffee',
  html: '<span style="font-size:21px;line-height:1;display:flex;align-items:center;justify-content:center;width:26px;height:26px;filter:drop-shadow(0 1px 2px rgba(0,0,0,.45))" aria-hidden="true">☕</span>',
  iconSize: [26, 26],
  iconAnchor: [13, 13],
  popupAnchor: [0, -12],
})

function adminMapLog(...args: unknown[]) {
  try {
    if (typeof window === 'undefined') return
    if (window.localStorage?.getItem('debugAdminMap') !== '1') return
    console.info('[admin-map]', ...args) // eslint-disable-line no-console
  } catch { /* ignore */ }
}

interface MapPoint {
  id: string
  lat: number
  lng: number
  market: string | null
  city: string | null
  first_name: string | null
  created_at: string | null
  gender: string | null
  pronouns: string | null
  age: number | null
}

interface FikaMarker {
  matchId: string
  category: 'scheduled' | 'confirmed'
  lat: number
  lng: number
  venueName: string | null
  venueNeighborhood: string | null
  venueCity: string | null
  confirmedAt: string | null
  schedulingStatus: string | null
  userA: { id: string; firstName: string | null; phone: string | null } | null
  userB: { id: string; firstName: string | null; phone: string | null } | null
  market: string | null
}

interface VenueMapRow {
  id: string
  name: string
  neighborhood: string | null
  city: string
  address: string | null
  lat: number
  lng: number
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

function startOfDayIso(d: Date): string {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x.toISOString().slice(0, 10)
}

function formatDayLabel(yyyyMmDd: string): string {
  try {
    const d = new Date(`${yyyyMmDd}T00:00:00Z`)
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  } catch { return yyyyMmDd }
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' }) }
  catch { return iso }
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
        <div style={{ fontSize: 12, color: 'var(--color-textSecondary, #666)' }}>Last 30 days · total {props.points.length}</div>
      </div>
      {last30.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--color-textSecondary, #666)' }}>No data.</div>
      ) : (
        <svg viewBox="0 0 600 140" width="100%" height="140" role="img" aria-label="Daily signups and cumulative growth">
          <line x1="24" y1="120" x2="596" y2="120" stroke="#ddd" strokeWidth="1" />
          {counts.map((c, i) => {
            const x0 = 30 + i * (560 / counts.length)
            const w = (560 / counts.length) - 2
            const h = (c / max) * 90
            return <rect key={last30[i]} x={x0} y={120 - h} width={Math.max(1, w)} height={h} fill="#ef4444" opacity="0.75" />
          })}
          <polyline fill="none" stroke="#2563eb" strokeWidth="2"
            points={cum.map((c, i) => {
              const x = 30 + i * (560 / counts.length) + ((560 / counts.length) - 2) / 2
              const y = 120 - (c / cumMax) * 90
              return `${x},${y}`
            }).join(' ')}
          />
          {last30.map((d, i) => {
            if (i % 7 !== 0 && i !== last30.length - 1) return null
            return <text key={`${d}-lbl`} x={30 + i * (560 / counts.length)} y={135} fontSize="10" fill="#666">{formatDayLabel(d)}</text>
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
    if (!group) { adminMapLog('DrawToolbar: no featureGroup yet'); return }
    const DrawCtor = (L as unknown as { Control?: { Draw?: new (opts: unknown) => L.Control } }).Control?.Draw
    if (typeof DrawCtor !== 'function') { adminMapLog('DrawToolbar: L.Control.Draw missing'); return }
    const drawControl = new DrawCtor({
      draw: { polygon: true, rectangle: false, circle: false, marker: false, polyline: false, circlemarker: false },
      edit: { featureGroup: group, edit: true, remove: true },
    })
    map.addControl(drawControl)
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
    return () => {
      map.off(CREATED, createdHandler)
      map.off(EDITED, editedHandler)
      map.off(DELETED, deletedHandler)
      map.removeControl(drawControl)
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
        map.removeLayer(props.featureGroupRef.current)
        props.featureGroupRef.current = null
        props.onFeatureGroupReady()
      }
      return
    }
    if (!props.featureGroupRef.current) {
      const fg = L.featureGroup()
      fg.addTo(map)
      props.featureGroupRef.current = fg as unknown as LeafletFeatureGroup
      props.onFeatureGroupReady()
    }
    const fg = props.featureGroupRef.current
    if (fg && props.initialRing?.length) {
      ;(fg as unknown as { clearLayers?: () => void }).clearLayers?.()
      const latlngs = props.initialRing.map(([lng, lat]) => [lat, lng]) as [number, number][]
      const polyLayer = L.polygon(latlngs, { color: '#2563eb', fillColor: '#3b82f6', fillOpacity: 0.2, weight: 2 })
      ;(fg as unknown as { addLayer: (l: unknown) => void }).addLayer(polyLayer)
    }
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

/** Zooms the map to the bounds of the selected market polygon. */
function FlyToBounds({ marketSlug, polygons }: { marketSlug: string; polygons: MapPolygon[] }) {
  const map = useMap()
  useEffect(() => {
    if (!marketSlug) return
    const poly = polygons.find((p) => p.slug === marketSlug)
    if (!poly?.coordinates?.[0]?.length) return
    const latlngs = poly.coordinates[0].map(([lng, lat]) => [lat, lng] as [number, number])
    const bounds = L.latLngBounds(latlngs)
    if (bounds.isValid()) map.flyToBounds(bounds, { padding: [50, 50], duration: 0.6 })
  }, [map, marketSlug, polygons]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

export default function AdminMapClient() {
  const [data, setData] = useState<{
    points: MapPoint[]
    polygons: MapPolygon[]
    markets: MarketRow[]
    fikas: FikaMarker[]
    venues: VenueMapRow[]
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [editMarketSlug, setEditMarketSlug] = useState<string | null>(null)
  const [filterMarket, setFilterMarket] = useState<string>('')
  const [showUsers, setShowUsers] = useState(true)
  const [showScheduledFikas, setShowScheduledFikas] = useState(true)
  const [showConfirmedFikas, setShowConfirmedFikas] = useState(true)
  const [showVenueCatalog, setShowVenueCatalog] = useState(true)
  const [hasEdited, setHasEdited] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [editedRing, setEditedRing] = useState<[number, number][] | null>(null)
  const editGroupRef = useRef<LeafletFeatureGroup | null>(null)
  const [editGroupVersion, setEditGroupVersion] = useState(0)
  const initializedSlugRef = useRef<string | null>(null)

  // People list + profile modal
  const [peopleSearch, setPeopleSearch] = useState('')
  const [modalUserId, setModalUserId] = useState<string | null>(null)
  const [modalProfile, setModalProfile] = useState<ProfileDetail | null>(null)
  const [modalIntake, setModalIntake] = useState<IntakeDetail | null>(null)
  const [modalLoading, setModalLoading] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)

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
    const res = await fetch('/api/admin/map-data?include_fikas=1', { credentials: 'include', headers })
    if (res.status === 401) {
      const d = await res.json().catch(() => ({}))
      if (d?.code === 'NO_SESSION') window.location.href = '/login?next=/admin/map'
      throw new Error('Not signed in')
    }
    if (res.status === 403) throw new Error("Your account doesn't have admin access.")
    if (!res.ok) throw new Error('Failed to load map data')
    const json = await res.json()
    return {
      points: json.points ?? [],
      polygons: json.polygons ?? [],
      markets: json.markets ?? [],
      fikas: json.fikas ?? [],
      venues: json.venues ?? [],
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    loadData()
      .then((d) => { if (!cancelled) { setData(d); setError(null) } })
      .catch((e) => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [loadData])

  async function openModal(userId: string) {
    setModalUserId(userId)
    setModalProfile(null)
    setModalIntake(null)
    setModalLoading(true)
    setModalError(null)
    const supabase = getSupabase()
    const { data: { session } } = await supabase?.auth.getSession() ?? { data: { session: null } }
    const headers: HeadersInit = { 'Content-Type': 'application/json' }
    if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`
    try {
      const res = await fetch(`/api/admin/signups/${encodeURIComponent(userId)}`, { credentials: 'include', headers })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? 'Failed to load')
      setModalProfile(data.profile ?? null)
      setModalIntake(data.intake ?? null)
    } catch (e) {
      setModalError(e instanceof Error ? e.message : 'Failed to load profile')
    } finally {
      setModalLoading(false)
    }
  }

  function closeModal() {
    setModalUserId(null)
    setModalProfile(null)
    setModalIntake(null)
    setModalError(null)
  }

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

  if (loading) return <div className="admin-loading">Loading…</div>
  if (error) return (
    <div className="admin-card admin-card-narrow">
      <p className="admin-error" role="alert">{error}</p>
    </div>
  )
  if (!data) return null

  const pointsFiltered = filterMarket ? data.points.filter((p) => p.market === filterMarket) : data.points
  const pointsToRender = showUsers ? pointsFiltered : []
  const fikasFiltered = filterMarket ? data.fikas.filter((f) => f.market === filterMarket) : data.fikas
  const fikasToRender = fikasFiltered.filter((f) => {
    if (f.category === 'scheduled') return showScheduledFikas
    return showConfirmedFikas
  })

  const searchLower = peopleSearch.trim().toLowerCase()
  const filteredPeople = pointsFiltered.filter((p) => {
    if (!searchLower) return true
    return [p.first_name ?? '', p.city ?? '', p.market ?? '', p.gender ?? ''].join(' ').toLowerCase().includes(searchLower)
  })

  const activeMarkets = data.markets.filter((m) => m.active)
  const allMarkets = [...activeMarkets, ...data.markets.filter((m) => !m.active)]

  return (
    <div className="admin-card">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
        <h1 className="admin-title" style={{ marginBottom: 0 }}>People & Map</h1>
        <span style={{ fontSize: 13, color: 'var(--color-textSecondary, #666)' }}>
          {pointsFiltered.length} {filterMarket ? (data.markets.find((m) => m.slug === filterMarket)?.label ?? filterMarket) : 'total'} members
        </span>
      </div>

      {/* Market tags */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '1rem' }}>
        <button
          type="button"
          onClick={() => setFilterMarket('')}
          style={{
            padding: '4px 12px',
            borderRadius: 99,
            fontSize: 13,
            fontWeight: 600,
            border: '1.5px solid',
            cursor: 'pointer',
            background: filterMarket === '' ? '#1d4ed8' : 'transparent',
            color: filterMarket === '' ? '#fff' : 'var(--color-text, #222)',
            borderColor: filterMarket === '' ? '#1d4ed8' : 'var(--color-border, #d1d5db)',
            transition: 'all 0.12s',
          }}
        >
          All
        </button>
        {allMarkets.map((m) => {
          const count = data.points.filter((p) => p.market === m.slug).length
          const active = filterMarket === m.slug
          return (
            <button
              key={m.slug}
              type="button"
              onClick={() => setFilterMarket((prev) => prev === m.slug ? '' : m.slug)}
              style={{
                padding: '4px 12px',
                borderRadius: 99,
                fontSize: 13,
                fontWeight: 600,
                border: '1.5px solid',
                cursor: 'pointer',
                background: active ? '#1d4ed8' : m.active ? 'transparent' : 'var(--color-bg-soft, #f9fafb)',
                color: active ? '#fff' : m.active ? 'var(--color-text, #222)' : 'var(--color-textSecondary, #666)',
                borderColor: active ? '#1d4ed8' : m.active ? 'var(--color-border, #d1d5db)' : 'var(--color-border, #e5e7eb)',
                transition: 'all 0.12s',
              }}
            >
              {m.label || m.slug}
              {count > 0 && (
                <span style={{ marginLeft: 5, fontSize: 11, opacity: 0.75 }}>{count}</span>
              )}
            </button>
          )
        })}
      </div>

      <div style={{ marginBottom: '0.75rem' }}>
        <DailyGrowthChart
          points={pointsFiltered}
          title={filterMarket ? `Daily signups — ${data.markets.find((m) => m.slug === filterMarket)?.label ?? filterMarket}` : 'Daily signups — all markets'}
        />
      </div>

      {/* Map layer toggles */}
      <div style={{ marginBottom: '0.5rem', display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <input type="checkbox" checked={showUsers} onChange={(e) => setShowUsers(e.target.checked)} />
          Show users
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <input type="checkbox" checked={showScheduledFikas} onChange={(e) => setShowScheduledFikas(e.target.checked)} />
          Scheduled fikas
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <input type="checkbox" checked={showConfirmedFikas} onChange={(e) => setShowConfirmedFikas(e.target.checked)} />
          Confirmed fikas
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <input type="checkbox" checked={showVenueCatalog} onChange={(e) => setShowVenueCatalog(e.target.checked)} />
          Venues ☕
        </label>
      </div>

      {/* Boundary edit controls */}
      <details style={{ marginBottom: '0.75rem' }}>
        <summary style={{ fontSize: 13, cursor: 'pointer', color: 'var(--color-textSecondary, #666)', userSelect: 'none' }}>
          Edit market boundary…
        </summary>
        <div style={{ marginTop: '0.5rem', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem' }}>
          <select
            value={editMarketSlug ?? ''}
            onChange={(e) => {
              setEditMarketSlug(e.target.value || null)
              setHasEdited(false)
              setSaveError(null)
              setEditedRing(null)
              initializedSlugRef.current = null
            }}
            style={{ padding: '4px 8px', borderRadius: 4, fontSize: 13 }}
          >
            <option value="">View only</option>
            {data.polygons.map((p) => (
              <option key={p.slug} value={p.slug}>{p.label}</option>
            ))}
          </select>
          {editMarketSlug && (
            <>
              <button type="button" onClick={handleSaveBoundary} disabled={saving} className="admin-button" style={{ fontSize: 12 }}>
                {saving ? 'Saving…' : 'Save boundary'}
              </button>
              <button type="button" onClick={() => {
                setEditMarketSlug(null)
                setHasEdited(false)
                setSaveError(null)
                setEditedRing(null)
              }} className="admin-button" style={{ fontSize: 12 }}>
                Cancel
              </button>
            </>
          )}
          {saveError && <span style={{ fontSize: 12, color: '#dc2626' }} role="alert">{saveError}</span>}
        </div>
      </details>

      {/* Map */}
      <div style={{ height: 480, width: '100%', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--color-border, #e5e5e5)', marginBottom: '1.5rem' }}>
        <MapContainer center={[39, -98]} zoom={4} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
          <Pane name="polygons" style={{ zIndex: 400 }} />
          <Pane name="markers" style={{ zIndex: 650 }} />
          <Pane name="venueMarkers" style={{ zIndex: 660 }} />
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {filterMarket && <FlyToBounds marketSlug={filterMarket} polygons={data.polygons} />}
          {data.polygons.map((poly) => {
            const ring = poly.coordinates[0]
            if (!ring?.length) return null
            const positions: [number, number][] = ring.map(([lng, lat]) => [lat, lng])
            return (
              <Polygon
                key={poly.slug}
                positions={positions}
                pane="polygons"
                pathOptions={{ color: '#2563eb', fillColor: '#3b82f6', fillOpacity: 0.15, weight: 2 }}
                eventHandlers={{
                  mouseover: (e) => { e.target.setStyle({ fillOpacity: 0.25 }); e.target.bringToFront() },
                  mouseout: (e) => { e.target.setStyle({ fillOpacity: 0.15 }) },
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
              }
              setHasEdited(true)
              setTimeout(captureEditedShape, 0)
            }}
            onEdited={() => { setHasEdited(true); setTimeout(captureEditedShape, 0) }}
            onDeleted={() => { setHasEdited(true); setEditedRing(null) }}
          />
          {pointsToRender.map((p) => (
            <CircleMarker
              key={p.id}
              center={[p.lat, p.lng]}
              radius={6}
              pane="markers"
              pathOptions={{ color: '#dc2626', fillColor: '#ef4444', fillOpacity: 0.9, weight: 1 }}
              eventHandlers={{ click: () => openModal(p.id) }}
            >
              <Popup>
                <div style={{ minWidth: 160 }}>
                  <p style={{ margin: 0, fontWeight: 600, cursor: 'pointer' }} onClick={() => openModal(p.id)}>{p.first_name || '—'}</p>
                  <p style={{ margin: '4px 0 0 0', fontSize: 12, color: '#666' }}>{p.city || '—'} · {p.market || 'no market'}</p>
                  <p style={{ margin: '4px 0 0 0', fontSize: 12, color: '#666' }}>
                    {p.pronouns || p.gender || '—'} · {p.age != null ? `${p.age}` : '—'}
                  </p>
                </div>
              </Popup>
            </CircleMarker>
          ))}
          {fikasToRender.map((f) => {
            const isConfirmed = f.category === 'confirmed'
            const color = isConfirmed ? '#2563eb' : '#f59e0b'
            const fillColor = isConfirmed ? '#3b82f6' : '#fbbf24'
            return (
              <CircleMarker
                key={`${f.matchId}-${f.category}`}
                center={[f.lat, f.lng]}
                radius={isConfirmed ? 8 : 7}
                pane="markers"
                pathOptions={{ color, fillColor, fillOpacity: 0.85, weight: 1.5 }}
              >
                <Popup>
                  <div style={{ minWidth: 220 }}>
                    <p style={{ margin: 0, fontWeight: 700 }}>{isConfirmed ? 'Confirmed Fika' : 'Scheduled Fika'}</p>
                    <p style={{ margin: '4px 0 0 0', fontSize: 12, color: '#666' }}>{f.userA?.firstName ?? '—'} ↔ {f.userB?.firstName ?? '—'}</p>
                    <p style={{ margin: '4px 0 0 0', fontSize: 12, color: '#666' }}>
                      {f.venueName ?? '—'}{f.venueNeighborhood ? ` (${f.venueNeighborhood})` : ''}{f.venueCity ? ` · ${f.venueCity}` : ''}
                    </p>
                  </div>
                </Popup>
              </CircleMarker>
            )
          })}
          {showVenueCatalog && data.venues.map((v) => (
            <Marker key={v.id} position={[v.lat, v.lng]} icon={VENUE_COFFEE_ICON} pane="venueMarkers" zIndexOffset={400}>
              <Popup>
                <div style={{ minWidth: 200 }}>
                  <p style={{ margin: 0, fontWeight: 700 }}>Venue · {v.name}</p>
                  <p style={{ margin: '4px 0 0 0', fontSize: 12, color: '#666' }}>
                    {v.neighborhood ? `${v.neighborhood} · ` : ''}{v.city || '—'}
                  </p>
                  {v.address && <p style={{ margin: '4px 0 0 0', fontSize: 12, color: '#666' }}>{v.address}</p>}
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>

      {/* People list */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>
            Members{filterMarket ? ` — ${data.markets.find((m) => m.slug === filterMarket)?.label ?? filterMarket}` : ''}
            <span style={{ fontWeight: 400, color: '#888', marginLeft: 6, fontSize: 13 }}>({filteredPeople.length})</span>
          </h2>
          <input
            className="auth-input"
            style={{ maxWidth: 220, fontSize: 13 }}
            value={peopleSearch}
            onChange={(e) => setPeopleSearch(e.target.value)}
            placeholder="Search name, city…"
            aria-label="Search members"
          />
        </div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Age</th>
                <th>Pronouns</th>
                <th>City</th>
                <th>Market</th>
                <th>Joined</th>
              </tr>
            </thead>
            <tbody>
              {filteredPeople.slice(0, 200).map((p) => (
                <tr
                  key={p.id}
                  className="admin-table-row-clickable"
                  role="button"
                  tabIndex={0}
                  onClick={() => openModal(p.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openModal(p.id) } }}
                >
                  <td style={{ fontWeight: 600 }}>{p.first_name ?? '—'}</td>
                  <td>{p.age != null ? p.age : '—'}</td>
                  <td style={{ fontSize: 12, color: '#666' }}>{p.pronouns ?? p.gender ?? '—'}</td>
                  <td>{p.city ?? '—'}</td>
                  <td style={{ fontSize: 12, color: '#888' }}>{data.markets.find((m) => m.slug === p.market)?.label ?? p.market ?? '—'}</td>
                  <td style={{ fontSize: 12, color: '#888' }}>{p.created_at ? formatDate(p.created_at) : '—'}</td>
                </tr>
              ))}
              {filteredPeople.length === 0 && (
                <tr><td colSpan={6} className="admin-empty">No members found.</td></tr>
              )}
              {filteredPeople.length > 200 && (
                <tr><td colSpan={6} style={{ fontSize: 12, color: '#999', textAlign: 'center', padding: '0.5rem' }}>
                  Showing first 200. Filter by market or search to narrow.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Profile modal */}
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
              <h2 id="admin-modal-title">Profile</h2>
              <button type="button" className="admin-modal-close" onClick={closeModal} aria-label="Close">×</button>
            </div>
            <div className="admin-modal-body">
              {modalLoading ? (
                <div className="admin-loading">Loading…</div>
              ) : modalError ? (
                <p className="admin-error" role="alert">{modalError}</p>
              ) : (
                <>
                  {modalProfile && (
                    <>
                      <div className="admin-people-modal-photo-wrap">
                        {modalProfile.avatarUrl ? (
                          <img src={modalProfile.avatarUrl} alt={modalProfile.firstName?.trim() ? `${modalProfile.firstName.trim()}` : 'Profile photo'} className="admin-people-modal-photo" width={88} height={88} decoding="async" />
                        ) : (
                          <div className="admin-people-modal-photo admin-people-modal-photo-placeholder" role="img" aria-label="No photo">
                            {(modalProfile.firstName?.trim()?.[0] ?? '?').toUpperCase()}
                          </div>
                        )}
                      </div>
                      <section className="admin-modal-section">
                        <h3 className="admin-modal-section-title">Profile</h3>
                        <dl className="admin-modal-dl">
                          <dt>Name</dt><dd>{modalProfile.firstName ?? '—'}</dd>
                          <dt>City</dt><dd>{modalProfile.city ?? '—'}</dd>
                          <dt>Market</dt><dd>{modalProfile.marketLabel ?? modalProfile.market ?? '—'}</dd>
                          <dt>Birthdate</dt><dd>{modalProfile.birthdate ?? '—'}</dd>
                          <dt>Pronouns</dt><dd>{modalProfile.pronouns ?? '—'}</dd>
                          <dt>Gender</dt><dd>{modalProfile.gender ?? '—'}</dd>
                          <dt>Relationship status</dt><dd>{modalProfile.relationshipStatus ?? '—'}</dd>
                          <dt>Phone</dt><dd>{modalProfile.phone ?? '—'}</dd>
                          <dt>Intent confirmed</dt><dd>{modalProfile.intentConfirmedAt ? formatDate(modalProfile.intentConfirmedAt) : '—'}</dd>
                          <dt>Last fika</dt><dd>{modalProfile.lastFikaAt ? formatDate(modalProfile.lastFikaAt) : '—'}</dd>
                          <dt>Created</dt><dd>{formatDate(modalProfile.createdAt)}</dd>
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
    </div>
  )
}
