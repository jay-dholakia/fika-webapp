// Renews the Google Calendar push notification watch channel.
// Invoked by pg_cron twice a week (Mon + Thu at 17:00 UTC).
// Max channel TTL is 7 days — renewing every 3-4 days keeps it alive indefinitely.

declare const Deno: { env: { get(key: string): string | undefined } }

// @ts-ignore Deno
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

async function getAccessToken(): Promise<string | null> {
  const refreshToken = Deno.env.get('GCAL_REFRESH_TOKEN')
  const clientId = Deno.env.get('GCAL_CLIENT_ID')
  const clientSecret = Deno.env.get('GCAL_CLIENT_SECRET')
  if (!refreshToken || !clientId || !clientSecret) {
    console.error('[gcal-channel-renew] missing env vars')
    return null
  }
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
  if (!res.ok) {
    console.error('[gcal-channel-renew] token refresh failed', await res.text())
    return null
  }
  const data = await res.json() as { access_token?: string }
  return data.access_token ?? null
}

serve(async (_req: Request) => {
  const accessToken = await getAccessToken()
  if (!accessToken) {
    return new Response(JSON.stringify({ ok: false, error: 'token refresh failed' }), { status: 500 })
  }

  const webhookToken = Deno.env.get('GCAL_WEBHOOK_TOKEN') ?? ''
  const webhookUrl = Deno.env.get('GCAL_WEBHOOK_URL') ?? 'https://letsfika.app/api/google-calendar-webhook'
  const channelId = crypto.randomUUID()

  const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events/watch', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      id: channelId,
      type: 'web_hook',
      address: webhookUrl,
      token: webhookToken,
    }),
  })

  const data = await res.json()
  if (!res.ok) {
    console.error('[gcal-channel-renew] watch registration failed', JSON.stringify(data))
    return new Response(JSON.stringify({ ok: false, error: data }), { status: 500 })
  }

  const expiration = data.expiration
    ? new Date(Number(data.expiration)).toISOString()
    : 'unknown'

  console.log('[gcal-channel-renew] channel renewed', {
    channelId: data.id,
    resourceId: data.resourceId,
    expiration,
  })

  return new Response(JSON.stringify({ ok: true, channelId: data.id, resourceId: data.resourceId, expiration }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
