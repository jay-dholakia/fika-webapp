import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { isAdminByUserId } from '@/lib/admin-markets'

export const dynamic = 'force-dynamic'

async function getAdminContext(request: Request): Promise<{ userId: string; supabase: ReturnType<typeof createClient> } | null> {
  const supabaseAuth = await createServerSupabase()
  if (!supabaseAuth) return null

  let userId: string | null = null
  const { data: { session } } = await supabaseAuth.auth.getSession()
  if (session?.user?.id) userId = session.user.id
  if (!userId) {
    const authHeader = request.headers.get('Authorization')
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7)
      const { data: { user } } = await supabaseAuth.auth.getUser(token)
      if (user?.id) userId = user.id
    }
  }
  if (!userId) return null

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) throw new Error('Server not configured')
  const supabase = createClient(url, key)

  const admin = await isAdminByUserId(supabase, userId)
  if (!admin) {
    return null
  }
  return { userId, supabase }
}

function normalizeStatus(value: string | null): 'draft' | 'approved' | 'rejected' | 'expired' | null {
  if (!value) return null
  return ['draft', 'approved', 'rejected', 'expired'].includes(value) ? (value as 'draft' | 'approved' | 'rejected' | 'expired') : null
}

export async function GET(request: Request) {
  try {
    const context = await getAdminContext(request)
    if (!context) return NextResponse.json({ error: 'Admin role required', code: 'NOT_ADMIN' }, { status: 403 })

    const { searchParams } = new URL(request.url)
    const status = normalizeStatus(searchParams.get('status'))
    const source = searchParams.get('source')?.trim() || null
    const q = searchParams.get('q')?.trim() || null
    const limit = Math.min(500, Math.max(20, Number(searchParams.get('limit') ?? '200') || 200))

    let query = context.supabase
      .from('events')
      .select('*')
      .order('starts_at', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(limit)

    if (status) query = query.eq('status', status)
    if (source) query = query.eq('source', source)
    if (q) {
      const safe = q.replace(/[%_,]/g, ' ').trim()
      if (safe) {
        query = query.or(`title.ilike.%${safe}%,venue_name.ilike.%${safe}%,source_post_title.ilike.%${safe}%`)
      }
    }

    const { data, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({
      events: data ?? [],
      summary: {
        returned: (data ?? []).length,
        status,
        source,
        q,
        limit,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load events' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const context = await getAdminContext(request)
    if (!context) return NextResponse.json({ error: 'Admin role required', code: 'NOT_ADMIN' }, { status: 403 })

    const body = await request.json().catch(() => ({} as Record<string, unknown>))
    const source = typeof body.source === 'string' && body.source.trim() ? body.source.trim() : 'manual'
    const title = typeof body.title === 'string' ? body.title.trim() : ''
    if (!title) return NextResponse.json({ error: 'Title is required' }, { status: 400 })

    const row = {
      source,
      source_post_url: typeof body.source_post_url === 'string' ? body.source_post_url.trim() || null : null,
      source_post_title: typeof body.source_post_title === 'string' ? body.source_post_title.trim() || null : null,
      raw_event_text: typeof body.raw_event_text === 'string' ? body.raw_event_text.trim() || null : null,
      title,
      description_short: typeof body.description_short === 'string' ? body.description_short.trim() || null : null,
      starts_at: typeof body.starts_at === 'string' && body.starts_at.trim() ? body.starts_at.trim() : null,
      ends_at: typeof body.ends_at === 'string' && body.ends_at.trim() ? body.ends_at.trim() : null,
      venue_name: typeof body.venue_name === 'string' ? body.venue_name.trim() || null : null,
      neighborhood: typeof body.neighborhood === 'string' ? body.neighborhood.trim() || null : null,
      event_url: typeof body.event_url === 'string' ? body.event_url.trim() || null : null,
      category: typeof body.category === 'string' ? body.category.trim() || null : null,
      tags: Array.isArray(body.tags) ? body.tags.filter((x): x is string => typeof x === 'string' && x.trim().length > 0) : [],
      parsed_payload: body.parsed_payload && typeof body.parsed_payload === 'object' ? body.parsed_payload : {},
      confidence: typeof body.confidence === 'number' ? body.confidence : null,
      status: normalizeStatus(typeof body.status === 'string' ? body.status : null) ?? 'draft',
      review_notes: typeof body.review_notes === 'string' ? body.review_notes.trim() || null : null,
      ...(normalizeStatus(typeof body.status === 'string' ? body.status : null) === 'approved'
        ? { approved_at: new Date().toISOString(), approved_by: context.userId }
        : {}),
    }

    const { data, error } = await context.supabase
      .from('events')
      .insert(row)
      .select('*')
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, event: data })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create event' },
      { status: 500 }
    )
  }
}
