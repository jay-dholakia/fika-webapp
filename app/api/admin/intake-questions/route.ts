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

/** GET /api/admin/intake-questions — list all questions ordered by display_order */
export async function GET(request: Request) {
  try {
    const supabase = await getAdminSupabase(request)
    if (!supabase) return NextResponse.json({ error: 'Admin role required' }, { status: 403 })

    const { data, error } = await supabase
      .from('intake_question_config')
      .select('*')
      .order('display_order', { ascending: true })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ questions: data ?? [] })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

/** POST /api/admin/intake-questions — create a new question */
export async function POST(request: Request) {
  try {
    const supabase = await getAdminSupabase(request)
    if (!supabase) return NextResponse.json({ error: 'Admin role required' }, { status: 403 })

    const body = await request.json()
    const { question_id, label, body: bodyText, type, options, required, enabled, display_order, max_selections, placeholder } = body

    if (!question_id || !label || !type) {
      return NextResponse.json({ error: 'question_id, label, and type are required' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('intake_question_config')
      .insert({
        question_id,
        label,
        body: bodyText ?? null,
        type,
        options: options ?? null,
        required: required ?? false,
        enabled: enabled ?? true,
        display_order: display_order ?? 0,
        max_selections: max_selections ?? null,
        placeholder: placeholder ?? null,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ question: data }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
