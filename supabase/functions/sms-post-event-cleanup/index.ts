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

    // --- Day-picker nudge (12h) ---
    // If one user in 1v1_awaiting_availability hasn't submitted day choices after 12h,
    // send them the numbered list again. Only fires once per match (avail_nudge_sent flag).
    const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString()
    const twentyThreeHoursAgo = new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString()

    const { data: nudgeRows } = await supabase
      .from('sms_conversation_states')
      .select('user_id, match_id, payload')
      .eq('state', '1v1_awaiting_availability')
      .not('match_id', 'is', null)
      .lt('updated_at', twelveHoursAgo)
      .gt('updated_at', twentyThreeHoursAgo)

    const nudgeSendApiKeyId = Deno.env.get('SENDBLUE_API_KEY_ID')
    const nudgeSendApiSecret = Deno.env.get('SENDBLUE_API_SECRET_KEY')

    for (const row of (nudgeRows ?? []) as Array<{ user_id: string; match_id: string; payload: Record<string, unknown> }>) {
      const pl = row.payload ?? {}
      // Skip if already nudged or if they already submitted availability
      if (pl.avail_nudge_sent || Array.isArray(pl.availability)) continue

      const dayOptions = Array.isArray(pl.day_options)
        ? (pl.day_options as Array<{ label: string; date: string }>)
        : []
      if (dayOptions.length === 0) continue

      // Load this user's phone and their partner's name
      const { data: matchRow } = await supabase
        .from('match_candidates')
        .select('user_a, user_b')
        .eq('id', row.match_id)
        .maybeSingle()
      if (!matchRow) continue

      const otherUserId = matchRow.user_a === row.user_id ? matchRow.user_b : matchRow.user_a
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, first_name, phone')
        .in('id', [row.user_id, otherUserId])
      type P = { id: string; first_name: string | null; phone: string | null }
      const profMap: Record<string, P> = {}
      for (const p of (profiles ?? []) as P[]) profMap[p.id] = p

      const phone = profMap[row.user_id]?.phone?.trim()
      const otherName = profMap[otherUserId]?.first_name?.trim() || 'your Fika partner'
      if (!phone || !nudgeSendApiKeyId || !nudgeSendApiSecret) continue
      if (Deno.env.get('SMS_OUTBOUND_DISABLED') === 'true') continue

      const listLines = dayOptions.map((d, i) => `${i + 1}. ${d.label}`).join('\n')
      const nudgeMsg = `Just a reminder — which of these evenings work for a 6pm Fika with ${otherName}?\n\n${listLines}\n\nReply with the numbers that work!`

      const ok = await fetch('https://api.sendblue.co/api/send-message', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'sb-api-key-id': nudgeSendApiKeyId,
          'sb-api-secret-key': nudgeSendApiSecret,
        },
        body: JSON.stringify({ number: phone, content: nudgeMsg }),
      }).then(r => r.ok).catch(() => false)

      if (ok) {
        await supabase
          .from('sms_conversation_states')
          .update({ payload: { ...pl, avail_nudge_sent: true } })
          .eq('user_id', row.user_id)
          .eq('match_id', row.match_id)
      }
    }

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
        // One-sided = someone accepted but the other person never responded
        const oneSided = anyEngaged && matchRows.some((r: { state: string }) => r.state === '1v1_offered')

        for (const uid of userIds) {
          const prof = profMap[uid]
          const phone = prof?.phone?.trim()
          if (!phone) continue

          let message: string
          if (oneSided) {
            const userRow = matchRows.find((r: { user_id: string }) => r.user_id === uid)
            const didAccept = userRow?.state !== '1v1_offered'
            if (didAccept) {
              message = "The other person wasn't able to respond in time — we'll find you another great intro soon ☕"
            } else {
              message = "This intro has expired. We'll be in touch when we have another one for you ☕"
            }
          } else if (anyEngaged) {
            const otherId = userIds.find((id: string) => id !== uid)
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
