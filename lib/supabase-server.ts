/**
 * Server-side Supabase client that reads session from cookies (for API routes).
 * Use this when you need to get the current user in a Route Handler.
 */

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createServerSupabase() {
  const cookieStore = await cookies()
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
  if (!url || !anonKey) return null
  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet: { name: string; value: string; options: Record<string, unknown> }[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options as Parameters<typeof cookieStore.set>[2])
          )
        } catch {
          // ignore
        }
      },
    },
  })
}

/**
 * Get current user ID in a Route Handler: from cookies (getSession) or from Authorization Bearer token.
 * Use this so API routes work when the client sends the token in headers (e.g. session in localStorage only).
 */
export async function getUserIdFromRequest(
  request: Request,
  supabaseAuth: Awaited<ReturnType<typeof createServerSupabase>>
): Promise<string | null> {
  if (!supabaseAuth) return null
  const { data: { session } } = await supabaseAuth.auth.getSession()
  if (session?.user?.id) return session.user.id
  const authHeader = request.headers.get('Authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7)
    const { data: { user } } = await supabaseAuth.auth.getUser(token)
    return user?.id ?? null
  }
  return null
}
