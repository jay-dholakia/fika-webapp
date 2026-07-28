/**
 * POST /api/collect-phone — for Mac iMessage users who signed up via Apple ID email.
 * Updates onboarding_sessions.phone to their real mobile number and sends an SMS with the signup link.
 * Body: { token, phone }. No auth — the session token is the only gate.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { normalizeIncomingPhone } from '@/lib/sms-agent'
import { sendConcierge } from '@/lib/sendblue'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const token = typeof body.token === 'string' ? body.token.trim() : null
  const rawPhone = typeof body.phone === 'string' ? body.phone.trim() : null

  if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 400 })
  if (!rawPhone) return NextResponse.json({ error: 'Please enter your mobile number.' }, { status: 400 })

  const normalized = normalizeIncomingPhone(rawPhone)

  if (normalized.includes('@')) {
    return NextResponse.json({ error: 'Please enter a phone number, not an email address.' }, { status: 400 })
  }
  const digits = normalized.replace(/\D/g, '')
  if (digits.length < 10 || digits.length > 15) {
    return NextResponse.json({ error: 'Please enter a valid US mobile number.' }, { status: 400 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) return NextResponse.json({ error: 'Not configured' }, { status: 500 })

  const supabase = createClient(url, serviceKey)

  const { data: session, error: sessionError } = await supabase
    .from('onboarding_sessions')
    .select('id, phone, token')
    .eq('token', token)
    .is('merged_into_user_id', null)
    .maybeSingle()

  if (sessionError) return NextResponse.json({ error: sessionError.message }, { status: 500 })
  if (!session) return NextResponse.json({ error: 'Invalid or expired link' }, { status: 404 })
  if (!session.phone?.includes('@')) {
    return NextResponse.json({ error: 'This endpoint is only for Mac iMessage sessions.' }, { status: 400 })
  }

  const { error: updateError } = await supabase
    .from('onboarding_sessions')
    .update({ phone: normalized, updated_at: new Date().toISOString() })
    .eq('id', session.id)

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

  const appBase = (process.env.APP_CANONICAL_URL ?? '').trim().replace(/\/$/, '') || 'https://letsfika.vercel.app'
  const link = `${appBase}/signup?token=${token}`
  await sendConcierge(normalized, `Here's your Fika signup link — tap to complete your profile: ${link}`)

  return NextResponse.json({ ok: true })
}
