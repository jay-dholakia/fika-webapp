/**
 * Cron helpers for SMS agent: weekly opt-in, match delivery, day-of reminder.
 * Called from /api/cron/* routes (with CRON_SECRET).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { sendMessage } from './sendblue'
import { parseCancelRetryFlow, CANCEL_RETRY_SCHEDULING_STATUS } from './cancel-retry-flow'
import { finalizeCancelRetryIfDeadlinePassed, sendCancelRetryNudgeIfDue } from './cancel-retry-notify'
import { ageFromBirthdate } from './intro-detail'
import { getActiveMarketSlugs } from './admin-markets'

function getSupabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) return null
  return createClient(url, key)
}

const DEFAULT_DAILY_CAP = 200

/** Parse env SMS_WEEKLY_OPT_IN_DAILY_CAP (default 200). 0 = no cap. */
function getWeeklyOptInDailyCap(): number {
  const v = process.env.SMS_WEEKLY_OPT_IN_DAILY_CAP
  if (v === undefined || v === '') return DEFAULT_DAILY_CAP
  const n = parseInt(v, 10)
  return Number.isNaN(n) || n < 0 ? DEFAULT_DAILY_CAP : n
}

/** Weekly opt-in is retired in match-first protocol. */
export async function runWeeklyOptIn(): Promise<{ sent: number; skipped?: number; error?: string }> {
  return { sent: 0 }
}

/** Disabled for automation: match delivery is manual-only from admin trigger. */
export async function runMatchDelivery(): Promise<{ sent: number; error?: string }> {
  return { sent: 0, error: 'match_delivery_disabled_use_admin' }
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

/** Hourly (or similar): nudge silent users; close intro at deadline (no reply → NO). */
export async function runCancelRetryCron(): Promise<{
  nudged: number
  finalized: number
  error?: string
}> {
  const supabase = getSupabase()
  if (!supabase) return { nudged: 0, finalized: 0, error: 'No Supabase' }
  if (!process.env.SENDBLUE_API_KEY_ID) return { nudged: 0, finalized: 0, error: 'Sendblue not configured' }

  const { data: rows, error: qErr } = await supabase
    .from('match_candidates')
    .select('id, user_a, user_b, cancel_retry_flow')
    .eq('scheduling_status', CANCEL_RETRY_SCHEDULING_STATUS)

  if (qErr) return { nudged: 0, finalized: 0, error: qErr.message }

  let nudged = 0
  let finalized = 0

  for (const r of rows ?? []) {
    const flow = parseCancelRetryFlow(r.cancel_retry_flow)
    if (!flow || flow.phase !== 'cancel_pending_retry') continue

    const match = { id: r.id as string, user_a: r.user_a as string, user_b: r.user_b as string }

    const closed = await finalizeCancelRetryIfDeadlinePassed(supabase, match, flow)
    if (closed) {
      finalized++
      continue
    }

    const after = await sendCancelRetryNudgeIfDue(supabase, match, flow)
    if (after) nudged++
  }

  return { nudged, finalized }
}
