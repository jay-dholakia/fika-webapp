import { NextResponse } from 'next/server'
import { runMatchDelivery } from '@/lib/sms-cron'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/** Vercel cron or manual: send match intro SMS for new match_candidates this week. */
export async function GET(request: Request) {
  const auth = request.headers.get('Authorization')
  const secret = process.env.CRON_SECRET
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const { sent, error } = await runMatchDelivery()
    if (error) return NextResponse.json({ error }, { status: 500 })
    return NextResponse.json({ ok: true, sent })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Cron failed' },
      { status: 500 }
    )
  }
}
