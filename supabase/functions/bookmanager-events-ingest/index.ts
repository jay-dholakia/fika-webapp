// Ingest public events from one or more Bookmanager shops via their customer API.
// Invoked by pg_cron. SUPABASE_* injected automatically.
//
// Config (pick one):
// - BOOKMANAGER_SHOPS: JSON array of shop objects (multi-shop).
// - Or omit it and use legacy env vars for a single shop (defaults = Village Well).
//
// Each shop object:
//   source (required)          — events.source slug, unique per shop
//   webstore_san (required)    — Bookmanager "san" from the shop HTML
//   shop_origin (required)     — e.g. https://shop.example.com (no trailing slash)
//   timezone (optional)        — IANA tz for event wall times (default America/Los_Angeles)
//   store_id (optional)        — numeric; if set, skips store/getSettings
//   venue_name, neighborhood   — optional when store_id is set (otherwise from getSettings)
//   listing_path (optional)    — default /events/all-events (used for log_url + source_post_url)

declare const Deno: { env: { get(key: string): string | undefined } }
// @ts-ignore Deno
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
// @ts-ignore Deno
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
// @ts-ignore Deno
import { Temporal } from 'https://esm.sh/@js-temporal/polyfill@0.4.4'

const BM_API = 'https://api.bookmanager.com/customer/'
const DEFAULT_LISTING_PATH = '/events/all-events'

type BookmanagerShopConfig = {
  source: string
  webstore_san: string
  shop_origin: string
  timezone: string
  store_id?: number
  venue_name?: string | null
  neighborhood?: string | null
  listing_path: string
}

type BmListRow = {
  id: number
  title?: string
  description?: string
  summary?: string
  date?: string
  start_time?: string
  end_time?: string
  all_day?: boolean
  category?: { id?: number; name?: string }
  location_text?: string
}

type BmListResponse = { rows?: BmListRow[]; error?: string; code?: number }

type BmSettingsResponse = {
  store_info?: { id?: number; name?: string; city?: string }
  error?: string
  code?: number
}

type ShopResult = {
  source: string
  ok: boolean
  store_id?: number
  fetched?: number
  inserted?: number
  updated?: number
  skipped_terminal?: number
  error?: string
}

function envOrDefault(key: string, fallback: string): string {
  return Deno.env.get(key)?.trim() || fallback
}

function todayCompactYmd(timeZone: string): string {
  const s = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
  return s.replace(/-/g, '')
}

function stripHtml(html: string, maxLen: number): string {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  return text.slice(0, maxLen)
}

function inferCategory(text: string): string | null {
  const v = text.toLowerCase()
  const map: Record<string, string[]> = {
    food: ['food', 'dinner', 'brunch', 'coffee', 'restaurant', 'lunch', 'drinks'],
    arts: ['arts', 'art', 'gallery', 'museum', 'photo', 'book', 'culture', 'author', 'storytime', 'poetry'],
    wellness: ['wellness', 'fitness', 'run', 'workout', 'pilates', 'yoga', 'health'],
    shopping: ['shopping', 'market', 'popup', 'pop-up', 'shop', 'vintage'],
    nightlife: ['nightlife', 'party', 'bar', 'cocktail', 'dance', 'music'],
    social: ['social', 'dating', 'singles', 'mixer', 'community', 'meet people'],
  }
  for (const [cat, syns] of Object.entries(map)) {
    if (v.includes(cat)) return cat
    for (const s of syns) {
      if (v.includes(s)) return cat
    }
  }
  return null
}

function wallTimeToIso(dateYmd: string, timeHms: string, tz: string): string | null {
  if (!/^\d{8}$/.test(dateYmd)) return null
  const y = dateYmd.slice(0, 4)
  const mo = dateYmd.slice(4, 6)
  const d = dateYmd.slice(6, 8)
  const parts = timeHms.split(':')
  const hh = (parts[0] ?? '0').padStart(2, '0')
  const mm = (parts[1] ?? '0').padStart(2, '0')
  const ss = (parts[2] ?? '0').padStart(2, '0')
  try {
    const plain = Temporal.PlainDateTime.from(`${y}-${mo}-${d}T${hh}:${mm}:${ss}`)
    const zdt = plain.toZonedDateTime(tz)
    return zdt.toInstant().toString()
  } catch {
    return null
  }
}

async function bmFormPost(
  path: string,
  san: string,
  listingPath: string,
  fields: Record<string, string>
): Promise<unknown> {
  const uuid = crypto.randomUUID()
  const sessionId = crypto.randomUUID()
  const body = new FormData()
  body.append('uuid', uuid)
  body.append('session_id', sessionId)
  body.append('log_url', listingPath)
  for (const [k, v] of Object.entries(fields)) {
    body.append(k, v)
  }
  const url = `${BM_API}${path}?_cb=${encodeURIComponent(san)}`
  const res = await fetch(url, {
    method: 'POST',
    body,
    headers: { Accept: 'application/json' },
  })
  return res.json()
}

function legacyDefaultShop(): BookmanagerShopConfig {
  const storeIdRaw = Deno.env.get('BOOKMANAGER_STORE_ID')?.trim()
  const store_id = storeIdRaw ? parseInt(storeIdRaw, 10) : undefined
  const base = {
    source: envOrDefault('BOOKMANAGER_EVENTS_SOURCE', 'village_well'),
    webstore_san: envOrDefault('BOOKMANAGER_WEBSTORE_SAN', '9916539'),
    shop_origin: envOrDefault('BOOKMANAGER_SHOP_ORIGIN', 'https://shop.villagewell.com').replace(/\/$/, ''),
    timezone: envOrDefault('BOOKMANAGER_TIMEZONE', 'America/Los_Angeles'),
    listing_path: envOrDefault('BOOKMANAGER_LISTING_PATH', DEFAULT_LISTING_PATH),
  }
  if (Number.isFinite(store_id)) {
    return {
      ...base,
      store_id,
      venue_name: Deno.env.get('BOOKMANAGER_VENUE_NAME')?.trim() ||
        'Village Well Books & Coffee',
      neighborhood: Deno.env.get('BOOKMANAGER_NEIGHBORHOOD')?.trim() || 'Culver City',
    }
  }
  return { ...base }
}

function normalizeShopInput(raw: Record<string, unknown>, index: number): BookmanagerShopConfig {
  const source = typeof raw.source === 'string' ? raw.source.trim() : ''
  const webstore_san = typeof raw.webstore_san === 'string' ? raw.webstore_san.trim() : ''
  const shop_origin = typeof raw.shop_origin === 'string' ? raw.shop_origin.trim().replace(/\/$/, '') : ''
  if (!source) throw new Error(`BOOKMANAGER_SHOPS[${index}]: source is required`)
  if (!webstore_san) throw new Error(`BOOKMANAGER_SHOPS[${index}]: webstore_san is required`)
  if (!shop_origin) throw new Error(`BOOKMANAGER_SHOPS[${index}]: shop_origin is required`)

  const timezone = typeof raw.timezone === 'string' && raw.timezone.trim()
    ? raw.timezone.trim()
    : 'America/Los_Angeles'
  const listing_path = typeof raw.listing_path === 'string' && raw.listing_path.trim()
    ? (raw.listing_path.startsWith('/') ? raw.listing_path.trim() : `/${raw.listing_path.trim()}`)
    : DEFAULT_LISTING_PATH

  let store_id: number | undefined
  if (raw.store_id !== undefined && raw.store_id !== null) {
    const n = typeof raw.store_id === 'number' ? raw.store_id : parseInt(String(raw.store_id), 10)
    if (!Number.isFinite(n)) throw new Error(`BOOKMANAGER_SHOPS[${index}]: store_id must be a number`)
    store_id = n
  }

  const venue_name = typeof raw.venue_name === 'string' ? raw.venue_name.trim() || null : undefined
  const neighborhood = typeof raw.neighborhood === 'string' ? raw.neighborhood.trim() || null : undefined

  return {
    source,
    webstore_san,
    shop_origin,
    timezone,
    listing_path,
    ...(store_id !== undefined ? { store_id } : {}),
    ...(venue_name !== undefined ? { venue_name } : {}),
    ...(neighborhood !== undefined ? { neighborhood } : {}),
  }
}

function resolveShops(): BookmanagerShopConfig[] {
  const raw = Deno.env.get('BOOKMANAGER_SHOPS')?.trim()
  if (!raw) {
    return [legacyDefaultShop()]
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('BOOKMANAGER_SHOPS must be valid JSON')
  }
  if (!Array.isArray(parsed)) {
    throw new Error('BOOKMANAGER_SHOPS must be a JSON array')
  }
  if (parsed.length === 0) {
    throw new Error('BOOKMANAGER_SHOPS array must not be empty')
  }
  return parsed.map((item, i) => {
    if (!item || typeof item !== 'object') {
      throw new Error(`BOOKMANAGER_SHOPS[${i}] must be an object`)
    }
    return normalizeShopInput(item as Record<string, unknown>, i)
  })
}

async function ingestOneShop(
  supabase: SupabaseClient,
  cfg: BookmanagerShopConfig
): Promise<ShopResult> {
  const san = cfg.webstore_san
  const listingPath = cfg.listing_path
  const source = cfg.source
  const tz = cfg.timezone
  const shopOrigin = cfg.shop_origin

  let storeId = cfg.store_id ?? NaN
  let venueName: string | null = cfg.venue_name ?? null
  let neighborhood: string | null = cfg.neighborhood ?? null

  if (!Number.isFinite(storeId)) {
    const settings = (await bmFormPost('store/getSettings', san, listingPath, {
      webstore_name: san,
    })) as BmSettingsResponse
    if (settings.error) {
      return { source, ok: false, error: `getSettings: ${settings.error}` }
    }
    const id = settings.store_info?.id
    if (typeof id !== 'number') {
      return { source, ok: false, error: 'getSettings missing store id' }
    }
    storeId = id
    venueName = settings.store_info?.name?.trim() || venueName
    neighborhood = settings.store_info?.city?.trim() || neighborhood
  }

  const startDate = todayCompactYmd(tz)
  const rows: BmListRow[] = []
  const limit = 20
  const maxPages = 80
  for (let page = 0; page < maxPages; page++) {
    const offset = page * limit
    const list = (await bmFormPost('event/v2/list', san, listingPath, {
      store_id: String(storeId),
      start_date: startDate,
      offset: String(offset),
      limit: String(limit),
    })) as BmListResponse
    if (list.error) {
      return { source, ok: false, error: `event/v2/list: ${list.error} (offset ${offset})` }
    }
    const batch = list.rows ?? []
    rows.push(...batch)
    if (batch.length < limit) break
  }

  const seen = new Set<number>()
  const uniqueRows = rows.filter((r) => {
    if (seen.has(r.id)) return false
    seen.add(r.id)
    return true
  })

  const listingUrl = `${shopOrigin}${listingPath}`

  const prepared = uniqueRows
    .map((row) => {
      const title = row.title?.trim()
      if (!title) return null
      const eventUrl = `${shopOrigin}/events/${row.id}`
      const descHtml = row.summary || row.description || ''
      const descriptionShort = descHtml ? stripHtml(descHtml, 480) : null
      const rawText = row.description?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || null

      let startsAt: string | null = null
      let endsAt: string | null = null
      const dateYmd = row.date ?? ''
      if (row.all_day) {
        startsAt = wallTimeToIso(dateYmd, '00:00:00', tz)
        endsAt = wallTimeToIso(dateYmd, '23:59:59', tz)
      } else if (row.start_time) {
        startsAt = wallTimeToIso(dateYmd, row.start_time, tz)
        if (row.end_time) {
          endsAt = wallTimeToIso(dateYmd, row.end_time, tz)
        }
      }

      const textForCategory = `${title} ${descriptionShort ?? ''} ${row.category?.name ?? ''}`
      const category = inferCategory(textForCategory)
      const venue = row.location_text?.trim() || venueName

      return {
        row,
        title,
        eventUrl,
        descriptionShort,
        rawText,
        startsAt,
        endsAt,
        category,
        venue,
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)

  const eventUrls = prepared.map((p) => p.eventUrl)
  const existingByUrl = new Map<string, { id: string; status: string }>()
  const chunkSize = 100
  for (let i = 0; i < eventUrls.length; i += chunkSize) {
    const chunk = eventUrls.slice(i, i + chunkSize)
    if (!chunk.length) continue
    const { data: existingRows, error: selErr } = await supabase
      .from('events')
      .select('id,status,event_url')
      .eq('source', source)
      .in('event_url', chunk)
    if (selErr) {
      return { source, ok: false, error: selErr.message }
    }
    for (const er of existingRows ?? []) {
      const u = (er as { event_url?: string }).event_url
      const id = (er as { id?: string }).id
      const status = (er as { status?: string }).status
      if (u && id && status) existingByUrl.set(u, { id, status })
    }
  }

  let inserted = 0
  let updated = 0
  let skipped = 0

  for (const p of prepared) {
    const existing = existingByUrl.get(p.eventUrl)
    const terminal = existing?.status === 'approved' || existing?.status === 'rejected' ||
      existing?.status === 'expired'
    if (terminal) {
      skipped++
      continue
    }

    const payload = {
      source,
      source_post_url: listingUrl,
      source_post_title: 'Events',
      raw_event_text: p.rawText,
      title: p.title,
      description_short: p.descriptionShort,
      starts_at: p.startsAt,
      ends_at: p.endsAt,
      venue_name: p.venue || null,
      neighborhood,
      event_url: p.eventUrl,
      category: p.category,
      tags: [] as string[],
      parsed_payload: {
        bookmanager: {
          id: p.row.id,
          san,
          store_id: storeId,
          category: p.row.category ?? null,
          date: p.row.date,
          start_time: p.row.start_time ?? null,
          end_time: p.row.end_time ?? null,
          all_day: p.row.all_day ?? false,
        },
      },
      confidence: 0.92,
      status: 'draft' as const,
    }

    if (existing?.id) {
      const { error: upErr } = await supabase.from('events').update(payload).eq('id', existing.id)
      if (upErr) {
        return { source, ok: false, error: upErr.message }
      }
      updated++
    } else {
      const { error: insErr } = await supabase.from('events').insert(payload)
      if (insErr) {
        return { source, ok: false, error: insErr.message }
      }
      inserted++
    }
  }

  return {
    source,
    ok: true,
    store_id: storeId,
    fetched: uniqueRows.length,
    inserted,
    updated,
    skipped_terminal: skipped,
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    if (!supabaseUrl || !serviceKey) {
      return new Response(JSON.stringify({ error: 'Supabase not configured' }), { status: 503 })
    }

    let shops: BookmanagerShopConfig[]
    try {
      shops = resolveShops()
    } catch (e) {
      return new Response(
        JSON.stringify({ error: e instanceof Error ? e.message : 'Invalid shop config' }),
        { status: 400 }
      )
    }

    const supabase = createClient(supabaseUrl, serviceKey)
    const shopResults: ShopResult[] = []

    for (const cfg of shops) {
      const result = await ingestOneShop(supabase, cfg)
      shopResults.push(result)
    }

    const anyOk = shopResults.some((r) => r.ok)
    const totals = shopResults.reduce(
      (acc, r) => ({
        fetched: acc.fetched + (r.fetched ?? 0),
        inserted: acc.inserted + (r.inserted ?? 0),
        updated: acc.updated + (r.updated ?? 0),
        skipped_terminal: acc.skipped_terminal + (r.skipped_terminal ?? 0),
      }),
      { fetched: 0, inserted: 0, updated: 0, skipped_terminal: 0 }
    )

    return new Response(
      JSON.stringify({
        ok: anyOk,
        shops: shopResults,
        totals,
      }),
      {
        status: anyOk ? 200 : 502,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : 'Ingest failed' }),
      { status: 500 }
    )
  }
})
