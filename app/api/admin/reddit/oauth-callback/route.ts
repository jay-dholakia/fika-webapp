import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { isAdminByUserId } from '@/lib/admin-markets'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/reddit/oauth-callback
 * One-time OAuth code exchange. Reddit redirects here after the user authorizes
 * the Fika Reddit app. Stores refresh_token in Supabase Vault and upserts
 * reddit_oauth_account.
 *
 * Manual step: visit Reddit's authorize URL first:
 * https://www.reddit.com/api/v1/authorize?client_id=CLIENT_ID&response_type=code
 *   &state=fika-reddit&redirect_uri=https://letsfika.app/api/admin/reddit/oauth-callback
 *   &duration=permanent&scope=identity,submit,read
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const error = searchParams.get('error')

  if (error || !code) {
    return new Response(
      `Reddit OAuth error: ${error ?? 'missing code'}`,
      { status: 400, headers: { 'Content-Type': 'text/plain' } }
    )
  }

  const supabaseAuth = await createServerSupabase()
  if (!supabaseAuth) {
    return new Response('Server not configured', { status: 500 })
  }

  let userId: string | null = null
  const { data: { session } } = await supabaseAuth.auth.getSession()
  if (session?.user?.id) userId = session.user.id
  if (!userId) {
    return new Response('Must be signed in as admin to complete OAuth', { status: 401 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) return new Response('Server not configured', { status: 500 })

  const supabase = createClient(url, key)
  if (!await isAdminByUserId(supabase, userId)) {
    return new Response('Admin role required', { status: 403 })
  }

  // Exchange code for tokens
  const clientId = process.env.REDDIT_CLIENT_ID?.trim()
  const clientSecret = process.env.REDDIT_CLIENT_SECRET?.trim()
  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://letsfika.app'}/api/admin/reddit/oauth-callback`

  if (!clientId || !clientSecret) {
    return new Response('REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET not set', { status: 500 })
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const tokenRes = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': process.env.REDDIT_USER_AGENT ?? 'web:com.fika.growth-agent:v1.0',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }).toString(),
  })

  if (!tokenRes.ok) {
    const body = await tokenRes.text()
    return new Response(`Reddit token exchange failed: ${body}`, { status: 502 })
  }

  const tokens = await tokenRes.json() as {
    access_token: string
    refresh_token?: string
    scope?: string
    token_type?: string
  }

  if (!tokens.refresh_token) {
    return new Response('Reddit did not return a refresh_token — make sure duration=permanent', { status: 502 })
  }

  // Fetch Reddit username
  let redditUsername = 'unknown'
  try {
    const meRes = await fetch('https://oauth.reddit.com/api/v1/me', {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        'User-Agent': process.env.REDDIT_USER_AGENT ?? 'web:com.fika.growth-agent:v1.0',
      },
    })
    if (meRes.ok) {
      const me = await meRes.json() as { name?: string }
      redditUsername = me.name ?? 'unknown'
    }
  } catch { /* ignore */ }

  // Upsert reddit_oauth_account
  const scopes = tokens.scope?.split(' ') ?? []
  await supabase.from('reddit_oauth_account').upsert({
    reddit_username: redditUsername,
    scopes,
    connected_at: new Date().toISOString(),
    token_status: 'connected',
    last_refreshed_at: new Date().toISOString(),
  }, { onConflict: 'reddit_username' })

  // Display refresh token for manual Vault entry (one-time action — safer than automated write)
  return new Response(
    [
      `Reddit OAuth complete! Connected as u/${redditUsername}.`,
      ``,
      `NEXT STEP — save this refresh token in Supabase Vault:`,
      `  Dashboard → Vault → New Secret`,
      `  Name: reddit_refresh_token`,
      `  Value: ${tokens.refresh_token}`,
      ``,
      `Then set Edge Function secrets: REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USER_AGENT`,
      ``,
      `You can close this tab after saving the token.`,
    ].join('\n'),
    { status: 200, headers: { 'Content-Type': 'text/plain' } }
  )
}
