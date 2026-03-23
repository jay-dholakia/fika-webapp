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

/** GET /api/admin/sms-control — list users + sms mode. Admin only. */
export async function GET(request: Request) {
  const userId = await getAdminUserId(request)
  if (!userId) return NextResponse.json({ error: 'Not signed in', code: 'NO_SESSION' }, { status: 401 })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) return NextResponse.json({ error: 'Server not configured' }, { status: 500 })
  const supabase = createClient(url, key)

  const isAdmin = await isAdminByUserId(supabase, userId)
  if (!isAdmin) return NextResponse.json({ error: 'Admin role required', code: 'NOT_ADMIN' }, { status: 403 })

  const { data, error } = await supabase
    .from('profiles')
    .select('id, first_name, phone, city, market, sms_mode, sms_human_until, updated_at')
    .not('phone', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(500)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const users = (data ?? []).map((p) => ({
    id: p.id,
    firstName: (p as { first_name?: string | null }).first_name ?? null,
    phone: (p as { phone?: string | null }).phone ?? null,
    city: (p as { city?: string | null }).city ?? null,
    market: (p as { market?: string | null }).market ?? null,
    smsMode: (p as { sms_mode?: string | null }).sms_mode ?? 'auto',
    smsHumanUntil: (p as { sms_human_until?: string | null }).sms_human_until ?? null,
    updatedAt: (p as { updated_at?: string | null }).updated_at ?? null,
  }))

  return NextResponse.json({ users })
}
