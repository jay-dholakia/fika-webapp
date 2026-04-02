import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { isAdminByUserId } from '@/lib/admin-markets'
import { listApprovedUpcomingEvents, formatApprovedEventsForSms, inferEventCategoryFromText } from '@/lib/events'

export const dynamic = 'force-dynamic'

async function isAuthorized(request: Request): Promise<boolean> {
  const authHeader = request.headers.get('Authorization')?.trim() ?? ''
  const cronSecret = process.env.CRON_SECRET?.trim()
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) return true

  const supabaseAuth = await createServerSupabase()
  if (!supabaseAuth) return false

  let userId: string | null = null
  const { data: { session } } = await supabaseAuth.auth.getSession()
  if (session?.user?.id) userId = session.user.id
  if (!userId && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7)
    const { data: { user } } = await supabaseAuth.auth.getUser(token)
    userId = user?.id ?? null
  }
  if (!userId) return false

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) return false
  const supabase = createClient(url, key)
  return isAdminByUserId(supabase, userId)
}

export async function GET(request: Request) {
  const allowed = await isAuthorized(request)
  if (!allowed) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) {
    return NextResponse.json({ error: 'Server not configured' }, { status: 500 })
  }

  try {
    const supabase = createClient(url, key)
    const { searchParams } = new URL(request.url)
    const q = searchParams.get('q')?.trim() || null
    const categoryParam = searchParams.get('category')?.trim() || null
    const category = categoryParam || inferEventCategoryFromText(q)
    const limit = Math.min(10, Math.max(1, Number(searchParams.get('limit') ?? '3') || 3))

    const events = await listApprovedUpcomingEvents({
      supabase,
      category,
      q,
      limit,
    })

    return NextResponse.json({
      events,
      smsPreview: formatApprovedEventsForSms(events),
      summary: {
        returned: events.length,
        category,
        q,
        limit,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load approved events' },
      { status: 500 }
    )
  }
}
