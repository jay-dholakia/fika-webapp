import { createClient, SupabaseClient } from '@supabase/supabase-js'

let client: SupabaseClient | null = null

function getSupabase(): SupabaseClient | null {
  if (client) return client
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return null
  client = createClient(url, key, {
    auth: {
      detectSessionInUrl: true,
      flowType: 'implicit',
    },
  })
  return client
}

export { getSupabase }
