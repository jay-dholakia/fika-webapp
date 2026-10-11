/**
 * Google Calendar push notification handler.
 *
 * Setup (one-time):
 *   POST https://www.googleapis.com/calendar/v3/calendars/primary/events/watch
 *   Body: { id: "<uuid>", type: "web_hook", address: "https://letsfika.app/api/google-calendar-webhook", token: "<GCAL_WEBHOOK_TOKEN>" }
 *   Auth: OAuth2 Bearer token for Jay's Google account
 *
 * The channel expires (max 7 days). A pg_cron job renews it weekly.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendMessage } from '@/lib/sendblue'
import { insertMessageLedger } from '@/lib/message-ledger'
import { getOrCreateSmsState, SMS_STATES } from '@/lib/sms-agent'

function normalizePhone(raw: string): string | null {
  if (!raw) return null
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  if (digits.length > 7) return `+${digits}`
  return null
}

function formatStartTime(isoString: string): string {
  try {
    const d = new Date(isoString)
    return d.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'America/Los_Angeles',
    })
  } catch {
    return ''
  }
}

/** Extract phone number from Google Calendar event description.
 *  Google appointment scheduling writes answers as "Question\nAnswer\n" blocks. */
function extractPhoneFromDescription(description: string | null | undefined): string | null {
  if (!description) return null
  // Look for a line after a phone-related label
  const lines = description.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    if (/phone/i.test(lines[i])) {
      const answer = lines[i + 1]?.trim()
      if (answer) return normalizePhone(answer)
    }
  }
  // Fallback: find any line that looks like a phone number
  for (const line of lines) {
    const digits = line.replace(/\D/g, '')
    if (digits.length >= 10 && digits.length <= 11) return normalizePhone(line)
  }
  return null
}

async function fetchRecentEvents(accessToken: string): Promise<Array<{
  id: string
  summary?: string
  description?: string
  start?: { dateTime?: string; date?: string }
  created?: string
  attendees?: Array<{ email: string }>
}>> {
  // Fetch events updated in the last 2 minutes to catch new bookings
  const updatedMin = new Date(Date.now() - 2 * 60 * 1000).toISOString()
  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?updatedMin=${encodeURIComponent(updatedMin)}&orderBy=updated&singleEvents=true`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) return []
  const data = await res.json() as { items?: unknown[] }
  return (data.items ?? []) as ReturnType<typeof fetchRecentEvents> extends Promise<infer T> ? T : never
}

async function getAccessToken(): Promise<string | null> {
  const refreshToken = process.env.GCAL_REFRESH_TOKEN
  const clientId = process.env.GCAL_CLIENT_ID
  const clientSecret = process.env.GCAL_CLIENT_SECRET
  if (!refreshToken || !clientId || !clientSecret) return null

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  })
  if (!res.ok) return null
  const data = await res.json() as { access_token?: string }
  return data.access_token ?? null
}

export async function POST(req: NextRequest) {
  // Verify channel token
  const channelToken = req.headers.get('X-Goog-Channel-Token')
  const expectedToken = process.env.GCAL_WEBHOOK_TOKEN
  if (expectedToken && channelToken !== expectedToken) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
  }

  // Google sends "sync" on channel creation — acknowledge and return
  const resourceState = req.headers.get('X-Goog-Resource-State')
  if (resourceState === 'sync') {
    return NextResponse.json({ ok: true })
  }

  // Only care about new/updated events
  if (resourceState !== 'exists') {
    return NextResponse.json({ ok: true })
  }

  const accessToken = await getAccessToken()
  if (!accessToken) {
    console.error('[gcal-webhook] no access token — set GCAL_REFRESH_TOKEN, GCAL_CLIENT_ID, GCAL_CLIENT_SECRET')
    return NextResponse.json({ ok: true })
  }

  const events = await fetchRecentEvents(accessToken)

  // Only process events created in the last 2 minutes (new bookings, not updates)
  const cutoff = Date.now() - 2 * 60 * 1000
  const newBookings = events.filter(e => e.created && new Date(e.created).getTime() > cutoff)
  if (newBookings.length === 0) return NextResponse.json({ ok: true })

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  for (const event of newBookings) {
    const phone = extractPhoneFromDescription(event.description)
    if (!phone) continue

    const { data: profile } = await supabase
      .from('profiles')
      .select('id, first_name')
      .eq('phone', phone)
      .maybeSingle()

    if (!profile) continue

    const startTime = event.start?.dateTime ?? event.start?.date ?? null
    const firstName = profile.first_name ? `, ${profile.first_name}` : ''
    const timeStr = startTime ? formatStartTime(startTime) : ''
    const confirmMsg = timeStr
      ? `Confirmed${firstName} — see you ${timeStr} ☕`
      : `Confirmed${firstName} — see you then ☕`

    const result = await sendMessage(phone, confirmMsg, { fromNumber: 'concierge' }).catch(() => null)
    await insertMessageLedger(supabase, {
      user_id: profile.id,
      direction: 'outbound',
      peer_phone: phone,
      content_snippet: confirmMsg,
      context: 'call_scheduled_confirmation',
      message_handle: result?.message_handle ?? null,
    })

    await getOrCreateSmsState(supabase, profile.id, SMS_STATES.CALL_SCHEDULED, {})
  }

  return NextResponse.json({ ok: true })
}
