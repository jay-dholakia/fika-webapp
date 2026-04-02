import type { SupabaseClient } from '@supabase/supabase-js'

export type ApprovedEventRow = {
  id: string
  source: string
  title: string | null
  description_short: string | null
  starts_at: string | null
  ends_at: string | null
  venue_name: string | null
  neighborhood: string | null
  event_url: string | null
  category: string | null
  tags: string[] | null
  status: 'draft' | 'approved' | 'rejected' | 'expired'
  source_post_title: string | null
  source_post_url: string | null
}

export const EVENT_CATEGORY_SYNONYMS: Record<string, string[]> = {
  food: ['food', 'dinner', 'brunch', 'coffee', 'restaurant', 'lunch', 'drinks'],
  arts: ['arts', 'art', 'gallery', 'museum', 'photo', 'book', 'culture'],
  wellness: ['wellness', 'fitness', 'run', 'workout', 'pilates', 'yoga', 'health'],
  shopping: ['shopping', 'market', 'popup', 'pop-up', 'shop', 'vintage'],
  nightlife: ['nightlife', 'party', 'bar', 'cocktail', 'dance', 'music'],
  social: ['social', 'dating', 'singles', 'mixer', 'community', 'meet people'],
}

const EVENT_ENTRY_KEYWORDS = new Set(['EVENT', 'EVENTS', 'PLAN', 'PLANS', 'THINGSTODO'])
const EVENT_ENTRY_PHRASES = [
  "what's going on this week",
  "whats going on this week",
  "what’s going on this week",
  "what's happening this week",
  "whats happening this week",
  "what’s happening this week",
  'any plans this week',
  'anything fun this week',
  "what's happening",
  "whats happening",
  "what’s happening",
  "what's going on",
  "whats going on",
  "what’s going on",
]

function normalizeKeywordToken(input: string): string {
  return input.toUpperCase().replace(/[^A-Z]/g, '')
}

function normalizeMessage(input: string | null | undefined): string {
  return (input ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^\w\s']/g, ' ')
    .replace(/\s+/g, ' ')
}

export function isEventKeyword(input: string | null | undefined): boolean {
  const normalized = normalizeMessage(input)
  const token = normalizeKeywordToken(input ?? '')
  if (!token && !normalized) return false
  if (EVENT_ENTRY_PHRASES.includes(normalized)) return true
  if (EVENT_ENTRY_KEYWORDS.has(token)) return true
  return Object.keys(EVENT_CATEGORY_SYNONYMS).some((category) => normalizeKeywordToken(category) === token)
    || Object.values(EVENT_CATEGORY_SYNONYMS).some((synonyms) =>
      synonyms.some((synonym) => normalizeKeywordToken(synonym) === token)
    )
}

export function parseEventCategoryFromKeyword(input: string | null | undefined): string | null {
  const normalized = normalizeMessage(input)
  const token = normalizeKeywordToken(input ?? '')
  if (EVENT_ENTRY_PHRASES.includes(normalized)) return null
  if (!token || EVENT_ENTRY_KEYWORDS.has(token)) return null
  for (const [category, synonyms] of Object.entries(EVENT_CATEGORY_SYNONYMS)) {
    if (normalizeKeywordToken(category) === token) return category
    if (synonyms.some((synonym) => normalizeKeywordToken(synonym) === token)) return category
  }
  return null
}

export function messageEventKeywordPrompt(): string {
  return 'I can send curated picks for dinner, art, wellness, shopping, drinks, or social plans. What are you in the mood for?'
}

export function normalizeEventCategory(input: string | null | undefined): string | null {
  const value = input?.trim().toLowerCase()
  if (!value) return null
  for (const [category, synonyms] of Object.entries(EVENT_CATEGORY_SYNONYMS)) {
    if (category === value || synonyms.includes(value)) return category
  }
  return value
}

export function inferEventCategoryFromText(input: string | null | undefined): string | null {
  const value = input?.trim().toLowerCase()
  if (!value) return null
  for (const [category, synonyms] of Object.entries(EVENT_CATEGORY_SYNONYMS)) {
    if (value.includes(category)) return category
    if (synonyms.some((synonym) => value.includes(synonym))) return category
  }
  return null
}

export async function listApprovedUpcomingEvents(params: {
  supabase: SupabaseClient
  category?: string | null
  q?: string | null
  limit?: number
  startsAfterIso?: string
}): Promise<ApprovedEventRow[]> {
  const category = normalizeEventCategory(params.category ?? null)
  const q = params.q?.trim() ?? ''
  const limit = Math.min(20, Math.max(1, params.limit ?? 3))
  const startsAfterIso = params.startsAfterIso ?? new Date().toISOString()

  let query = params.supabase
    .from('events')
    .select([
      'id',
      'source',
      'title',
      'description_short',
      'starts_at',
      'ends_at',
      'venue_name',
      'neighborhood',
      'event_url',
      'category',
      'tags',
      'status',
      'source_post_title',
      'source_post_url',
    ].join(','))
    .eq('status', 'approved')
    .gte('starts_at', startsAfterIso)
    .order('starts_at', { ascending: true, nullsFirst: false })
    .limit(limit * 4)

  if (category) query = query.eq('category', category)
  if (q) {
    const safe = q.replace(/[%_,]/g, ' ').trim()
    if (safe) {
      query = query.or(`title.ilike.%${safe}%,description_short.ilike.%${safe}%,venue_name.ilike.%${safe}%`)
    }
  }

  const { data, error } = await query
  if (error) throw error

  const rows = (data ?? []) as ApprovedEventRow[]
  return rows.slice(0, limit)
}

export function formatApprovedEventsForSms(events: ApprovedEventRow[]): string {
  if (!events.length) {
    return "I don't have any approved event picks ready right now, but I'll have more soon."
  }

  const formatter = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

  const lines = events.map((event, index) => {
    const when = event.starts_at ? formatter.format(new Date(event.starts_at)) : 'TBD'
    const place = [event.venue_name, event.neighborhood].filter(Boolean).join(', ')
    const url = event.event_url?.trim() || event.source_post_url?.trim() || null
    return `${index + 1}. ${event.title ?? 'Event'} - ${when}${place ? ` - ${place}` : ''}${url ? `\n${url}` : ''}`
  })

  return lines.join('\n\n')
}
