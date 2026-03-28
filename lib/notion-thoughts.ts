/**
 * Server-only: Notion database as CMS for /thoughts (no public Notion URLs in UI).
 * Properties: Title, Slug, Published, Date, Excerpt — see .env.example
 */

const NOTION_VERSION = '2022-06-28'
const NOTION_API = 'https://api.notion.com/v1'

/** From share URL …/Fika-…-331ef446c13680babaaef285f633c8c5 */
const DEFAULT_DATABASE_ID = '331ef446-c136-80ba-baae-f285f633c8c5'

/** Exact Notion database property names */
const PROP = {
  title: 'Title',
  slug: 'Slug',
  published: 'Published',
  date: 'Date',
  excerpt: 'Excerpt',
} as const

export type ThoughtListItem = {
  id: string
  slug: string
  title: string
  excerpt: string | null
  date: string | null
}

export type ThoughtPostMeta = ThoughtListItem

export type ThoughtsListResult = {
  items: ThoughtListItem[]
  error: string | null
  configMissing: boolean
}

export type ThoughtPostResult =
  | { ok: true; post: ThoughtPostMeta; blocks: NotionBlockWithChildren[] }
  | { ok: false; error: 'not_found' | 'config' | 'api'; message?: string }

// --- Notion raw types (subset) ---

export type NotionRichTextItem = {
  type: string
  plain_text?: string
  text?: { content: string; link?: { url: string } | null }
  annotations?: {
    bold?: boolean
    italic?: boolean
    strikethrough?: boolean
    underline?: boolean
    code?: boolean
    color?: string
  }
  href?: string
}

export type NotionBlockWithChildren = {
  id: string
  type: string
  has_children?: boolean
  children?: NotionBlockWithChildren[]
  [key: string]: unknown
}

type NotionProperty =
  | { type: 'title'; title: NotionRichTextItem[] }
  | { type: 'rich_text'; rich_text: NotionRichTextItem[] }
  | { type: 'date'; date: { start: string } | null }
  | { type: 'checkbox'; checkbox: boolean }
  | { type: 'formula'; formula: { type: string; string?: string | null } }
  | { type: string; [key: string]: unknown }

type NotionPage = {
  object?: string
  id: string
  archived?: boolean
  properties: Record<string, NotionProperty>
}

function formatUuid32(raw32: string): string {
  const raw = raw32.replace(/-/g, '')
  if (raw.length !== 32 || !/^[0-9a-f]+$/i.test(raw)) return raw32
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`
}

function resolveDatabaseId(): string {
  const env = process.env.NOTION_THOUGHTS_DATABASE_ID?.trim()
  if (!env) return DEFAULT_DATABASE_ID
  if (env.includes('notion.so')) {
    const m = env.match(/([0-9a-f]{32})/i)
    if (m) return formatUuid32(m[1])
  }
  return formatUuid32(env)
}

function getHeaders(): HeadersInit {
  const apiKey = process.env.NOTION_API_KEY?.trim()
  if (!apiKey) throw new Error('NOTION_API_KEY missing')
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'Notion-Version': NOTION_VERSION,
  }
}

const revalidate = { revalidate: 120 } as const

async function notionPost(path: string, body: unknown): Promise<Response> {
  return fetch(`${NOTION_API}${path}`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(body),
    next: revalidate,
  })
}

async function notionGet(path: string): Promise<Response> {
  return fetch(`${NOTION_API}${path}`, {
    method: 'GET',
    headers: getHeaders(),
    next: revalidate,
  })
}

function joinRichText(items: NotionRichTextItem[] | undefined): string {
  if (!items?.length) return ''
  return items.map((t) => t.plain_text ?? t.text?.content ?? '').join('')
}

function getTitle(props: Record<string, NotionProperty>): string {
  const p = props[PROP.title]
  if (p?.type === 'title') {
    const t = joinRichText((p as { title: NotionRichTextItem[] }).title).trim()
    if (t) return t
  }
  for (const prop of Object.values(props)) {
    if (prop.type === 'title') {
      const t = joinRichText((prop as { title: NotionRichTextItem[] }).title).trim()
      if (t) return t
    }
  }
  return 'Untitled'
}

function getSlug(props: Record<string, NotionProperty>): string | null {
  const p = props[PROP.slug]
  if (p?.type === 'rich_text') {
    const s = joinRichText((p as { rich_text: NotionRichTextItem[] }).rich_text).trim()
    return s || null
  }
  if (p?.type === 'formula') {
    const f = (p as { formula: { type: string; string?: string | null } }).formula
    if (f?.type === 'string' && typeof f.string === 'string') {
      const s = f.string.trim()
      return s || null
    }
  }
  return null
}

function getExcerpt(props: Record<string, NotionProperty>): string | null {
  const p = props[PROP.excerpt]
  if (p?.type === 'rich_text') {
    const s = joinRichText((p as { rich_text: NotionRichTextItem[] }).rich_text).trim()
    return s || null
  }
  return null
}

function getDate(props: Record<string, NotionProperty>): string | null {
  const p = props[PROP.date]
  if (p?.type === 'date') {
    const d = (p as { date: { start: string } | null }).date
    if (d?.start) return d.start
  }
  return null
}

function isPublished(props: Record<string, NotionProperty>): boolean {
  const p = props[PROP.published]
  if (p?.type === 'checkbox') return Boolean((p as { checkbox: boolean }).checkbox)
  return false
}

function pageToListItem(page: NotionPage): ThoughtListItem | null {
  if (!isPublished(page.properties)) return null
  const slug = getSlug(page.properties)
  if (!slug) return null
  return {
    id: page.id,
    slug,
    title: getTitle(page.properties),
    excerpt: getExcerpt(page.properties),
    date: getDate(page.properties),
  }
}

function pageToPostMeta(page: NotionPage): ThoughtPostMeta | null {
  const slug = getSlug(page.properties)
  if (!slug) return null
  return {
    id: page.id,
    slug,
    title: getTitle(page.properties),
    excerpt: getExcerpt(page.properties),
    date: getDate(page.properties),
  }
}

/** Database query: published + non-empty slug; sort by Date descending. */
const publishedFilter = {
  and: [
    { property: PROP.published, checkbox: { equals: true } },
    { property: PROP.slug, rich_text: { is_not_empty: true } },
  ],
} as const

const listSorts = [{ property: PROP.date, direction: 'descending' as const }]

export async function fetchPublishedThoughts(): Promise<ThoughtsListResult> {
  if (!process.env.NOTION_API_KEY?.trim()) {
    return { items: [], error: null, configMissing: true }
  }

  const databaseId = resolveDatabaseId()
  const items: ThoughtListItem[] = []

  try {
    let cursor: string | undefined
    do {
      const body: Record<string, unknown> = {
        filter: publishedFilter,
        sorts: listSorts,
        page_size: 100,
      }
      if (cursor) body.start_cursor = cursor

      const res = await notionPost(`/databases/${databaseId}/query`, body)
      const data = (await res.json()) as {
        message?: string
        results?: NotionPage[]
        has_more?: boolean
        next_cursor?: string | null
      }

      if (!res.ok) {
        const msg = typeof data.message === 'string' ? data.message : `Notion error ${res.status}`
        return {
          items: [],
          error:
            msg.includes('validation') || msg.toLowerCase().includes('sort')
              ? `${msg} Ensure properties exist: ${PROP.title}, ${PROP.slug}, ${PROP.published} (checkbox), ${PROP.date}, ${PROP.excerpt}.`
              : msg.includes('Authorized') || msg.includes('Forbidden')
                ? `${msg} Connect the integration to this database in Notion.`
                : msg,
          configMissing: false,
        }
      }

      for (const page of data.results ?? []) {
        if (page?.object !== 'page' || page.archived) continue
        const row = pageToListItem(page as NotionPage)
        if (row) items.push(row)
      }

      cursor = data.has_more && data.next_cursor ? data.next_cursor : undefined
    } while (cursor)

    return { items, error: null, configMissing: false }
  } catch (e) {
    if (e instanceof Error && e.message === 'NOTION_API_KEY missing') {
      return { items: [], error: null, configMissing: true }
    }
    return { items: [], error: 'Could not load thoughts. Try again later.', configMissing: false }
  }
}

export async function fetchThoughtBySlug(slug: string): Promise<ThoughtPostResult> {
  if (!process.env.NOTION_API_KEY?.trim()) {
    return { ok: false, error: 'config' }
  }

  const normalized = slug.trim()
  if (!normalized) {
    return { ok: false, error: 'not_found' }
  }

  const databaseId = resolveDatabaseId()

  try {
    const res = await notionPost(`/databases/${databaseId}/query`, {
      filter: {
        and: [
          { property: PROP.published, checkbox: { equals: true } },
          { property: PROP.slug, rich_text: { equals: normalized } },
        ],
      },
      page_size: 5,
    })

    const data = (await res.json()) as {
      message?: string
      results?: NotionPage[]
    }

    if (!res.ok) {
      return {
        ok: false,
        error: 'api',
        message: typeof data.message === 'string' ? data.message : undefined,
      }
    }

    const pages = (data.results ?? []).filter((p) => p?.object === 'page' && !p.archived) as NotionPage[]
    const page = pages[0]
    if (!page) {
      return { ok: false, error: 'not_found' }
    }

    const meta = pageToPostMeta(page)
    if (!meta) {
      return { ok: false, error: 'not_found' }
    }

    const blocks = await fetchBlockTree(page.id)
    return { ok: true, post: meta, blocks }
  } catch (e) {
    if (e instanceof Error && e.message === 'NOTION_API_KEY missing') {
      return { ok: false, error: 'config' }
    }
    return { ok: false, error: 'api', message: e instanceof Error ? e.message : undefined }
  }
}

export async function fetchAllPublishedSlugs(): Promise<string[]> {
  const { items } = await fetchPublishedThoughts()
  return items.map((i) => i.slug)
}

// --- Blocks ---

type NotionRawBlock = {
  id: string
  type: string
  has_children?: boolean
  [key: string]: unknown
}

async function fetchBlockChildrenPage(blockId: string, startCursor?: string): Promise<{
  results: NotionRawBlock[]
  next_cursor: string | null
  has_more: boolean
}> {
  const params = new URLSearchParams({ page_size: '100' })
  if (startCursor) params.set('start_cursor', startCursor)
  const res = await notionGet(`/blocks/${blockId}/children?${params}`)
  const data = (await res.json()) as {
    results?: NotionRawBlock[]
    next_cursor?: string | null
    has_more?: boolean
  }
  if (!res.ok) {
    return { results: [], next_cursor: null, has_more: false }
  }
  return {
    results: data.results ?? [],
    next_cursor: data.next_cursor ?? null,
    has_more: Boolean(data.has_more),
  }
}

async function fetchAllBlockChildren(blockId: string): Promise<NotionRawBlock[]> {
  const all: NotionRawBlock[] = []
  let cursor: string | undefined
  do {
    const page = await fetchBlockChildrenPage(blockId, cursor)
    all.push(...page.results)
    cursor = page.has_more && page.next_cursor ? page.next_cursor : undefined
  } while (cursor)
  return all
}

export async function fetchBlockTree(pageId: string): Promise<NotionBlockWithChildren[]> {
  const top = await fetchAllBlockChildren(pageId)
  const withChildren = await Promise.all(
    top.map(async (b) => {
      if (b.has_children) {
        const children = await fetchBlockTree(b.id)
        return { ...b, children } as NotionBlockWithChildren
      }
      return { ...b, children: [] } as NotionBlockWithChildren
    })
  )
  return withChildren
}

/** Rich text array for rendering (exported for NotionContent). */
export function getRichTextArray(block: NotionBlockWithChildren, key: string): NotionRichTextItem[] {
  const payload = block[key] as { rich_text?: NotionRichTextItem[] } | undefined
  return payload?.rich_text ?? []
}
