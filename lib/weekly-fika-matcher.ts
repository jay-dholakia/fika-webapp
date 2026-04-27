import type { SupabaseClient } from '@supabase/supabase-js'
import { computeAdminPairPayload, loadAdminSimCandidatesForCanonicalPair } from '@/lib/match/admin-match-pair'
import { fetchUserIdsWithUpcomingConfirmedFika } from '@/lib/upcoming-confirmed-fika'
import { haversineMiles } from '@/lib/weekly-fika-geo'
import { availabilitySlotIdFromUtcInTimezone } from '@/lib/weekly-fika-slot'

export type WeeklySessionRow = {
  id: string
  market_slug: string
  venue_id: string
  week_anchor_monday: string
  radius_miles: number
  iana_tz: string
  fika_starts_at: string
  status: string
}

export type WeeklyMatcherResult = {
  ok: true
  createdMatchIds: string[]
  skippedIneligiblePairs: number
  eligibleOptIns: number
  notes: string[]
}

export type WeeklyMatcherError = { ok: false; error: string; code: string }

function shuffleStable<T>(items: T[], seed: string): T[] {
  const arr = [...items]
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  for (let i = arr.length - 1; i > 0; i--) {
    h = (h * 1664525 + 1013904223) >>> 0
    const j = h % (i + 1)
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

/**
 * Greedy 1:1 pairing of weekly session opt-ins: venue-radius + market filter, then intro eligibility.
 * Creates `match_candidates` with `weekly_fika_session_id`, `admin_approval_status: pending`, pre-locked scheduling.
 */
export async function runWeeklySessionMatcher(
  supabase: SupabaseClient,
  session: WeeklySessionRow
): Promise<WeeklyMatcherResult | WeeklyMatcherError> {
  const notes: string[] = []

  const { data: venue, error: venueErr } = await supabase
    .from('venues')
    .select('id, lat, lng')
    .eq('id', session.venue_id)
    .maybeSingle()

  if (venueErr) return { ok: false, error: venueErr.message, code: 'VENUE_LOAD' }
  const vLat = Number(venue?.lat)
  const vLng = Number(venue?.lng)
  if (!venue || !Number.isFinite(vLat) || !Number.isFinite(vLng)) {
    return { ok: false, error: 'Venue must have lat/lng before running the matcher.', code: 'VENUE_NO_COORDS' }
  }

  const slotId = availabilitySlotIdFromUtcInTimezone(session.fika_starts_at, session.iana_tz)
  if (!slotId) {
    return {
      ok: false,
      error:
        'Could not map fika_starts_at to a Wed–Sat availability slot in the session timezone. Pick a Fika time Wed–Sat between 9:00 and 6:30 PM local.',
      code: 'FIKA_SLOT_INVALID',
    }
  }

  const { data: optRows, error: optErr } = await supabase
    .from('weekly_fika_session_opt_ins')
    .select('user_id')
    .eq('session_id', session.id)

  if (optErr) return { ok: false, error: optErr.message, code: 'OPT_INS_LOAD' }

  const userIds = Array.from(new Set((optRows ?? []).map((r: { user_id: string }) => r.user_id)))
  if (userIds.length < 2) {
    notes.push('Fewer than two opt-ins; no pairs to create.')
    return { ok: true, createdMatchIds: [], skippedIneligiblePairs: 0, eligibleOptIns: userIds.length, notes }
  }

  const blockedUpcoming = await fetchUserIdsWithUpcomingConfirmedFika(supabase)

  const { data: profiles, error: profErr } = await supabase
    .from('profiles')
    .select('id, market, lat, lng, is_active')
    .in('id', userIds)

  if (profErr) return { ok: false, error: profErr.message, code: 'PROFILES_LOAD' }

  const byId = new Map((profiles ?? []).map((p) => [p.id as string, p]))

  const eligible: string[] = []
  for (const uid of userIds) {
    if (blockedUpcoming.has(uid)) continue
    const p = byId.get(uid) as
      | { id: string; market: string | null; lat: unknown; lng: unknown; is_active: boolean | null }
      | undefined
    if (!p) continue
    if (p.market !== session.market_slug) continue
    const lat = Number(p.lat)
    const lng = Number(p.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
    if (p.is_active === false) continue
    if (haversineMiles(lat, lng, vLat, vLng) > session.radius_miles) continue
    eligible.push(uid)
  }

  eligible.sort()
  const ordered = shuffleStable(eligible, `${session.id}:${session.week_anchor_monday}`)

  const createdMatchIds: string[] = []
  let skippedIneligiblePairs = 0

  const { data: existingRows } = await supabase
    .from('match_candidates')
    .select('user_a, user_b')
    .eq('weekly_fika_session_id', session.id)

  const pairKeys = new Set<string>()
  for (const row of existingRows ?? []) {
    const a = row.user_a as string
    const b = row.user_b as string
    pairKeys.add(a < b ? `${a}:${b}` : `${b}:${a}`)
  }

  const expiresAt = new Date(new Date(session.fika_starts_at).getTime() + 4 * 24 * 60 * 60 * 1000).toISOString()

  for (let i = 0; i + 1 < ordered.length; i += 2) {
    const rawA = ordered[i]!
    const rawB = ordered[i + 1]!
    const userA = rawA < rawB ? rawA : rawB
    const userB = rawA < rawB ? rawB : rawA

    const pairKey = `${userA}:${userB}`
    if (pairKeys.has(pairKey)) {
      notes.push(`Pair ${userA.slice(0, 8)}… / ${userB.slice(0, 8)}… already has a row for this session; skipped.`)
      continue
    }

    const loaded = await loadAdminSimCandidatesForCanonicalPair(supabase, userA, userB)
    if ('error' in loaded) {
      skippedIneligiblePairs++
      notes.push(`Pair skipped (load): ${loaded.error}`)
      continue
    }

    const payload = computeAdminPairPayload(loaded.ca, loaded.cb)
    if (!payload.breakdown.eligible) {
      skippedIneligiblePairs++
      notes.push(`Pair skipped (matcher): ${payload.breakdown.rejectReasons?.join?.('; ') ?? 'not eligible'}`)
      continue
    }

    const nowIso = new Date().toISOString()
    const { data: inserted, error: insErr } = await supabase
      .from('match_candidates')
      .insert({
        user_a: userA,
        user_b: userB,
        score: payload.score,
        reasons: { ...payload.reasons, weekly_session_matcher: 'adjacent_greedy_v1', weekly_fika_session_id: session.id },
        status: 'active',
        week_anchor_monday: session.week_anchor_monday,
        expires_at: expiresAt,
        weekly_fika_session_id: session.id,
        admin_approval_status: 'pending',
        suggested_venue_id: session.venue_id,
        confirmed_venue_id: session.venue_id,
        default_slot_id: slotId,
        confirmed_slot_id: slotId,
        overlapping_slot_ids: [slotId],
        scheduling_status: 'confirmed',
        confirmed_at: nowIso,
      })
      .select('id')
      .maybeSingle()

    if (insErr || !inserted?.id) {
      return {
        ok: false,
        error: insErr?.message ?? 'insert failed',
        code: 'MATCH_INSERT',
      }
    }

    createdMatchIds.push(inserted.id as string)
    pairKeys.add(pairKey)
  }

  return {
    ok: true,
    createdMatchIds,
    skippedIneligiblePairs,
    eligibleOptIns: ordered.length,
    notes,
  }
}
