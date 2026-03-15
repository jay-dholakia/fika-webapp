import { NextResponse } from 'next/server'
import { setConciergeContactCard } from '@/lib/sendblue'

export const dynamic = 'force-dynamic'

/**
 * One-time setup: set the Concierge number's contact card to "Fika ☕" in Sendblue.
 * Recipients will see this name/photo when they get messages from the concierge.
 * Run once after deploy (or when you change the logo).
 *
 * Call with: GET or POST, header Authorization: Bearer <CRON_SECRET>
 * Requires env: SENDBLUE_* (API + Concierge number). Logo defaults to APP_CANONICAL_URL/logo-contact.png.
 */
export async function GET(request: Request) {
  const auth = request.headers.get('Authorization')
  const secret = process.env.CRON_SECRET
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const base = (process.env.APP_CANONICAL_URL ?? '').trim().replace(/\/$/, '') || 'https://letsfika.vercel.app'
  const photoUrl = (process.env.SENDBLUE_CONCIERGE_CONTACT_PHOTO_URL ?? `${base}/logo-contact.png`).trim()
  if (!photoUrl) {
    return NextResponse.json(
      { error: 'SENDBLUE_CONCIERGE_CONTACT_PHOTO_URL is not set (public JPEG/PNG URL for the contact card)' },
      { status: 400 }
    )
  }
  try {
    const result = await setConciergeContactCard(photoUrl)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 500 })
    }
    return NextResponse.json({ ok: true, message: 'Concierge contact card set to Fika ☕' })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Request failed' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  return GET(request)
}
