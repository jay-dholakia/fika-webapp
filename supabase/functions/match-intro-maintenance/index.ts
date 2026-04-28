// Intro-offer cleanup + mutual match opt-in expiry (pg_cron hourly → this Edge Function).
// Secrets: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (Dashboard → Edge Functions).

declare const Deno: { env: { get(key: string): string | undefined } }
// @ts-ignore Deno
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
// @ts-ignore Deno
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { expireMissedMatchOptInsEdge, expireStaleIntroOffersEdge } from '../_shared/intro-expiry-edge.ts'

serve(async () => {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )
    const intro = await expireStaleIntroOffersEdge(supabase)
    const optIns = await expireMissedMatchOptInsEdge(supabase)
    return new Response(
      JSON.stringify({
        ok: true,
        intro_offers_deleted: intro.deleted,
        match_opt_ins_expired: optIns.expired,
      }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 })
  }
})
