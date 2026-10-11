import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { isAdminByUserId } from '@/lib/admin-markets'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const supabaseAuth = await createServerSupabase()
    if (!supabaseAuth) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

    let userId: string | null = null
    const { data: { session } } = await supabaseAuth.auth.getSession()
    if (session?.user?.id) userId = session.user.id
    if (!userId) {
      const authHeader = request.headers.get('Authorization')
      if (authHeader?.startsWith('Bearer ')) {
        const { data: { user } } = await supabaseAuth.auth.getUser(authHeader.slice(7))
        if (user?.id) userId = user.id
      }
    }
    if (!userId) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
    if (!url || !key) return NextResponse.json({ error: 'Server not configured' }, { status: 500 })

    const supabase = createClient(url, key)
    if (!(await isAdminByUserId(supabase, userId))) {
      return NextResponse.json({ error: 'Admin role required' }, { status: 403 })
    }

    const { data, error } = await supabase
      .from('profiles')
      .select('id, first_name, market, city')
      .eq('is_active', true)
      .order('first_name', { ascending: true })
      .limit(500)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ users: data ?? [] })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 })
  }
}
