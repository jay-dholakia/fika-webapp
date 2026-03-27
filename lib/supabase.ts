import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

let client: SupabaseClient | null = null

function getSupabase(): SupabaseClient | null {
  if (client) return client
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return null
  client = createBrowserClient(url, key, {
    auth: {
      detectSessionInUrl: true,
      flowType: 'pkce',
    },
  })
  return client
}

export { getSupabase }
