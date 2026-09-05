/**
 * POST /api/merge-sms-signup — after Google OAuth, merge onboarding_sessions into the authenticated user.
 * Body: { token }. Requires auth Bearer token. Called from /auth/callback when ?sms_token= is present.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { mergeOnboardingSession } from '@/lib/merge-onboarding-session'

export async function POST(request: Request) {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Missing or invalid Authorization' }, { status: 401 })
  }
  const accessToken = authHeader.slice(7)
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !anonKey || !serviceKey) {
    return NextResponse.json({ error: 'Not configured' }, { status: 500 })
  }

  const supabaseUser = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  })
  const { data: { user }, error: userError } = await supabaseUser.auth.getUser(accessToken)
  if (userError || !user?.id) {
    return NextResponse.json({ error: 'Invalid token or user not found' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const sessionToken = typeof body.token === 'string' ? body.token : null
  if (!sessionToken) return NextResponse.json({ error: 'Missing token' }, { status: 400 })

  const supabase = createClient(url, serviceKey)
  const openaiKey = process.env.EXPO_PUBLIC_OPENAI_API_KEY || process.env.OPENAI_API_KEY
  const result = await mergeOnboardingSession(supabase, user.id, sessionToken, openaiKey ?? undefined)

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.error === 'Invalid or already used link' ? 404 : 500 })
  }

  return NextResponse.json({ ok: true })
}
