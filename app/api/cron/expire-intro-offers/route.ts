import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { expireStaleIntroOffers } from '@/lib/intro-expiry'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/** Clears sms_conversation_states stuck in match_offered past the 24h intro-offer window. Bearer CRON_SECRET optional. */
export async function GET(request: Request) {
  const auth = request.headers.get('Authorization')
  const secret = process.env.CRON_SECRET
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) {
    return NextResponse.json({ error: 'Server not configured' }, { status: 500 })
  }

  try {
    const supabase = createClient(url, key)
    const { deleted } = await expireStaleIntroOffers(supabase)
    return NextResponse.json({ ok: true, deleted })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Cron failed' },
      { status: 500 }
    )
  }
}
