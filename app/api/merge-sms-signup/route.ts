/**
 * POST /api/merge-sms-signup — after "Sign in with Google to finalize", merge onboarding_sessions into the authenticated user.
 * Body: { token }. Requires auth. Sets profile.phone and profile + intake from session payload.
 * Sends entry SMS when merge includes phone so user gets "Reply YES or SKIP" after first-time signup.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendMessage } from '@/lib/sendblue'
import { getOrCreateSmsState, messageEntry, SMS_STATES } from '@/lib/sms-agent'
import { getCurrentBatchWeek } from '@/lib/onboarding'

export async function POST(request: Request) {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Missing or invalid Authorization' }, { status: 401 })
  }
  const token = authHeader.slice(7)
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !anonKey || !serviceKey) {
    return NextResponse.json({ error: 'Not configured' }, { status: 500 })
  }
  const supabaseUser = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data: { user }, error: userError } = await supabaseUser.auth.getUser(token)
  if (userError || !user?.id) {
    return NextResponse.json({ error: 'Invalid token or user not found' }, { status: 401 })
  }
  const body = await request.json().catch(() => ({}))
  const sessionToken = typeof body.token === 'string' ? body.token : null
  if (!sessionToken) return NextResponse.json({ error: 'Missing token' }, { status: 400 })

  const supabase = createClient(url, serviceKey)
  const { data: session, error: sessionError } = await supabase
    .from('onboarding_sessions')
    .select('id, phone, payload')
    .eq('token', sessionToken)
    .is('merged_into_user_id', null)
    .maybeSingle()
  if (sessionError) return NextResponse.json({ error: sessionError.message }, { status: 500 })
  if (!session) return NextResponse.json({ error: 'Invalid or already used link' }, { status: 404 })

  const payload = (session.payload as Record<string, unknown>) ?? {}
  const first_name = (payload.first_name as string)?.trim() || ' '
  const birthdate = payload.birthdate as string | null
  const gender = payload.gender as string | null
  const gender_preference = payload.gender_preference as string | null
  const languages = Array.isArray(payload.languages) ? payload.languages : null
  const city = (payload.city as string) ?? null
  const lat = typeof payload.lat === 'number' ? payload.lat : null
  const lng = typeof payload.lng === 'number' ? payload.lng : null
  const responses = Array.isArray(payload.responses) ? payload.responses : []
  const avatarPath = typeof payload.avatar_path === 'string' ? payload.avatar_path : null

  let avatarUrl: string | null = null
  if (avatarPath) {
    const ext = avatarPath.includes('.') ? avatarPath.split('.').pop() ?? 'jpg' : 'jpg'
    const destPath = `${user.id}/avatar.${ext}`
    const { error: copyErr } = await supabase.storage.from('avatars').copy(avatarPath, destPath)
    if (!copyErr) {
      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(destPath)
      avatarUrl = urlData.publicUrl
    }
  }

  await supabase.from('profiles').upsert(
    {
      id: user.id,
      first_name,
      birthdate: birthdate || null,
      gender: gender || null,
      gender_preference: gender_preference || null,
      languages,
      city: city || null,
      lat,
      lng,
      phone: session.phone || null,
      avatar_url: avatarUrl ?? null,
      intent_confirmed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' }
  )

  if (responses.length > 0) {
    const { data: existing } = await supabase
      .from('intake_responses_v5')
      .select('responses')
      .eq('user_id', user.id)
      .maybeSingle()
    const merged = Array.isArray(existing?.responses) ? [...(existing.responses as object[])] : []
    for (const r of responses as Array<{ question_id: string; answer: unknown; question_text?: string; type?: string; answered_at?: string }>) {
      const idx = merged.findIndex((m: { question_id?: string }) => m?.question_id === r.question_id)
      const item = {
        question_id: r.question_id,
        question_text: r.question_text ?? '',
        answer: r.answer,
        type: r.type ?? 'text',
        answered_at: r.answered_at ?? new Date().toISOString(),
      }
      if (idx >= 0) merged[idx] = item
      else merged.push(item)
    }
    const completedAt = new Date().toISOString()
    await supabase.from('intake_responses_v5').upsert(
      {
        user_id: user.id,
        responses: merged,
        completed_at: completedAt,
        updated_at: completedAt,
      },
      { onConflict: 'user_id' }
    )
  }

  await supabase
    .from('onboarding_sessions')
    .update({
      merged_into_user_id: user.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', session.id)

  // After first-time merge: send entry SMS. Create state before sending so a quick YES reply progresses.
  if (session.phone && process.env.SENDBLUE_API_KEY_ID) {
    try {
      await getOrCreateSmsState(supabase, user.id, SMS_STATES.AWAITING_OPT_IN, {
        batch_week: getCurrentBatchWeek(),
      })
      const entryMsg = messageEntry()
      await sendMessage(session.phone, entryMsg, { fromNumber: 'concierge' })
    } catch {
      // Non-fatal
    }
  }

  return NextResponse.json({ ok: true })
}
