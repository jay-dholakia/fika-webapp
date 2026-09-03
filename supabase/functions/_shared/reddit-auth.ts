// @ts-ignore Deno
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

declare const Deno: { env: { get(key: string): string | undefined } }

function getEnv(key: string): string {
  const v = Deno.env.get(key)
  if (!v) throw new Error(`Missing env: ${key}`)
  return v
}

function getUserAgent(): string {
  return Deno.env.get('REDDIT_USER_AGENT') ?? 'web:com.fika.growth-agent:v1.0'
}

export interface AppOnlyToken {
  access_token: string
  expires_at: number // ms
}

let _appToken: AppOnlyToken | null = null

/** Client-credentials grant — no user login required. Used by discover + scan functions. */
export async function getAppOnlyToken(): Promise<string> {
  if (_appToken && Date.now() < _appToken.expires_at - 60_000) return _appToken.access_token

  const clientId = getEnv('REDDIT_CLIENT_ID')
  const clientSecret = getEnv('REDDIT_CLIENT_SECRET')
  const basic = btoa(`${clientId}:${clientSecret}`)

  const res = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': getUserAgent(),
    },
    body: 'grant_type=client_credentials',
  })
  if (!res.ok) throw new Error(`Reddit app-only token failed: ${res.status} ${await res.text()}`)
  const data = await res.json() as { access_token: string; expires_in: number }
  _appToken = { access_token: data.access_token, expires_at: Date.now() + data.expires_in * 1000 }
  return _appToken.access_token
}

/** Refresh-token grant — uses the Vault-stored refresh token for the dedicated Fika Reddit account. */
export async function getUserAccessToken(): Promise<string> {
  const clientId = getEnv('REDDIT_CLIENT_ID')
  const clientSecret = getEnv('REDDIT_CLIENT_SECRET')

  // Read refresh token from Supabase Vault
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  )
  const { data, error } = await supabase
    .from('vault.decrypted_secrets')
    .select('decrypted_secret')
    .eq('name', 'reddit_refresh_token')
    .maybeSingle()
  if (error || !data?.decrypted_secret) throw new Error('reddit_refresh_token not found in Vault')
  const refreshToken = data.decrypted_secret as string

  const basic = btoa(`${clientId}:${clientSecret}`)
  const res = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': getUserAgent(),
    },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
  })
  if (!res.ok) throw new Error(`Reddit user token refresh failed: ${res.status} ${await res.text()}`)
  const tokenData = await res.json() as { access_token: string }

  // Update last_refreshed_at
  await supabase
    .from('reddit_oauth_account')
    .update({ last_refreshed_at: new Date().toISOString(), token_status: 'connected' })
    .neq('id', '00000000-0000-0000-0000-000000000000')

  return tokenData.access_token
}

export function redditHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'User-Agent': getUserAgent(),
    'Content-Type': 'application/json',
  }
}
