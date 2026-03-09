/**
 * Admin markets: read active slugs (for cron + app), used by admin API.
 * Markets table is populated by trigger when profile.market is set.
 * Admin access is via profiles.role = 'admin' (not env).
 */

import type { SupabaseClient } from '@supabase/supabase-js'

/** Slugs of markets where Monday opt-in SMS and match run are enabled. */
export async function getActiveMarketSlugs(supabase: SupabaseClient): Promise<string[]> {
  const { data, error } = await supabase
    .from('markets')
    .select('slug')
    .eq('active', true)
  if (error) return []
  return (data ?? []).map((r) => r.slug).filter(Boolean)
}

/** Check if the user is an admin by profile.role (use service-role client). */
export async function isAdminByUserId(supabase: SupabaseClient, userId: string): Promise<boolean> {
  if (!userId?.trim()) return false
  const { data, error } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId.trim())
    .maybeSingle()
  if (error || !data) return false
  return (data as { role?: string }).role === 'admin'
}
