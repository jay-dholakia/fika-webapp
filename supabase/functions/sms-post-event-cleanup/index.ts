// Fires every 30 min (pg_cron). Resets users stuck in global 'reveal_sent' state back to
// 'global_ready' once their group event ended >2h ago. Also deletes stale per-match
// 'reveal_sent' rows older than 7 days (data hygiene).

declare const Deno: { env: { get(key: string): string | undefined } }
// @ts-ignore Deno
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
// @ts-ignore Deno
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (_req: Request) => {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

    // Find group events that ended >2h ago and had reveals sent
    const { data: pastEvents } = await supabase
      .from('weekly_fika_events')
      .select('id')
      .lt('event_starts_at', twoHoursAgo)
      .not('reveals_sent_at', 'is', null)

    let resetCount = 0

    for (const event of (pastEvents ?? []) as Array<{ id: string }>) {
      // Find global reveal_sent rows whose payload references this event
      const { data: stuckRows } = await supabase
        .from('sms_conversation_states')
        .select('user_id')
        .eq('state', 'reveal_sent')
        .is('match_id', null)
        .eq('payload->>event_id', event.id)

      for (const row of (stuckRows ?? []) as Array<{ user_id: string }>) {
        await supabase.rpc('upsert_global_sms_conversation_state', {
          p_user_id: row.user_id,
          p_state: 'global_ready',
          p_payload: {},
          p_last_sendblue_message_handle: null,
        })
        resetCount++
      }
    }

    // Delete stale per-match reveal_sent rows (meeting already happened, data hygiene)
    const { count: deletedCount } = await supabase
      .from('sms_conversation_states')
      .delete({ count: 'exact' })
      .eq('state', 'reveal_sent')
      .not('match_id', 'is', null)
      .lt('updated_at', sevenDaysAgo)

    return new Response(
      JSON.stringify({ ok: true, reset: resetCount, deleted: deletedCount ?? 0 }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 })
  }
})
