/**
 * Server-only: query a Notion database for the public /thoughts page.
 * Requires NOTION_API_KEY and (optionally) NOTION_THOUGHTS_DATABASE_ID — see .env.example
 */

const NOTION_VERSION = '2022-06-28'
const NOTION_QUERY = 'https://api.notion.com/v1/databases'

/** From share URL …/Fika-…-331ef446c13680babaaef285f633c8c5 (ID is not secret). */
const DEFAULT_DATABASE_ID = '331ef446-c136-80ba-baae-f285f633c8c5'

export type ThoughtEntry = {
  id: string
  title: string
  summary: string | null
  publishedAt: string | null
  href: string
}

export type ThoughtsFetchResult = {
  items: ThoughtEntry[]
  /** User-facing message when Notion returns an error */
  error: string | null
  /** True when NOTION_API_KEY is missing */
  configMissing: boolean
}

type NotionRichText = { plain_text: string }

type NotionProperty =
  | { type: 'title'; title: NotionRichText[] }
  | { type: 'rich_text'; rich_text: NotionRichText[] }
  | { type: 'date'; date: { start: string } | null }
  | { type: 'url'; url: string | null }
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

function joinRichText(items: NotionRichText[] | undefined): string {
  return items?.map((t) => t.plain_text).join('') ?? ''
}

function extractFromProperties(properties: Record<string, NotionProperty>): {
  title: string
  summary: string | null
  publishedAt: string | null
  externalUrl: string | null
  titlePropName: string | null
} {
  let title = 'Untitled'
  let titlePropName: string | null = null
  let publishedAt: string | null = null
  let externalUrl: string | null = null

  for (const [name, prop] of Object.entries(properties)) {
    if (prop.type === 'title') {
      const titleBits = (prop as NotionProperty & { type: 'title'; title: NotionRichText[] }).title
      if (!titleBits?.length) continue
      const t = joinRichText(titleBits).trim()
      if (t) {
        title = t
        titlePropName = name
        break
      }
    }
  }

  const dateEntries = Object.entries(properties).filter(
    (e): e is [string, NotionProperty & { type: 'date'; date: { start: string } | null }] =>
      e[1].type === 'date'
  )
  const preferredDateName = dateEntries.find(([n]) => /publish|date|posted/i.test(n))
  const dateProp = preferredDateName?.[1] ?? dateEntries[0]?.[1]
  if (dateProp?.date?.start) publishedAt = dateProp.date.start

  const urlEntries = Object.entries(properties).filter(
    (e): e is [string, NotionProperty & { type: 'url'; url: string | null }] => e[1].type === 'url'
  )
  const urlProp = urlEntries.find(([n]) => /link|url|href/i.test(n))?.[1] ?? urlEntries[0]?.[1]
  if (typeof urlProp?.url === 'string' && urlProp.url.trim()) externalUrl = urlProp.url.trim()

  let summary: string | null = null
  for (const [name, prop] of Object.entries(properties)) {
    if (prop.type === 'rich_text' && name !== titlePropName) {
      const bits = (prop as NotionProperty & { type: 'rich_text'; rich_text: NotionRichText[] }).rich_text
      const t = joinRichText(bits).trim()
      if (t) {
        summary = t.length > 280 ? `${t.slice(0, 277)}…` : t
        break
      }
    }
  }

  return { title, summary, publishedAt, externalUrl, titlePropName }
}

function notionPublicPageUrl(pageId: string): string {
  const id = pageId.replace(/-/g, '')
  return `https://www.notion.so/${id}`
}

function pageToEntry(page: NotionPage): ThoughtEntry {
  const { title, summary, publishedAt, externalUrl } = extractFromProperties(page.properties)
  const href = externalUrl ?? notionPublicPageUrl(page.id)
  return { id: page.id, title, summary, publishedAt, href }
}

export async function fetchThoughtsFromNotion(): Promise<ThoughtsFetchResult> {
  const apiKey = process.env.NOTION_API_KEY?.trim()
  if (!apiKey) {
    return { items: [], error: null, configMissing: true }
  }

  const databaseId = resolveDatabaseId()
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'Notion-Version': NOTION_VERSION,
  }

  const items: ThoughtEntry[] = []
  let cursor: string | undefined

  try {
    do {
      const body: Record<string, unknown> = {
        page_size: 100,
        sorts: [{ timestamp: 'created_time', direction: 'descending' }],
      }
      if (cursor) body.start_cursor = cursor

      const res = await fetch(`${NOTION_QUERY}/${databaseId}/query`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        next: { revalidate: 120 },
      })

      const data = (await res.json()) as {
        object?: string
        message?: string
        code?: string
        results?: NotionPage[]
        has_more?: boolean
        next_cursor?: string | null
      }

      if (!res.ok) {
        const msg =
          typeof data.message === 'string'
            ? data.message
            : `Notion request failed (${res.status}).`
        return {
          items: [],
          error:
            res.status === 401 || res.status === 403
              ? `${msg} In Notion: open the database → ••• → Connections → add your integration.`
              : msg,
          configMissing: false,
        }
      }

      const results = data.results ?? []
      for (const page of results) {
        if (page?.object !== 'page' || page.archived) continue
        if (!page.properties) continue
        items.push(pageToEntry(page as NotionPage))
      }

      cursor = data.has_more && data.next_cursor ? data.next_cursor : undefined
    } while (cursor)

    return { items, error: null, configMissing: false }
  } catch {
    return {
      items: [],
      error: 'Could not load thoughts. Try again later.',
      configMissing: false,
    }
  }
}
