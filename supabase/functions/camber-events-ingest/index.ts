// Camber events ingestion: daily via pg_cron -> this Edge Function.

declare const Deno: { env: { get(key: string): string | undefined } }
// @ts-ignore Deno
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
// @ts-ignore Deno
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

type CamberPost = {
  title: string
  url: string
  subtitle: string | null
  pubDate: string | null
  content: string
}

type EventDraft = {
  source: 'camber'
  source_post_url: string
  source_post_title: string
  raw_event_text: string
  title: string
  description_short: string | null
  starts_at: string | null
  venue_name: string | null
  neighborhood: string | null
  category: string | null
  tags: string[]
  parsed_payload: Record<string, unknown>
  confidence: number
  status: 'draft'
}

async function expirePastEvents(supabase: any) {
  const nowIso = new Date().toISOString()
  const { data: staleRows, error: staleError } = await supabase
    .from('events')
    .select('id')
    .in('status', ['draft', 'approved'])
    .lt('starts_at', nowIso)

  if (staleError) throw staleError
  if (!staleRows?.length) return 0

  const { error: updateError } = await supabase
    .from('events')
    .update({ status: 'expired', expired_at: nowIso })
    .in('id', staleRows.map((row: { id: string }) => row.id))

  if (updateError) throw updateError
  return staleRows.length
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#8212;/g, '—')
    .replace(/&#8217;/g, "'")
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/&#8230;/g, '...')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
}

function stripTags(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|section|article|ul|ol|li|h1|h2|h3|h4|h5|h6|blockquote|figure)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\r/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  )
}

function cleanInline(text: string): string {
  return text
    .replace(/_+/g, '')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseRssItems(xml: string): CamberPost[] {
  const items = Array.from(xml.matchAll(/<item>([\s\S]*?)<\/item>/g))
  return items.map((match) => {
    const item = match[1]
    const title = decodeHtmlEntities((item.match(/<title>\s*<!\[CDATA\[(.*?)\]\]>\s*<\/title>/s)?.[1]
      ?? item.match(/<title>([\s\S]*?)<\/title>/s)?.[1]
      ?? '').trim())
    const subtitle = decodeHtmlEntities((item.match(/<description>\s*<!\[CDATA\[(.*?)\]\]>\s*<\/description>/s)?.[1]
      ?? item.match(/<description>([\s\S]*?)<\/description>/s)?.[1]
      ?? '').trim()) || null
    const url = decodeHtmlEntities((item.match(/<link>([\s\S]*?)<\/link>/s)?.[1] ?? '').trim())
    const pubDate = (item.match(/<pubDate>([\s\S]*?)<\/pubDate>/s)?.[1] ?? '').trim() || null
    const contentRaw = item.match(/<content:encoded>\s*<!\[CDATA\[(.*?)\]\]>\s*<\/content:encoded>/s)?.[1] ?? ''
    return {
      title: cleanInline(title),
      subtitle: subtitle ? cleanInline(subtitle) : null,
      url,
      pubDate,
      content: stripTags(contentRaw),
    }
  }).filter((item) => item.title && item.url)
}

async function fetchCamberFeed(): Promise<CamberPost[]> {
  const response = await fetch('https://camberplaces.substack.com/feed', {
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; FikaBot/1.0; +https://letsfika.co)',
    },
  })

  if (!response.ok) {
    throw new Error(`Camber fetch failed (${response.status})`)
  }

  return parseRssItems(await response.text())
}

function isWeeklyRoundup(post: CamberPost): boolean {
  return /\b\d{1,2}\/\d{1,2}\s*-\s*\d{1,2}\/\d{1,2}\b/.test(post.subtitle ?? '')
}

function inferCategory(text: string): string | null {
  const lower = text.toLowerCase()
  if (/(singles|speed dating|dating)/.test(lower)) return 'social'
  if (/(party|dance|watch party|anniversary|nightlife|cocktail|bar)/.test(lower)) return 'nightlife'
  if (/(market|shopping|pop up|popup|boutique|drop)/.test(lower)) return 'shopping'
  if (/(hike|run|pilates|workout|yoga|cold plunge|sound bath|stadium|sports)/.test(lower)) return 'wellness'
  if (/(pottery|art|gallery|collage|fair|museum|book|photo|photobooth)/.test(lower)) return 'arts'
  if (/(dinner|brunch|coffee|wine|pizza|feast|food|restaurant|lunch)/.test(lower)) return 'food'
  return null
}

function inferTags(text: string): string[] {
  const lower = text.toLowerCase()
  const tags = new Set<string>()
  if (/(women|girlie|ladies)/.test(lower)) tags.add('women')
  if (/(runner|marathon|running)/.test(lower)) tags.add('running')
  if (/(singles|dating)/.test(lower)) tags.add('dating')
  if (/(pop up|popup)/.test(lower)) tags.add('pop-up')
  if (/(charity|fundraiser|raise money)/.test(lower)) tags.add('charity')
  if (/(free|rsvp)/.test(lower)) tags.add('rsvp')
  return Array.from(tags)
}

function extractVenue(text: string): string | null {
  const patterns = [
    /\bat\s+([A-Z][A-Za-z0-9&'.\- ]{2,60})/,
    /\bto\s+([A-Z][A-Za-z0-9&'.\- ]{2,60})\s+for\b/,
    /\bhost(?:ing)?\s+(?:the\s+)?(?:.*?\s+)?at\s+([A-Z][A-Za-z0-9&'.\- ]{2,60})/,
  ]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    const venue = cleanInline(match?.[1] ?? '')
      .replace(/[.!?,;:]+$/g, '')
      .trim()
    if (venue) return venue
  }
  return null
}

function extractTitle(text: string): string {
  const boldSegments = Array.from(text.matchAll(/\*\*(.*?)\*\*/g)).map((match) => cleanInline(match[1]))
  if (boldSegments.length >= 2) return boldSegments[1]
  if (boldSegments.length === 1) return boldSegments[0]
  return cleanInline(text.replace(/^[*-]\s*/, '').split(/[.!?]/)[0] ?? 'Camber event')
}

function toStartsAtIso(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month - 1, day, 19, 0, 0)).toISOString()
}

function extractTitleFromDescription(text: string): string {
  const cleaned = cleanInline(text)
  const sentence = cleaned
    .split(/(?<=[!?])\s+/)
    .map((part) => part.trim())
    .find((part) => /[A-Z]/.test(part)) ?? cleaned

  const titleMatch =
    sentence.match(/([A-Z][A-Za-z0-9'&.-]+(?:\s+(?:[A-Z][A-Za-z0-9'&.-]+|x|X|of|the|and|for|LA|Club|Day|Night|Party|Fest|Festival|Showcase|Market|Dinner|Social|Walk|Hotel|Project|Brewery|Meadows)){0,8})(?=\s+(?:is|are|invites|invite|opens|open|taking|hosts|hosting|returns|returning|will|sounds|mixer|party))/)
    ?? sentence.match(/([A-Z][A-Za-z0-9'&.-]+(?:\s+(?:[A-Z][A-Za-z0-9'&.-]+|x|X|of|the|and|for|LA|Club|Day|Night|Party|Fest|Festival|Showcase|Market|Dinner|Social|Walk|Hotel|Project|Brewery|Meadows)){0,8})/)

  const candidate = cleanInline(titleMatch?.[1] ?? '')
    .replace(/^(Who's ready to laugh\?\s*)/i, '')
    .replace(/^(Okay this sounds fun\.\s*)/i, '')
    .trim()

  const generic = new Set(['This', 'There', 'All', 'It', 'The', 'A'])
  if (candidate && candidate.length >= 4 && !generic.has(candidate)) return candidate

  const fallback = cleaned
    .replace(/^(This|There|It)\s+/i, '')
    .split(/\s+/)
    .slice(0, 8)
    .join(' ')
    .trim()
  return fallback || 'Camber event'
}

function parsePlaintextEventLine(params: {
  line: string
  sourcePostUrl: string
  sourcePostTitle: string
  sourcePostSubtitle: string | null
  pubDate: string | null
  startsAt: string
}): EventDraft | null {
  const match = params.line.match(/^([A-Z][A-Za-z'&.\- ]{1,40})\s+([\p{Extended_Pictographic}\uFE0F\u200D]+)\s+(.*)$/u)
  if (!match) return null

  const neighborhood = cleanInline(match[1]).trim()
  const description = cleanInline(match[3])
  if (!description || description.length < 8) return null

  return {
    source: 'camber',
    source_post_url: params.sourcePostUrl,
    source_post_title: params.sourcePostTitle,
    raw_event_text: params.line,
    title: extractTitleFromDescription(description),
    description_short: description.slice(0, 320) || null,
    starts_at: params.startsAt,
    venue_name: extractVenue(description),
    neighborhood: neighborhood || null,
    category: inferCategory(description),
    tags: inferTags(description),
    parsed_payload: {
      post_subtitle: params.sourcePostSubtitle,
      published_at: params.pubDate,
    },
    confidence: 0.7,
    status: 'draft',
  }
}

function parseWeeklyRoundup(post: CamberPost): EventDraft[] {
  const pub = post.pubDate ? new Date(post.pubDate) : new Date()
  const year = Number.isNaN(pub.getTime()) ? new Date().getUTCFullYear() : pub.getUTCFullYear()
  const lines = post.content
    .split('\n')
    .map((line) => line.replace(/\r/g, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)

  const drafts: EventDraft[] = []
  let currentMonth: number | null = null
  let currentDay: number | null = null
  let inEventsSection = false

  for (const line of lines) {
    if (/^The coolest events happening in Los Angeles this week\.?$/i.test(line)) {
      inEventsSection = true
      continue
    }
    if (/^Want to see your event in an upcoming newsletter\?$/i.test(line) || /^New openings,/i.test(line)) {
      inEventsSection = false
    }

    const heading = line.match(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+(\d{1,2})\/(\d{1,2})$/i)
    if (heading) {
      currentMonth = Number(heading[2])
      currentDay = Number(heading[3])
      continue
    }

    if (!inEventsSection) continue
    if (currentMonth == null || currentDay == null) continue

    const event = parsePlaintextEventLine({
      line,
      sourcePostUrl: post.url,
      sourcePostTitle: post.title,
      sourcePostSubtitle: post.subtitle,
      pubDate: post.pubDate,
      startsAt: toStartsAtIso(year, currentMonth, currentDay),
    })
    if (!event) continue
    event.parsed_payload.roundup_day = `${currentMonth}/${currentDay}`
    drafts.push(event)
  }

  return drafts
}

async function upsertDrafts(supabase: any, drafts: EventDraft[]) {
  if (!drafts.length) return { inserted: 0, skipped: 0 }

  const postUrls = Array.from(new Set(drafts.map((draft) => draft.source_post_url)))
  const { data: existingRows, error: existingError } = await supabase
    .from('events')
    .select('source_post_url, title, venue_name')
    .eq('source', 'camber')
    .in('source_post_url', postUrls)

  if (existingError) throw existingError

  const existingKeys = new Set(
    (existingRows ?? []).map((row: { source_post_url: string | null; title: string | null; venue_name: string | null }) =>
      [row.source_post_url ?? '', row.title ?? '', row.venue_name ?? ''].join('::')
    )
  )

  const seenBatchKeys = new Set<string>()
  const freshDrafts = drafts.filter((draft) => {
    const key = [draft.source_post_url, draft.title, draft.venue_name ?? ''].join('::')
    if (existingKeys.has(key) || seenBatchKeys.has(key)) return false
    seenBatchKeys.add(key)
    return true
  })

  if (!freshDrafts.length) return { inserted: 0, skipped: drafts.length }

  const { error: insertError } = await supabase.from('events').insert(freshDrafts)
  if (insertError) throw insertError

  return {
    inserted: freshDrafts.length,
    skipped: drafts.length - freshDrafts.length,
  }
}

serve(async () => {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const [expiredCount, feedPosts] = await Promise.all([
      expirePastEvents(supabase),
      fetchCamberFeed(),
    ])

    const roundupPosts = feedPosts.filter(isWeeklyRoundup).slice(0, 6)
    const drafts = roundupPosts.flatMap(parseWeeklyRoundup)
    const { inserted, skipped } = await upsertDrafts(supabase, drafts)

    return new Response(JSON.stringify({
      ok: true,
      expiredCount,
      inspectedPosts: roundupPosts.length,
      insertedDrafts: inserted,
      skippedDrafts: skipped,
      samplePosts: roundupPosts.slice(0, 3).map((post) => ({
        title: post.title,
        subtitle: post.subtitle,
        url: post.url,
      })),
    }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({
      error: e instanceof Error
        ? { message: e.message, stack: e.stack }
        : e,
    }), { status: 500 })
  }
})
