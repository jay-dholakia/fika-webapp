import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/** Disabled: match delivery is manual-only from admin. */
export async function GET(request: Request) {
  const auth = request.headers.get('Authorization')
  const secret = process.env.CRON_SECRET
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return NextResponse.json({ ok: true, disabled: true, reason: 'manual_admin_only' })
}
