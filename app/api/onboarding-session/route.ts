/**
 * GET/POST /api/onboarding-session — load or update onboarding progress by token (SMS signup link).
 * No auth required. Used by /signup?token=.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const token = url.searchParams.get('token')
  if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 400 })
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  const { data, error } = await supabase
    .from('onboarding_sessions')
    .select('id, phone, payload')
    .eq('token', token)
    .is('merged_into_user_id', null)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Invalid or expired link' }, { status: 404 })
  return NextResponse.json({ phone: data.phone, payload: data.payload ?? {} })
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const token = typeof body.token === 'string' ? body.token : null
  const payload = body.payload
  if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 400 })
  if (payload === undefined) return NextResponse.json({ error: 'Missing payload' }, { status: 400 })
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  const { error } = await supabase
    .from('onboarding_sessions')
    .update({ payload: payload ?? {}, updated_at: new Date().toISOString() })
    .eq('token', token)
    .is('merged_into_user_id', null)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
