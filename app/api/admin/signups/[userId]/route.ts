import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { isAdminByUserId } from '@/lib/admin-markets'
import { getMarketBySlug } from '@/lib/markets'

export const dynamic = 'force-dynamic'

/** GET /api/admin/signups/[userId] — one profile + intake for modal. Admin only. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const supabaseAuth = await createServerSupabase()
  if (!supabaseAuth) {
    return NextResponse.json({ error: 'Not configured' }, { status: 500 })
  }
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
  if (!userId) {
    return NextResponse.json({ error: 'Not signed in', code: 'NO_SESSION' }, { status: 401 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) {
    return NextResponse.json({ error: 'Server not configured' }, { status: 500 })
  }
  const supabase = createClient(url, key)

  const isAdmin = await isAdminByUserId(supabase, userId)
  if (!isAdmin) {
    return NextResponse.json({ error: 'Admin role required', code: 'NOT_ADMIN' }, { status: 403 })
  }

  const { userId: targetUserId } = await params
  if (!targetUserId?.trim()) {
    return NextResponse.json({ error: 'userId required' }, { status: 400 })
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', targetUserId.trim())
    .maybeSingle()

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 })
  }
  if (!profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  }

  const { data: intake, error: intakeError } = await supabase
    .from('intake_responses_v5')
    .select('responses, availability_times, completed_at')
    .eq('user_id', targetUserId.trim())
    .maybeSingle()

  if (intakeError) {
    return NextResponse.json({ error: intakeError.message }, { status: 500 })
  }

  const marketSlug = (profile as { market?: string | null }).market ?? null
  const marketLabel = marketSlug ? (getMarketBySlug(marketSlug)?.label ?? marketSlug) : null

  return NextResponse.json({
    profile: {
      id: profile.id,
      firstName: (profile as { first_name?: string | null }).first_name,
      birthdate: (profile as { birthdate?: string | null }).birthdate,
      gender: (profile as { gender?: string | null }).gender,
      genderPreference: (profile as { gender_preference?: string | null }).gender_preference,
      pronouns: (profile as { pronouns?: string | null }).pronouns,
      relationshipStatus: (profile as { relationship_status?: string | null }).relationship_status,
      city: (profile as { city?: string | null }).city,
      market: marketSlug,
      marketLabel,
      phone: (profile as { phone?: string | null }).phone,
      avatarUrl: (profile as { avatar_url?: string | null }).avatar_url,
      intentConfirmedAt: (profile as { intent_confirmed_at?: string | null }).intent_confirmed_at,
      lastFikaAt: (profile as { last_fika_at?: string | null }).last_fika_at,
      callCompletedAt: (profile as { call_completed_at?: string | null }).call_completed_at ?? null,
      createdAt: (profile as { created_at?: string }).created_at,
      updatedAt: (profile as { updated_at?: string }).updated_at,
    },
    intake: intake
      ? {
          responses: (intake as { responses?: unknown }).responses ?? [],
          availabilityTimes: (intake as { availability_times?: string[] | null }).availability_times ?? null,
          completedAt: (intake as { completed_at?: string | null }).completed_at ?? null,
        }
      : null,
  })
}

/** PATCH /api/admin/signups/[userId] — save post-call notes and optionally mark call complete. Admin only. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const supabaseAuth = await createServerSupabase()
  if (!supabaseAuth) return NextResponse.json({ error: 'Not configured' }, { status: 500 })

  let callerId: string | null = null
  const { data: { session } } = await supabaseAuth.auth.getSession()
  if (session?.user?.id) callerId = session.user.id
  if (!callerId) {
    const authHeader = request.headers.get('Authorization')
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7)
      const { data: { user } } = await supabaseAuth.auth.getUser(token)
      if (user?.id) callerId = user.id
    }
  }
  if (!callerId) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) return NextResponse.json({ error: 'Server not configured' }, { status: 500 })
  const supabase = createClient(url, key)

  const isAdmin = await isAdminByUserId(supabase, callerId)
  if (!isAdmin) return NextResponse.json({ error: 'Admin role required' }, { status: 403 })

  const { userId: targetUserId } = await params
  if (!targetUserId?.trim()) return NextResponse.json({ error: 'userId required' }, { status: 400 })

  const body = await request.json() as {
    q_about_me?: string
    q_social_goal?: string[]
    q_fika_time_pref?: string
    mark_call_complete?: boolean
  }

  // Merge intake fields
  const intakeFields: Array<{ question_id: string; question_text: string; answer: unknown }> = []
  if (body.q_about_me !== undefined) intakeFields.push({ question_id: 'q_about_me', question_text: 'About you', answer: body.q_about_me })
  if (body.q_social_goal !== undefined) intakeFields.push({ question_id: 'q_social_goal', question_text: 'What are you hoping to get out of Fika?', answer: body.q_social_goal })
  if (body.q_fika_time_pref !== undefined) intakeFields.push({ question_id: 'q_fika_time_pref', question_text: 'What times work best for your Fika meetups?', answer: body.q_fika_time_pref })

  if (intakeFields.length > 0) {
    const { data: existing } = await supabase.from('intake_responses_v5').select('responses').eq('user_id', targetUserId).maybeSingle()
    const merged = Array.isArray(existing?.responses) ? [...(existing.responses as object[])] : []
    const now = new Date().toISOString()
    for (const field of intakeFields) {
      const idx = merged.findIndex((m: { question_id?: string }) => m?.question_id === field.question_id)
      const item = { question_id: field.question_id, question_text: field.question_text, answer: field.answer, type: 'text', answered_at: now }
      if (idx >= 0) merged[idx] = item
      else merged.push(item)
    }
    await supabase.from('intake_responses_v5').upsert({ user_id: targetUserId, responses: merged, updated_at: now }, { onConflict: 'user_id' })
  }

  if (body.mark_call_complete) {
    await supabase.from('profiles').update({ call_completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', targetUserId)
  }

  return NextResponse.json({ ok: true })
}
