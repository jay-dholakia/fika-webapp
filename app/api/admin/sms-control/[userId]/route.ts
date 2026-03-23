import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { isAdminByUserId } from '@/lib/admin-markets'

export const dynamic = 'force-dynamic'

async function getAdminUserId(request: Request): Promise<string | null> {
  const supabaseAuth = await createServerSupabase()
  if (!supabaseAuth) return null
  const { data: { session } } = await supabaseAuth.auth.getSession()
  if (session?.user?.id) return session.user.id
  const authHeader = request.headers.get('Authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7)
    const { data: { user } } = await supabaseAuth.auth.getUser(token)
    return user?.id ?? null
  }
  return null
}

/** PATCH /api/admin/sms-control/[userId] — set sms_mode and optional human timeout. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const adminUserId = await getAdminUserId(request)
  if (!adminUserId) return NextResponse.json({ error: 'Not signed in', code: 'NO_SESSION' }, { status: 401 })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) return NextResponse.json({ error: 'Server not configured' }, { status: 500 })
  const supabase = createClient(url, key)

  const isAdmin = await isAdminByUserId(supabase, adminUserId)
  if (!isAdmin) return NextResponse.json({ error: 'Admin role required', code: 'NOT_ADMIN' }, { status: 403 })

  const { userId } = await params
  if (!userId?.trim()) return NextResponse.json({ error: 'userId required' }, { status: 400 })

  const body = await request.json().catch(() => ({} as Record<string, unknown>))
  const mode = body.mode === 'human' ? 'human' : 'auto'
  const hours = typeof body.hours === 'number' && Number.isFinite(body.hours) && body.hours > 0
    ? Math.min(168, Math.floor(body.hours))
    : null

  const smsHumanUntil = mode === 'human'
    ? (hours == null ? null : new Date(Date.now() + hours * 60 * 60 * 1000).toISOString())
    : null

  const { data, error } = await supabase
    .from('profiles')
    .update({
      sms_mode: mode,
      sms_human_until: smsHumanUntil,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId.trim())
    .select('id, sms_mode, sms_human_until')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({
    ok: true,
    userId: data.id,
    smsMode: data.sms_mode,
    smsHumanUntil: data.sms_human_until,
  })
}
