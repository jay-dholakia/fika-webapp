// Fires every 30 min (pg_cron). Resets users stuck in global 'social_reveal_sent' state back to
// 'global_ready' once their group event ended >2h ago. Also deletes stale per-match
// '1v1_reminder_sent' rows older than 7 days (data hygiene). Also cleans up stale 1v1 flows
// (1v1_awaiting_availability / 1v1_proposed) that go silent for >24h.

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
        .eq('state', 'social_reveal_sent')
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
      .eq('state', '1v1_reminder_sent')
      .not('match_id', 'is', null)
      .lt('updated_at', sevenDaysAgo)

    // --- 1v1 stale flow cleanup (24h) ---
    // Finds matches where any per-match row has been stuck in an active scheduling state
    // for >24h, then sends a rain-check message and resets both users.
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const STALE_STATES = ['1v1_offered', '1v1_accepted', '1v1_awaiting_availability', '1v1_proposed']

    const { data: staleRows } = await supabase
      .from('sms_conversation_states')
      .select('user_id, match_id, state')
      .not('match_id', 'is', null)
      .in('state', STALE_STATES)
      .lt('updated_at', twentyFourHoursAgo)

    // Group by match_id — only process each match once
    const staleMatchIds = [...new Set((staleRows ?? []).map((r: { match_id: string }) => r.match_id))]
    let staleCount = 0

    const apiKeyId = Deno.env.get('SENDBLUE_API_KEY_ID')
    const apiSecret = Deno.env.get('SENDBLUE_API_SECRET_KEY')

    for (const matchId of staleMatchIds) {
      // Load all per-match rows and both user profiles for this match
      const { data: matchRows } = await supabase
        .from('sms_conversation_states')
        .select('user_id, state')
        .eq('match_id', matchId)
        .in('state', STALE_STATES)

      if (!matchRows?.length) continue

      const userIds = matchRows.map((r: { user_id: string }) => r.user_id)
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, first_name, phone')
        .in('id', userIds)

      type Profile = { id: string; first_name: string | null; phone: string | null }
      const profMap: Record<string, Profile> = {}
      for (const p of (profiles ?? []) as Profile[]) profMap[p.id] = p

      // Determine tone: if anyone got past match_offered, both said Yes — use rain-check tone
      const anyEngaged = matchRows.some((r: { state: string }) => r.state !== '1v1_offered')

      // Mark match stalled/cancelled and clean up state rows
      await supabase
        .from('match_candidates')
        .update({ status: anyEngaged ? 'scheduling_stalled' : 'cancelled' })
        .eq('id', matchId)

      for (const uid of userIds) {
        await supabase.from('sms_conversation_states').delete().eq('user_id', uid).eq('match_id', matchId)
        await supabase.rpc('upsert_global_sms_conversation_state', {
          p_user_id: uid,
          p_state: 'global_ready',
          p_payload: {},
          p_last_sendblue_message_handle: null,
        })
      }

      // Send message to each user if SMS is enabled and we have credentials
      if (apiKeyId && apiSecret && Deno.env.get('SMS_OUTBOUND_DISABLED') !== 'true') {
        for (const uid of userIds) {
          const prof = profMap[uid]
          const phone = prof?.phone?.trim()
          if (!phone) continue

          let message: string
          if (anyEngaged) {
            const otherId = userIds.find(id => id !== uid)
            const otherName = otherId ? profMap[otherId]?.first_name?.trim() || null : null
            message = `Looks like timing isn't working out this week — we'll try to set up a Fika with ${otherName ?? 'them'} again soon ☕`
          } else {
            message = `This intro didn't come together — we'll reach out when we have another great intro.`
          }

          await fetch('https://api.sendblue.co/api/send-message', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'sb-api-key-id': apiKeyId,
              'sb-api-secret-key': apiSecret,
            },
            body: JSON.stringify({ number: phone, content: message }),
          })
        }
      }

      staleCount++
    }

    return new Response(
      JSON.stringify({ ok: true, reset: resetCount, deleted: deletedCount ?? 0, stale_1v1_cleaned: staleCount }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 })
  }
})
