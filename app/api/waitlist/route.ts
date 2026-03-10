import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { geocodeZip } from '@/lib/geocode'
import { getMarketFromCity } from '@/lib/markets'

/**
 * POST /api/waitlist — Join waitlist with email + zip.
 * Geocodes zip to city, derives market (same as onboarding), inserts with service role.
 */
export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !serviceKey) {
    return NextResponse.json({ error: 'Server configuration error.' }, { status: 500 })
  }

  let body: { email?: string; zip_code?: string; marketing_consent?: boolean }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const emailTrim = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!emailTrim) {
    return NextResponse.json({ error: 'Enter your email address.' }, { status: 400 })
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrim)) {
    return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 })
  }
  if (body.marketing_consent !== true) {
    return NextResponse.json({ error: 'Please agree to receive email from us.' }, { status: 400 })
  }

  const zipRaw = typeof body.zip_code === 'string' ? body.zip_code.trim() : ''
  const zipNormalized = zipRaw.replace(/\D/g, '')
  if (zipNormalized.length !== 5 && zipNormalized.length !== 9) {
    return NextResponse.json({ error: 'Enter a valid US zip code (5 or 9 digits).' }, { status: 400 })
  }

  const geocoded = await geocodeZip(zipNormalized)
  const city = geocoded?.city ?? null
  const market = city ? getMarketFromCity(city)?.slug ?? null : null

  const supabase = createClient(url, serviceKey)
  const { error } = await supabase.from('waitlist').insert({
    email: emailTrim,
    zip_code: zipNormalized,
    city,
    market,
    marketing_consent_at: new Date().toISOString(),
  })

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'This email is already on the list.' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, message: "You're on the list. We'll be in touch." })
}
