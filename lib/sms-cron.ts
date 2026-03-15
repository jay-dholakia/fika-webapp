/**
 * Cron helpers for SMS agent: weekly opt-in, match delivery, day-of reminder.
 * Called from /api/cron/* routes (with CRON_SECRET).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getCurrentBatchWeek } from './onboarding'
import { sendMessage } from './sendblue'
import { insertMessageLedger } from './message-ledger'
import { getOrCreateSmsState, SMS_STATES } from './sms-agent'
import { ageFromBirthdate } from './intro-detail'
import { getActiveMarketSlugs } from './admin-markets'

function getSupabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) return null
  return createClient(url, key)
}

/** Send weekly opt-in to users who have phone, are in an active market, and haven't opted in yet for this week. */
export async function runWeeklyOptIn(): Promise<{ sent: number; error?: string }> {
  const supabase = getSupabase()
  if (!supabase) return { sent: 0, error: 'No Supabase' }
  if (!process.env.SENDBLUE_API_KEY_ID) return { sent: 0, error: 'Sendblue not configured' }

  const activeSlugs = await getActiveMarketSlugs(supabase)
  if (activeSlugs.length === 0) {
    return { sent: 0 }
  }

  const batchWeek = getCurrentBatchWeek()
  const { data: optedInUserIds } = await supabase
    .from('weekly_match_opt_ins')
    .select('user_id')
    .eq('batch_week', batchWeek)
    .not('opted_in_at', 'is', null)
  const optedSet = new Set((optedInUserIds ?? []).map((r) => r.user_id))

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, phone')
    .not('phone', 'is', null)
    .in('market', activeSlugs)
  const withPhone = (profiles ?? []).filter((p) => p.phone && !optedSet.has(p.id))
  let sent = 0
  const msg = "Would you like a Fika introduction this week? Reply Yes or Skip."
  for (const p of withPhone) {
    const result = await sendMessage(p.phone!, msg, { fromNumber: 'concierge' })
    await insertMessageLedger(supabase, {
      user_id: p.id,
      direction: 'outbound',
      peer_phone: p.phone!,
      content_snippet: msg,
      context: 'weekly_opt_in',
      message_handle: result.message_handle ?? null,
      batch_week: batchWeek,
    })
    if (result.success) {
      await getOrCreateSmsState(supabase, p.id, SMS_STATES.AWAITING_OPT_IN, { batch_week: batchWeek })
      sent++
    }
  }
  return { sent }
}

/** For each match_candidate this batch_week where both have phone and we haven't sent SMS yet, send intro and set state to match_offered. */
export async function runMatchDelivery(): Promise<{ sent: number; error?: string }> {
  const supabase = getSupabase()
  if (!supabase) return { sent: 0, error: 'No Supabase' }
  if (!process.env.SENDBLUE_API_KEY_ID) return { sent: 0, error: 'Sendblue not configured' }

  const batchWeek = getCurrentBatchWeek()
  const { data: matches } = await supabase
    .from('match_candidates')
    .select('id, user_a, user_b, reasons, status')
    .eq('batch_week', batchWeek)
    .eq('status', 'active')
  if (!matches?.length) return { sent: 0 }

  const { data: states } = await supabase
    .from('sms_conversation_states')
    .select('match_id')
    .eq('batch_week', batchWeek)
    .eq('state', SMS_STATES.MATCH_OFFERED)
  const alreadySent = new Set((states ?? []).map((s) => s.match_id).filter(Boolean))

  let sent = 0
  for (const m of matches) {
    if (alreadySent.has(m.id)) continue
    const { data: profs } = await supabase
      .from('profiles')
      .select('id, first_name, birthdate, phone')
      .in('id', [m.user_a, m.user_b])
    const byId = (profs ?? []).reduce<Record<string, { first_name: string | null; birthdate: string | null; phone: string | null }>>((acc, p) => {
      acc[p.id] = { first_name: p.first_name, birthdate: p.birthdate, phone: p.phone }
      return acc
    }, {})
    const a = byId[m.user_a]
    const b = byId[m.user_b]
    if (!a?.phone || !b?.phone) continue
    const reasons = (m.reasons ?? {}) as { shared_interests?: string[]; conversation_hooks?: string[] }
    const shared = (reasons.shared_interests ?? []).slice(0, 3).join(', ')
    const ageB = ageFromBirthdate(b.birthdate)
    const nameB = b.first_name?.trim() || 'Someone'
    const introA = `I found someone you might enjoy meeting.\n\n${nameB}${ageB != null ? `, ${ageB}` : ''}\n${shared ? `Shared interests: ${shared}` : ''}\n\nWould you like the introduction? Reply YES or PASS.`
    const ageA = ageFromBirthdate(a.birthdate)
    const nameA = a.first_name?.trim() || 'Someone'
    const introB = `I found someone you might enjoy meeting.\n\n${nameA}${ageA != null ? `, ${ageA}` : ''}\n${shared ? `Shared interests: ${shared}` : ''}\n\nWould you like the introduction? Reply YES or PASS.`
    const r1 = await sendMessage(a.phone, introA, { fromNumber: 'concierge' })
    const r2 = await sendMessage(b.phone, introB, { fromNumber: 'concierge' })
    await insertMessageLedger(supabase, {
      user_id: m.user_a,
      direction: 'outbound',
      peer_phone: a.phone,
      content_snippet: introA,
      context: 'match_delivery_intro',
      message_handle: r1.message_handle ?? null,
      batch_week: batchWeek,
      match_id: m.id,
    })
    await insertMessageLedger(supabase, {
      user_id: m.user_b,
      direction: 'outbound',
      peer_phone: b.phone,
      content_snippet: introB,
      context: 'match_delivery_intro',
      message_handle: r2.message_handle ?? null,
      batch_week: batchWeek,
      match_id: m.id,
    })
    if (r1.success && r2.success) {
      await getOrCreateSmsState(supabase, m.user_a, SMS_STATES.MATCH_OFFERED, { batch_week: batchWeek, match_id: m.id })
      await getOrCreateSmsState(supabase, m.user_b, SMS_STATES.MATCH_OFFERED, { batch_week: batchWeek, match_id: m.id })
      sent += 2
    }
  }
  return { sent }
}

/** Send day-of reminder to both users for matches with confirmed_at today. */
export async function runDayOfReminder(): Promise<{ sent: number; error?: string }> {
  const supabase = getSupabase()
  if (!supabase) return { sent: 0, error: 'No Supabase' }
  if (!process.env.SENDBLUE_API_KEY_ID) return { sent: 0, error: 'Sendblue not configured' }

  const today = new Date().toISOString().slice(0, 10)
  const { data: matches } = await supabase
    .from('match_candidates')
    .select('id, user_a, user_b, confirmed_at, confirmed_venue_id')
    .eq('scheduling_status', 'confirmed')
    .not('confirmed_at', 'is', null)
  const todayMatches = (matches ?? []).filter((m) => m.confirmed_at && String(m.confirmed_at).slice(0, 10) === today)
  if (!todayMatches.length) return { sent: 0 }

  const venueIds = Array.from(new Set(todayMatches.map((m) => m.confirmed_venue_id).filter(Boolean)))
  const { data: venues } = venueIds.length
    ? await supabase.from('venues').select('id, name, neighborhood').in('id', venueIds)
    : { data: [] }
  const venueBy = (venues ?? []).reduce<Record<string, string>>((acc, v) => {
    acc[v.id] = v.neighborhood ? `${v.name} (${v.neighborhood})` : v.name
    return acc
  }, {})

  const userIds = Array.from(new Set(todayMatches.flatMap((m) => [m.user_a, m.user_b])))
  const { data: profs } = await supabase.from('profiles').select('id, phone').in('id', userIds)
  const phoneBy = (profs ?? []).reduce<Record<string, string>>((acc, p) => {
    if (p.phone) acc[p.id] = p.phone
    return acc
  }, {})

  let sent = 0
  for (const m of todayMatches) {
    const venueStr = m.confirmed_venue_id ? venueBy[m.confirmed_venue_id] ?? 'your meetup spot' : 'your meetup spot'
    const msg = `Your Fika conversation is today at ${venueStr}. Hope you both enjoy it.`
    const pa = phoneBy[m.user_a]
    const pb = phoneBy[m.user_b]
    if (pa) {
      const r = await sendMessage(pa, msg, { fromNumber: 'concierge' })
      if (r.success) sent++
    }
    if (pb) {
      const r = await sendMessage(pb, msg, { fromNumber: 'concierge' })
      if (r.success) sent++
    }
  }
  return { sent }
}
