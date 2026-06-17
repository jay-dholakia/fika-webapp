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
