// Automated replenishment disabled: create matches via admin `/api/admin/match-sim` + Trigger SMS → `sms-match-delivery`.
// Prior full implementation is in git history if automated matching returns.

// @ts-ignore Deno
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  return new Response(JSON.stringify({ ok: true, skipped: true, reason: 'admin_only_matching' }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
