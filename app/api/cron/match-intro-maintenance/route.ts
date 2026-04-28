import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { expireMissedMatchOptIns, expireStaleIntroOffers } from '@/lib/intro-expiry'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * Runs intro-offer cleanup + mutual match opt-in expiry in one invocation (single Vercel cron slot).
 * Individual routes `/api/cron/expire-intro-offers` and `/api/cron/expire-match-opt-ins` remain for manual use.
 * Bearer CRON_SECRET optional (same as other cron routes).
 */
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
    const introOffers = await expireStaleIntroOffers(supabase)
    const matchOptIns = await expireMissedMatchOptIns(supabase)
    return NextResponse.json({
      ok: true,
      intro_offers_deleted: introOffers.deleted,
      match_opt_ins_expired: matchOptIns.expired,
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Cron failed' },
      { status: 500 }
    )
  }
}
