/**
 * POST /api/send-phone-otp — Login via phone. Looks up an existing profile by phone,
 * generates a Supabase magic link, and sends it via SendBlue SMS.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendMessage } from '@/lib/sendblue'

export const dynamic = 'force-dynamic'

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return `+${digits}`
}

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  const appBase = (process.env.APP_CANONICAL_URL ?? '').trim().replace(/\/$/, '') || 'https://letsfika.vercel.app'
  if (!supabaseUrl || !serviceKey) return NextResponse.json({ error: 'Not configured' }, { status: 500 })

  const body = await request.json().catch(() => ({}))
  const rawPhone = typeof body.phone === 'string' ? body.phone.trim() : ''
  const next = typeof body.next === 'string' ? body.next.trim() : '/app'
  if (!rawPhone) return NextResponse.json({ error: 'Phone number required' }, { status: 400 })

  const phone = normalizePhone(rawPhone)
  const supabase = createClient(supabaseUrl, serviceKey)

  // Look up user by phone in profiles
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('phone', phone)
    .maybeSingle()

  if (!profile?.id) {
    return NextResponse.json(
      { error: "We don't have an account with that number. Text Fika at +13102102404 to sign up." },
      { status: 404 }
    )
  }

  const { data: { user }, error: userErr } = await supabase.auth.admin.getUserById(profile.id)
  if (userErr || !user?.email) {
    return NextResponse.json({ error: 'Could not find account details.' }, { status: 500 })
  }

  const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email: user.email,
    options: {
      redirectTo: `${appBase}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  })

  if (linkErr || !linkData?.properties?.action_link) {
    return NextResponse.json({ error: 'Could not generate sign-in link. Try again.' }, { status: 500 })
  }

  await sendMessage(
    phone,
    `Your Fika sign-in link:\n${linkData.properties.action_link}\n\nTap to sign in — expires in 1 hour.`,
    { fromNumber: 'concierge' }
  )

  return NextResponse.json({ ok: true, phoneLast4: phone.slice(-4) })
}
