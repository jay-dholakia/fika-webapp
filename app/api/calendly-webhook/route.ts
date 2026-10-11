import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createHmac, timingSafeEqual } from 'crypto'
import { sendMessage } from '@/lib/sendblue'
import { insertMessageLedger } from '@/lib/message-ledger'
import { getOrCreateSmsState, SMS_STATES } from '@/lib/sms-agent'

function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  if (digits.length > 7) return `+${digits}`
  return null
}

function verifyCalendlySignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!header) return false
  // Format: t=<timestamp>,v1=<hmac_hex_or_base64>
  const parts: Record<string, string> = {}
  for (const seg of header.split(',')) {
    const idx = seg.indexOf('=')
    if (idx > 0) parts[seg.slice(0, idx)] = seg.slice(idx + 1)
  }
  const { t, v1 } = parts
  if (!t || !v1) return false
  const message = `${t}.${rawBody}`
  const hmac = createHmac('sha256', secret).update(message, 'utf8')
  const expectedHex = hmac.digest('hex')
  // Calendly sends base64-encoded signature
  const expectedB64 = Buffer.from(expectedHex, 'hex').toString('base64')
  try {
    const receivedBuf = Buffer.from(v1, 'base64')
    const expectedBuf = Buffer.from(expectedB64, 'base64')
    if (receivedBuf.length !== expectedBuf.length) return false
    return timingSafeEqual(receivedBuf, expectedBuf)
  } catch {
    return false
  }
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

export async function POST(req: NextRequest) {
  const rawBody = await req.text()

  const signingKey = process.env.CALENDLY_SIGNING_KEY
  if (signingKey) {
    const sig = req.headers.get('Calendly-Webhook-Signature')
    if (!verifyCalendlySignature(rawBody, sig, signingKey)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }
  }

  let body: Record<string, unknown>
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (body.event !== 'invitee.created') {
    return NextResponse.json({ ok: true })
  }

  const payload = body.payload as Record<string, unknown>
  const qna = Array.isArray(payload.questions_and_answers)
    ? (payload.questions_and_answers as Array<{ question: string; answer: string }>)
    : []

  const phoneRaw = qna.find(q => q.question?.toLowerCase().includes('phone'))?.answer ?? ''
  const phone = normalizePhone(phoneRaw)
  if (!phone) return NextResponse.json({ ok: true })

  const scheduledEvent = payload.scheduled_event as Record<string, unknown> | null
  const startTimeRaw = scheduledEvent?.start_time as string | null

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, first_name')
    .eq('phone', phone)
    .maybeSingle()

  if (!profile) return NextResponse.json({ ok: true })

  const firstName = profile.first_name ? `, ${profile.first_name}` : ''
  const timeStr = startTimeRaw ? formatStartTime(startTimeRaw) : ''
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

  return NextResponse.json({ ok: true })
}
