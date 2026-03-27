import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

function safeNext(raw: string | null): string {
  if (!raw) return '/app/how-it-works'
  return raw.startsWith('/') ? raw : '/app/how-it-works'
}

function redirectToCallback(requestUrl: URL, params: { nextPath: string; smsToken: string | null; authError?: string }) {
  const out = new URL('/auth/callback', requestUrl.origin)
  out.searchParams.set('next', params.nextPath)
  if (params.smsToken) out.searchParams.set('sms_token', params.smsToken)
  if (params.authError) out.searchParams.set('auth_error', params.authError)
  return NextResponse.redirect(out)
}

/** Server-side OAuth code exchange to avoid client PKCE storage races on mobile browsers. */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const nextPath = safeNext(url.searchParams.get('next'))
  const smsToken = url.searchParams.get('sms_token')
  const providerErr = url.searchParams.get('error_description') || url.searchParams.get('error')

  if (providerErr) {
    return redirectToCallback(url, { nextPath, smsToken, authError: providerErr })
  }

  if (!code) {
    return redirectToCallback(url, { nextPath, smsToken, authError: 'Missing OAuth code.' })
  }

  const supabase = await createServerSupabase()
  if (!supabase) {
    return redirectToCallback(url, { nextPath, smsToken, authError: 'Auth is not configured.' })
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) {
    return redirectToCallback(url, { nextPath, smsToken, authError: error.message || 'Could not complete sign-in.' })
  }

  return redirectToCallback(url, { nextPath, smsToken })
}
