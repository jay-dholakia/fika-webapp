import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { isAdminByUserId } from '@/lib/admin-markets'

export const dynamic = 'force-dynamic'

async function getAdminContext(request: Request): Promise<{ userId: string; supabase: SupabaseClient } | null> {
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
  if (!admin) return null

  return { userId, supabase }
}

function normalizeStatus(value: string | null): 'draft' | 'approved' | 'rejected' | 'expired' | null {
  if (!value) return null
  return ['draft', 'approved', 'rejected', 'expired'].includes(value) ? (value as 'draft' | 'approved' | 'rejected' | 'expired') : null
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ eventId: string }> }
) {
  try {
    const admin = await getAdminContext(request)
    if (!admin) return NextResponse.json({ error: 'Admin role required', code: 'NOT_ADMIN' }, { status: 403 })

    const { eventId } = await context.params
    const body = await request.json().catch(() => ({} as Record<string, unknown>))
    const nextStatus = normalizeStatus(typeof body.status === 'string' ? body.status : null)

    const update: Record<string, unknown> = {}
    const patchable = [
      'title',
      'description_short',
      'starts_at',
      'ends_at',
      'venue_name',
      'neighborhood',
      'event_url',
      'category',
      'review_notes',
      'source_post_url',
      'source_post_title',
      'raw_event_text',
    ] as const

    for (const key of patchable) {
      if (key in body) {
        const value = body[key]
        update[key] = typeof value === 'string' ? value.trim() || null : value ?? null
      }
    }

    if ('tags' in body) {
      update.tags = Array.isArray(body.tags)
        ? body.tags.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
        : []
    }

    if ('parsed_payload' in body && body.parsed_payload && typeof body.parsed_payload === 'object') {
      update.parsed_payload = body.parsed_payload
    }

    if ('confidence' in body) {
      update.confidence = typeof body.confidence === 'number' ? body.confidence : null
    }

    if (nextStatus) {
      update.status = nextStatus
      if (nextStatus === 'approved') {
        update.approved_at = new Date().toISOString()
        update.approved_by = admin.userId
        update.rejected_at = null
        update.rejected_by = null
        update.expired_at = null
      } else if (nextStatus === 'rejected') {
        update.rejected_at = new Date().toISOString()
        update.rejected_by = admin.userId
      } else if (nextStatus === 'expired') {
        update.expired_at = new Date().toISOString()
      }
    }

    const { data, error } = await admin.supabase
      .from('events')
      .update(update)
      .eq('id', eventId)
      .select('*')
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, event: data })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update event' },
      { status: 500 }
    )
  }
}
