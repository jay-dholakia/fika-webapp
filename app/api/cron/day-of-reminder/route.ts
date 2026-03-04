import { NextResponse } from 'next/server'
import { runDayOfReminder } from '@/lib/sms-cron'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Vercel cron (e.g. 9am daily): send day-of Fika reminder to both users. */
export async function GET(request: Request) {
  const auth = request.headers.get('Authorization')
  const secret = process.env.CRON_SECRET
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const { sent, error } = await runDayOfReminder()
    if (error) return NextResponse.json({ error }, { status: 500 })
    return NextResponse.json({ ok: true, sent })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Cron failed' },
      { status: 500 }
    )
  }
}
