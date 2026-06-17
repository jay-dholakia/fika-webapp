import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { isAdminByUserId } from '@/lib/admin-markets'

export const dynamic = 'force-dynamic'

async function getAdminSupabase(request: Request): Promise<SupabaseClient | null> {
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
  return supabase
}

/** GET /api/admin/weekly-events/[id]/rsvps
 *  Returns all RSVPs for this event with user details and counts by decision. */
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await getAdminSupabase(request)
    if (!supabase) return NextResponse.json({ error: 'Admin role required', code: 'NOT_ADMIN' }, { status: 403 })

    const eventId = params.id

    const { data: rsvps, error } = await supabase
      .from('weekly_rsvps')
      .select('user_id, decision, decided_at, created_at, profiles(id, first_name, phone, avatar_url)')
      .eq('event_id', eventId)
      .order('decided_at', { ascending: false })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const counts = { yes: 0, no: 0, cancelled: 0, no_response: 0 }
    for (const r of rsvps ?? []) {
      const d = (r.decision as string) ?? 'no_response'
      if (d in counts) counts[d as keyof typeof counts]++
    }

    return NextResponse.json({ rsvps: rsvps ?? [], counts })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
