// Weekly opt-in blast disabled: admin-only matching (admin simulation + Trigger SMS). Restore prior logic from git if needed.

// @ts-ignore Deno
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

serve(async () => {
  return new Response(JSON.stringify({ ok: true, skipped: true, reason: 'admin_only_matching' }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
