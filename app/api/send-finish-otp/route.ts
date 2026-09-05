import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendMessage } from '@/lib/sendblue'

export const dynamic = 'force-dynamic'

function generateOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000))
}

export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !serviceKey) return NextResponse.json({ error: 'Not configured' }, { status: 500 })

  const body = await request.json().catch(() => ({}))
  const token = typeof body.token === 'string' ? body.token.trim() : null
  if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 400 })

  const supabase = createClient(url, serviceKey)
  const { data: session, error: sessionErr } = await supabase
    .from('onboarding_sessions')
    .select('id, phone, payload')
    .eq('token', token)
    .is('merged_into_user_id', null)
    .maybeSingle()

  if (sessionErr) return NextResponse.json({ error: sessionErr.message }, { status: 500 })
  if (!session) return NextResponse.json({ error: 'Session not found or already used' }, { status: 404 })
  if (!session.phone) return NextResponse.json({ error: 'No phone on session' }, { status: 400 })

  // Rate limit: 30-second cooldown on resend
  const existing = (session.payload as Record<string, unknown>) ?? {}
  const prevIssuedAt = existing.otp_issued_at as string | undefined
  if (prevIssuedAt) {
    const elapsed = Date.now() - new Date(prevIssuedAt).getTime()
    if (elapsed < 30_000) {
      return NextResponse.json(
        { error: 'Please wait a moment before requesting another code.', cooldownMs: 30_000 - elapsed },
        { status: 429 }
      )
    }
  }

  const otp = generateOtp()
  const now = new Date().toISOString()
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString()

  await supabase
    .from('onboarding_sessions')
    .update({
      payload: { ...existing, otp_code: otp, otp_expires_at: expiresAt, otp_issued_at: now },
      updated_at: now,
    })
    .eq('id', session.id)

  await sendMessage(session.phone, `Your Fika verification code: ${otp}\n\nExpires in 10 minutes.`, {
    fromNumber: 'concierge',
  })

  const phoneLast4 = session.phone.slice(-4)
  return NextResponse.json({ ok: true, phoneLast4 })
}
