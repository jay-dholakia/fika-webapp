import { NextResponse } from 'next/server'
import { runCancelRetryCron } from '@/lib/sms-cron'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Optional manual/backup: same logic as Supabase Edge `sms-cancel-retry-timeout` (pg_cron hourly).
 * Production schedule: migration `*_sms_cancel_retry_timeout_cron.sql` → net.http_post to that function.
 * Call with Authorization: Bearer CRON_SECRET when hitting this route directly.
 */
export async function GET(request: Request) {
  const auth = request.headers.get('Authorization')
  const secret = process.env.CRON_SECRET
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const { nudged, finalized, error } = await runCancelRetryCron()
    if (error) return NextResponse.json({ error }, { status: 500 })
    return NextResponse.json({ ok: true, nudged, finalized })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Cron failed' },
      { status: 500 }
    )
  }
}
