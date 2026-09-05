import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { mergeOnboardingSession } from '@/lib/merge-onboarding-session'

export const dynamic = 'force-dynamic'

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return raw // already e.164 or unrecognized
}

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  const appBase = (process.env.APP_CANONICAL_URL ?? '').trim().replace(/\/$/, '') || 'https://letsfika.vercel.app'
  if (!supabaseUrl || !serviceKey) return NextResponse.json({ error: 'Not configured' }, { status: 500 })

  const body = await request.json().catch(() => ({}))
  const token = typeof body.token === 'string' ? body.token.trim() : null
  const code = typeof body.code === 'string' ? body.code.trim() : null
  if (!token || !code) return NextResponse.json({ error: 'Missing token or code' }, { status: 400 })

  const supabase = createClient(supabaseUrl, serviceKey)

  const { data: session, error: sessionErr } = await supabase
    .from('onboarding_sessions')
    .select('id, phone, payload')
    .eq('token', token)
    .is('merged_into_user_id', null)
    .maybeSingle()

  if (sessionErr) return NextResponse.json({ error: sessionErr.message }, { status: 500 })
  if (!session) return NextResponse.json({ error: 'Session not found or already used' }, { status: 404 })

  const payload = (session.payload as Record<string, unknown>) ?? {}
  const storedCode = payload.otp_code as string | undefined
  const expiresAt = payload.otp_expires_at as string | undefined

  if (!storedCode) return NextResponse.json({ error: 'No code was sent — request a new one.' }, { status: 400 })
  if (code !== storedCode) return NextResponse.json({ error: 'Incorrect code. Try again.' }, { status: 400 })
  if (!expiresAt || new Date(expiresAt).getTime() < Date.now()) {
    return NextResponse.json({ error: 'Code expired — request a new one.' }, { status: 400 })
  }

  // Clear OTP fields to prevent replay
  const { otp_code: _otp, otp_expires_at: _exp, otp_issued_at: _issued, ...cleanPayload } = payload as Record<string, unknown> & { otp_code?: unknown; otp_expires_at?: unknown; otp_issued_at?: unknown }
  await supabase
    .from('onboarding_sessions')
    .update({ payload: cleanPayload, updated_at: new Date().toISOString() })
    .eq('id', session.id)

  // Create or find auth.users entry
  const phone = normalizePhone(session.phone ?? '')
  const derivedEmail = `${crypto.randomUUID()}@phone.letsfika.app`

  let userId: string
  let userEmail: string = derivedEmail

  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    phone,
    phone_confirm: true,
    email: derivedEmail,
    email_confirm: true,
  })

  if (!createErr && created?.user?.id) {
    userId = created.user.id
  } else {
    // Phone already registered — find via profiles table
    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('phone', phone)
      .maybeSingle()
    if (!profile?.id) {
      return NextResponse.json({ error: 'Could not create account. Please try again.' }, { status: 500 })
    }
    userId = profile.id
    // Get their actual email from auth.users so magic link works
    const { data: { user: existingUser } } = await supabase.auth.admin.getUserById(userId)
    userEmail = existingUser?.email ?? derivedEmail
  }

  const openaiKey = process.env.EXPO_PUBLIC_OPENAI_API_KEY || process.env.OPENAI_API_KEY
  const mergeResult = await mergeOnboardingSession(supabase, userId, token, openaiKey ?? undefined)
  if (!mergeResult.ok) {
    return NextResponse.json({ error: mergeResult.error }, { status: 500 })
  }

  const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email: userEmail,
    options: {
      redirectTo: `${appBase}/auth/callback?next=${encodeURIComponent('/app/how-it-works')}`,
    },
  })

  if (linkErr || !linkData?.properties?.action_link) {
    // Merge succeeded — fall back gracefully with no redirect
    return NextResponse.json({ ok: true, magic_link: null })
  }

  return NextResponse.json({ ok: true, magic_link: linkData.properties.action_link })
}
