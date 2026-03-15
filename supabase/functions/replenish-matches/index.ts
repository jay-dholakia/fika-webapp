// @deno-types are resolved at runtime by Deno
// @ts-ignore - Deno runtime types
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
// @ts-ignore - Deno runtime types
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Deno global is available at runtime
declare const Deno: {
  env: {
    get(key: string): string | undefined;
  };
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const AVAILABILITY_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const HALF_HOUR_IDS: string[] = (() => {
  const out: string[] = []
  for (let h = 9; h <= 18; h++) {
    for (const m of ['00', '30']) {
      out.push(`${h.toString().padStart(2, '0')}_${m}`)
    }
  }
  return out
})()

/** Rank slot IDs: earlier week first, evenings preferred. Returns best-first; first = default. */
function rankAvailabilitySlots(slotIds: string[]): string[] {
  if (!slotIds.length) return []
  const scored = slotIds.map((id) => {
    const parts = id.split('_')
    const dayStr = parts[0]
    const timeStr = parts.slice(1).join('_')
    const dayIndex = AVAILABILITY_DAYS.indexOf(dayStr)
    const timeIndex = HALF_HOUR_IDS.indexOf(timeStr)
    if (dayIndex === -1 || timeIndex === -1) return { id, score: -1 }
    const score = (7 - dayIndex) * 100 + timeIndex
    return { id, score }
  }).filter((x) => x.score >= 0)
  scored.sort((a, b) => b.score - a.score)
  return scored.map((x) => x.id)
}

function getBestDefaultSlot(slotIds: string[]): string | null {
  const ranked = rankAvailabilitySlots(slotIds)
  return ranked[0] ?? null
}

function ageFromBirthdate(birthdate: string | null | undefined): number | null {
  if (!birthdate || typeof birthdate !== 'string') return null
  const date = new Date(birthdate.trim())
  if (isNaN(date.getTime())) return null
  const today = new Date()
  let age = today.getFullYear() - date.getFullYear()
  const monthDiff = today.getMonth() - date.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < date.getDate())) age--
  return age >= 0 ? age : null
}

interface UserProfile {
  id: string;
  first_name: string;
  city: string;
  lat: number | null;
  lng: number | null;
  birthdate: string | null;
  radius_km: number;
  in_match_bowl: boolean;
  age: number | null;
  relationship_status: string | null;
  age_range_preference: number | null;
  gender: string | null;
  gender_preference: string | null;
  age_preference: string | null;
  languages: string[] | null;
}

interface IntakeResponse {
  user_id: string;
  embed_vector?: number[];
  responses?: any[];
  life_stage?: string[]; // Now TEXT[] for multi-select
  availability_times?: string[];
  // Note: age_range_preference is now in profiles table, not here
  [key: string]: any;
}

serve(async (req: Request) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Create Supabase client with service role key
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { user_id } = await req.json()

    // If user_id provided, replenish for specific user, otherwise replenish for all eligible users
    if (user_id) {
      await replenishUserMatches(supabaseClient, user_id)
    } else {
      await replenishAllUsers(supabaseClient)
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Error in replenish-matches:', error)
    const errorMessage = error instanceof Error ? error.message : String(error)
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
})

function getBatchWeekMonday(now: Date): string {
  const dayOfWeek = now.getDay()
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1
  const monday = new Date(now)
  monday.setDate(now.getDate() - daysToMonday)
  monday.setHours(0, 0, 0, 0)
  return monday.toISOString().split('T')[0]
}

/** Wednesday 00:00 (midnight) of the match week = expiration. batch_week is Monday YYYY-MM-DD. */
function getExpiresAtWednesdayMidnight(batchWeek: string): string {
  const d = new Date(batchWeek + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + 2)
  d.setUTCHours(0, 0, 0, 0)
  return d.toISOString()
}

const WED_SUN_PREFIXES = ['wed_', 'thu_', 'fri_', 'sat_', 'sun_']
function isWedSunSlot(slotId: string): boolean {
  return WED_SUN_PREFIXES.some((p) => slotId.startsWith(p))
}

/** Slugs of markets where Monday opt-in and match run are enabled. */
async function getActiveMarketSlugs(supabaseClient: any): Promise<string[]> {
  const { data, error } = await supabaseClient
    .from('markets')
    .select('slug')
    .eq('active', true)
  if (error) return []
  return (data ?? []).map((r: { slug: string }) => r.slug).filter(Boolean)
}

/** Filter user IDs to only those in an active market. */
async function filterOptedInByActiveMarket(supabaseClient: any, userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return []
  const activeSlugs = await getActiveMarketSlugs(supabaseClient)
  if (activeSlugs.length === 0) return []
  const { data: profiles } = await supabaseClient
    .from('profiles')
    .select('id, market')
    .in('id', userIds)
  const activeSet = new Set(activeSlugs)
  return (profiles ?? [])
    .filter((p: { id: string; market: string | null }) => p.market && activeSet.has(p.market))
    .map((p: { id: string }) => p.id)
}

async function replenishAllUsers(supabaseClient: any) {
  const batchWeek = getBatchWeekMonday(new Date())
  // Get user IDs who opted in for this week's match run
  const { data: optIns, error: optInError } = await supabaseClient
    .from('weekly_match_opt_ins')
    .select('user_id')
    .eq('batch_week', batchWeek)

  if (optInError) throw optInError
  let optedInIds = (optIns || []).map((r: { user_id: string }) => r.user_id)
  optedInIds = await filterOptedInByActiveMarket(supabaseClient, optedInIds)
  if (optedInIds.length === 0) {
    console.log(`No users opted in for batch_week ${batchWeek} in active markets. Skipping replenish.`)
    return
  }

  // Eligible = in bowl, active, AND opted in for this week
  const { data: eligibleUsers, error: usersError } = await supabaseClient
    .from('profiles')
    .select('id')
    .eq('in_match_bowl', true)
    .eq('is_active', true)
    .in('id', optedInIds)

  if (usersError) throw usersError

  for (const user of eligibleUsers || []) {
    await replenishUserMatches(supabaseClient, user.id)
  }
}

async function replenishUserMatches(supabaseClient: any, userId: string) {
  const batchWeek = getBatchWeekMonday(new Date())

  // Only process users who opted in for this week
  const { data: optIn, error: optInError } = await supabaseClient
    .from('weekly_match_opt_ins')
    .select('user_id')
    .eq('user_id', userId)
    .eq('batch_week', batchWeek)
    .maybeSingle()

  if (optInError) throw optInError
  if (!optIn) {
    console.log(`User ${userId.substring(0, 8)} not opted in for batch_week ${batchWeek}. Skipping.`)
    return
  }

  // Get this user's availability from weekly_availability
  const { data: availabilityRow } = await supabaseClient
    .from('weekly_availability')
    .select('availability_slots')
    .eq('user_id', userId)
    .eq('batch_week', batchWeek)
    .maybeSingle()

  const userAvailabilitySlots: string[] = Array.isArray(availabilityRow?.availability_slots) ? availabilityRow.availability_slots : []

  console.log(`Processing matches for user ${userId.substring(0, 8)}, batch_week: ${batchWeek}`)

  // Check if user already has matches from this week (idempotency check)
  const { data: thisWeekMatches, error: thisWeekError } = await supabaseClient
    .from('match_candidates')
    .select('id')
    .or(`user_a.eq.${userId},user_b.eq.${userId}`)
    .eq('batch_week', batchWeek)

  if (thisWeekError) throw thisWeekError

  const thisWeekCount = thisWeekMatches?.length || 0
  if (thisWeekCount >= 5) {
    console.log(`User ${userId.substring(0, 8)} already has ${thisWeekCount} matches for this week. Skipping.`)
    return
  }

  // Delete/expire all non-converted matches from previous weeks
  const { error: deleteError } = await supabaseClient
    .from('match_candidates')
    .delete()
    .or(`user_a.eq.${userId},user_b.eq.${userId}`)
    .neq('batch_week', batchWeek)
    .neq('status', 'converted')

  if (deleteError) {
    console.error(`Error deleting previous week's matches:`, deleteError)
    // Don't throw - continue with match creation
  } else {
    console.log(`Deleted previous week's non-converted matches for user ${userId.substring(0, 8)}`)
  }

  // Get user profile and intake data
  const { data: userProfile, error: profileError } = await supabaseClient
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()

  if (profileError) throw profileError

  // Get v5 intake data (all users must complete new questionnaire)
  const { data: userIntake, error: intakeError } = await supabaseClient
    .from('intake_responses_v5')
    .select('*')
    .eq('user_id', userId)
    .single()

  if (intakeError) throw intakeError
  if (!userIntake) throw new Error('No intake data found')

  const effectiveUserProfile: UserProfile = {
    id: userProfile.id,
    first_name: userProfile.first_name,
    city: userProfile.city ?? '',
    lat: userProfile.lat,
    lng: userProfile.lng,
    birthdate: userProfile.birthdate ?? null,
    in_match_bowl: userProfile.in_match_bowl ?? false,
    relationship_status: userProfile.relationship_status ?? null,
    age_range_preference: getIntakeNumericValue(userIntake, 'q7_age_range') ?? null,
    radius_km: getIntakeRadiusKm(userIntake),
    age: ageFromBirthdate(userProfile.birthdate),
    gender: userProfile.gender ?? null,
    gender_preference: userProfile.gender_preference ?? null,
    age_preference: userProfile.age_preference ?? null,
    languages: Array.isArray(userProfile.languages) ? userProfile.languages : null,
  }

  // Find potential matches - get enough candidates to fill up to 5 matches (only from users opted in for this week)
  const potentialMatches = await findPotentialMatches(
    supabaseClient,
    effectiveUserProfile,
    userIntake,
    batchWeek,
    userAvailabilitySlots,
    50 // Get top 50 candidates to ensure we have enough above threshold
  )

  console.log(`Found ${potentialMatches.length} potential matches for user ${userId.substring(0, 8)}`)

  // Create match candidates
  // Only create matches above 0.35 threshold
  const MATCH_SCORE_THRESHOLD = 0.35
  const MAX_MATCHES = 1
  const needed = MAX_MATCHES - thisWeekCount
  
  let createdCount = 0
  for (const match of potentialMatches) {
    // Stop if we've created enough matches
    if (createdCount >= needed) {
      break
    }

    // Only create matches above threshold
    if (match.score >= MATCH_SCORE_THRESHOLD) {
      try {
        const overlappingSlots = (match.reasons?.overlappingAvailabilitySlots ?? []) as string[]
        const wedSunOnly = overlappingSlots.filter((id) => isWedSunSlot(id))
        const defaultSlotId = wedSunOnly.length > 0 ? getBestDefaultSlot(wedSunOnly) : null
        await createMatchCandidate(supabaseClient, userId, match.id, match.score, match.reasons, batchWeek, wedSunOnly, defaultSlotId)
        createdCount++
        console.log(`Created match ${createdCount}/${needed}: score ${match.score.toFixed(3)}`)
      } catch (error) {
        console.error(`Failed to create match:`, error)
      }
    } else {
      console.log(`Skipping match with score ${match.score.toFixed(3)} (below threshold ${MATCH_SCORE_THRESHOLD})`)
    }
  }
  console.log(`Created ${createdCount} matches above threshold for user ${userId.substring(0, 8)} (batch_week: ${batchWeek})`)
}

async function findPotentialMatches(
  supabaseClient: any,
  userProfile: UserProfile,
  userIntake: any,
  batchWeek: string,
  userAvailabilitySlots: string[],
  limit: number
) {
  // Get user IDs who opted in for this week
  const { data: optIns, error: optInError } = await supabaseClient
    .from('weekly_match_opt_ins')
    .select('user_id')
    .eq('batch_week', batchWeek)

  if (optInError) throw optInError
  let optedInIds = (optIns || []).map((r: { user_id: string }) => r.user_id).filter((id: string) => id !== userProfile.id)
  optedInIds = await filterOptedInByActiveMarket(supabaseClient, optedInIds)
  if (optedInIds.length === 0) {
    console.log('No other users opted in for this batch_week in active markets')
    return []
  }

  // Get availability for all opted-in users from weekly_availability
  const { data: availabilityRows } = await supabaseClient
    .from('weekly_availability')
    .select('user_id, availability_slots')
    .eq('batch_week', batchWeek)
    .in('user_id', optedInIds)

  const availabilityByUserId: Record<string, string[]> = {}
  for (const r of availabilityRows || []) {
    availabilityByUserId[r.user_id] = Array.isArray(r.availability_slots) ? r.availability_slots : []
  }
  if (optedInIds.length === 0) {
    console.log('No other users opted in for this batch_week')
    return []
  }

  // Get potential matches: in bowl, active, and opted in for this week
  const { data: potentialUsers, error: usersError } = await supabaseClient
    .from('profiles')
    .select('*')
    .eq('in_match_bowl', true)
    .eq('is_active', true)
    .in('id', optedInIds)

  if (usersError) throw usersError

  console.log(`Found ${potentialUsers?.length || 0} potential users to match against`)

  interface ScoredMatch { id: string; score: number; reasons: Record<string, unknown> }
  const scoredMatches: ScoredMatch[] = []

  // Fetch intake data separately for each candidate
  for (const candidate of potentialUsers || []) {
    // Get candidate's intake data
    const { data: candidateIntakeData, error: intakeError } = await supabaseClient
      .from('intake_responses_v5')
      .select('*')
      .eq('user_id', candidate.id)
      .single()

    if (intakeError || !candidateIntakeData) {
      console.log(`Skipping ${candidate.id.substring(0, 8)} - no intake data: ${intakeError?.message || 'not found'}`)
      continue
    }

    const candidateIntake = candidateIntakeData

    // Require overlapping availability when both have set slots (Doodle-style)
    const candidateSlots: string[] = availabilityByUserId[candidate.id] ?? []
    let overlappingAvailabilitySlots: string[] = []
    if (userAvailabilitySlots.length > 0 && candidateSlots.length > 0) {
      overlappingAvailabilitySlots = userAvailabilitySlots.filter((s) => candidateSlots.includes(s))
      if (overlappingAvailabilitySlots.length === 0) {
        console.log(`Skipping ${candidate.id.substring(0, 8)} - no overlapping availability`)
        continue
      }
    }

    const effectiveCandidateProfile: UserProfile = {
      id: candidate.id,
      first_name: candidate.first_name,
      city: candidate.city ?? '',
      lat: candidate.lat,
      lng: candidate.lng,
      birthdate: candidate.birthdate ?? null,
      in_match_bowl: candidate.in_match_bowl ?? false,
      relationship_status: candidate.relationship_status ?? null,
      age_range_preference: getIntakeNumericValue(candidateIntake, 'q7_age_range') ?? null,
      radius_km: getIntakeRadiusKm(candidateIntake),
      age: ageFromBirthdate(candidate.birthdate),
      gender: candidate.gender ?? null,
      gender_preference: candidate.gender_preference ?? null,
      age_preference: candidate.age_preference ?? null,
      languages: Array.isArray(candidate.languages) ? candidate.languages : null,
    }

    // Hard filters: geography first, then languages, then other structured filters
    if (!passesGeographyFilter(userProfile, effectiveCandidateProfile)) {
      console.log(`Skipping ${candidate.id.substring(0, 8)} - failed geography filter`)
      continue
    }
    if (!passesLanguagesFilter(userProfile, effectiveCandidateProfile)) {
      console.log(`Skipping ${candidate.id.substring(0, 8)} - no shared fluent language`)
      continue
    }
    if (!passesStructuredFilters(userIntake, candidateIntake, userProfile, effectiveCandidateProfile)) {
      console.log(`Skipping ${candidate.id.substring(0, 8)} - failed structured filters`)
      continue
    }

    // Check if users are blocked
    const { data: blocked } = await supabaseClient
      .from('blocks')
      .select('id')
      .or(`blocker_id.eq.${userProfile.id},blocker_id.eq.${candidate.id}`)
      .or(`blocked_id.eq.${userProfile.id},blocked_id.eq.${candidate.id}`)
      .limit(1)

    if (blocked?.length > 0) continue

    // Check permanent exclusion (e.g. either passed on this pair — never match again)
    const orderedA = userProfile.id < candidate.id ? userProfile.id : candidate.id
    const orderedB = userProfile.id < candidate.id ? candidate.id : userProfile.id
    const { data: excluded } = await supabaseClient
      .from('match_exclusions')
      .select('id')
      .eq('user_a', orderedA)
      .eq('user_b', orderedB)
      .limit(1)
    if (excluded?.length > 0) {
      console.log(`Skipping ${candidate.id.substring(0, 8)} - pair excluded (e.g. passed)`)
      continue
    }

    // Check cooldown
    const inCooldown = await checkCooldown(supabaseClient, userProfile.id, candidate.id)
    if (inCooldown) {
      console.log(`Skipping ${candidate.id.substring(0, 8)} - in cooldown`)
      continue
    }

    // Check if already matched - skip for now to see all matches
    // const { data: existingMatch } = await supabaseClient
    //   .from('match_candidates')
    //   .select('id')
    //   .or(
    //     `and(user_a.eq.${Math.min(userProfile.id, candidate.id)},user_b.eq.${Math.max(userProfile.id, candidate.id)})`
    //   )
    //   .limit(1)

    // if (existingMatch?.length > 0) continue

    // Calculate compatibility score (section-level cosine + weighted average)
    const scoreResult = await calculateCompatibilityScoreV4(
      userProfile,
      userIntake,
      effectiveCandidateProfile,
      candidateIntake
    )
    const score = scoreResult.score

    console.log(`Score for ${candidate.id.substring(0, 8)}: ${score.toFixed(3)}`)

    // Generate match reasons with both users' info (bidirectional)
    const reasons = await generateMatchReasonsV4(
      userIntake,
      candidateIntake,
      userProfile.id,
      candidate.id,
      userProfile.first_name || 'You',
      candidate.first_name || 'They'
    )
    reasons.matchScore = score
    ;(reasons as Record<string, unknown>).sectionScores = scoreResult.sectionScores
    ;(reasons as Record<string, unknown>).overlappingAvailabilitySlots = overlappingAvailabilitySlots

    // Create matches for everyone - no score threshold
    scoredMatches.push({
      id: candidate.id,
      score,
      reasons
    })
  }

  // Sort by score and return top matches
  return scoredMatches
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371 // Earth's radius in kilometers
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng/2) * Math.sin(dLng/2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
  return R * c
}

async function checkCooldown(supabaseClient: any, userId1: string, userId2: string): Promise<boolean> {
  const { data } = await supabaseClient
    .rpc('users_in_cooldown', { 
      user_a_uuid: userId1, 
      user_b_uuid: userId2 
    })
  
  return data || false
}

async function countActiveChats(supabaseClient: any, userId: string): Promise<number> {
  const { data } = await supabaseClient
      .rpc('count_active_match_chats', { user_uuid: userId })
  
  return data || 0
}

async function createMatchCandidate(
  supabaseClient: any, 
  userA: string, 
  userB: string, 
  score: number, 
  reasons: any,
  batchWeek: string,
  overlappingSlotIds: string[] = [],
  defaultSlotId: string | null = null
) {
  const orderedUserA = userA < userB ? userA : userB
  const orderedUserB = userA < userB ? userB : userA

  const schedulingStatus = overlappingSlotIds.length > 0 && defaultSlotId ? 'proposed_default' : null

  const expiresAt = getExpiresAtWednesdayMidnight(batchWeek)

  const { data: insertData, error: insertError } = await supabaseClient
    .from('match_candidates')
    .insert({
      user_a: orderedUserA,
      user_b: orderedUserB,
      score,
      reasons,
      status: 'active',
      batch_week: batchWeek,
      expires_at: expiresAt,
      overlapping_slot_ids: overlappingSlotIds,
      default_slot_id: defaultSlotId,
      scheduling_status: schedulingStatus,
    })
    .select()

  if (insertError) {
    // If duplicate, try update instead
    if (insertError.code === '23505') { // Unique violation - match already exists for this pair + batch_week
      console.log(`Match exists, updating score/reasons only (preserving status): ${orderedUserA.substring(0, 8)}-${orderedUserB.substring(0, 8)}`)
      // Do NOT update status - leave opted_in_a, opted_in_b, mutual_opt_in, converted unchanged
      const { data: updateData, error: updateError } = await supabaseClient
        .from('match_candidates')
        .update({
          score: score || 0,
          reasons: reasons || {},
          expires_at: getExpiresAtWednesdayMidnight(batchWeek),
          overlapping_slot_ids: overlappingSlotIds,
          default_slot_id: defaultSlotId,
          scheduling_status: schedulingStatus,
        })
        .eq('user_a', orderedUserA)
        .eq('user_b', orderedUserB)
        .eq('batch_week', batchWeek)
        .select()

      if (updateError) {
        console.error(`Error updating match ${orderedUserA.substring(0, 8)}-${orderedUserB.substring(0, 8)}:`, updateError)
        throw updateError
      }
      return updateData
    } else {
      console.error(`Error creating match ${orderedUserA.substring(0, 8)}-${orderedUserB.substring(0, 8)}:`, insertError)
      throw insertError
    }
  }
  
  return insertData
}

// Geography hard filter: distance <= radius_user + radius_candidate (each can travel their radius).
// TODO: future enhancement — require a meetup point within both radii.
function passesGeographyFilter(userProfile: UserProfile, candidateProfile: UserProfile): boolean {
  if (
    userProfile.lat == null || userProfile.lng == null ||
    candidateProfile.lat == null || candidateProfile.lng == null
  ) {
    return true // no coords → don't filter out
  }
  const distanceKm = calculateDistance(
    userProfile.lat, userProfile.lng,
    candidateProfile.lat, candidateProfile.lng
  )
  const totalMaxKm = (userProfile.radius_km ?? 40) + (candidateProfile.radius_km ?? 40)
  if (distanceKm > totalMaxKm) {
    console.log(`Geography filter: User ${userProfile.id.substring(0, 8)} and candidate ${candidateProfile.id.substring(0, 8)} are ${distanceKm.toFixed(0)} km apart (max ${totalMaxKm.toFixed(0)} km)`)
    return false
  }
  return true
}

// Require at least one shared fluent language (profile.languages).
function passesLanguagesFilter(userProfile: UserProfile, candidateProfile: UserProfile): boolean {
  const u = userProfile.languages ?? []
  const c = candidateProfile.languages ?? []
  if (u.length === 0 || c.length === 0) return true // no data → don't filter out
  const uSet = new Set(u.map((l: string) => l.trim().toLowerCase()))
  for (const lang of c) {
    if (uSet.has(lang.trim().toLowerCase())) return true
  }
  return false
}

// Apply structured filters (gender preference, age preference, q_hoping_for). Geography and languages are applied separately.
function passesStructuredFilters(
  userIntake: any,
  candidateIntake: any,
  userProfile: UserProfile,
  candidateProfile: UserProfile
): boolean {
  // Filter 1: Gender preference - LA Beta: No preference / Same gender / Different gender
  if (
    userProfile.gender != null && userProfile.gender !== '' &&
    candidateProfile.gender != null && candidateProfile.gender !== '' &&
    userProfile.gender_preference != null && userProfile.gender_preference !== '' &&
    candidateProfile.gender_preference != null && candidateProfile.gender_preference !== ''
  ) {
    const userGenderNorm = userProfile.gender.trim().toLowerCase()
    const candidateGenderNorm = candidateProfile.gender.trim().toLowerCase()
    const userPref = userProfile.gender_preference.trim().toLowerCase()
    const candidatePref = candidateProfile.gender_preference.trim().toLowerCase()

    const sameGender = (a: string, b: string): boolean => {
      if (a === b) return true
      if ((a === 'female' || a === 'woman' || a === 'women') && (b === 'female' || b === 'woman' || b === 'women')) return true
      if ((a === 'male' || a === 'man' || a === 'men') && (b === 'male' || b === 'man' || b === 'men')) return true
      if ((a === 'non-binary' || a === 'nonbinary') && (b === 'non-binary' || b === 'nonbinary')) return true
      return false
    }
    const preferenceAllowsCandidate = (pref: string, userGender: string, candidateGender: string): boolean => {
      if (pref === 'no preference') return true
      if (pref === 'same gender') return sameGender(userGender, candidateGender)
      if (pref === 'different gender') return !sameGender(userGender, candidateGender)
      return true
    }

    if (!preferenceAllowsCandidate(candidatePref, candidateProfile.gender.trim().toLowerCase(), userGenderNorm)) {
      console.log(`Gender filter: Candidate preference "${candidateProfile.gender_preference}" does not include user gender "${userProfile.gender}"`)
      return false
    }
    if (!preferenceAllowsCandidate(userPref, userGenderNorm, candidateGenderNorm)) {
      console.log(`Gender filter: User preference "${userProfile.gender_preference}" does not include candidate gender "${candidateProfile.gender}"`)
      return false
    }
  }

  // Filter 2.5: Age preference — when either prefers "around my age", require within ±3 years (both directions). Skip if either age is null.
  const PREFER_AROUND_MY_AGE = 'Prefer around my age'
  const userPrefersAroundMyAge = userProfile.age_preference != null && userProfile.age_preference.trim() === PREFER_AROUND_MY_AGE
  const candidatePrefersAroundMyAge = candidateProfile.age_preference != null && candidateProfile.age_preference.trim() === PREFER_AROUND_MY_AGE
  if ((userPrefersAroundMyAge || candidatePrefersAroundMyAge) && userProfile.age != null && candidateProfile.age != null) {
    const ageDiff = Math.abs(userProfile.age - candidateProfile.age)
    if (ageDiff > 3) {
      console.log(`Age filter: at least one prefers around own age; ages ${userProfile.age} vs ${candidateProfile.age} (diff ${ageDiff})`)
      return false
    }
  }

  // Filter 3: What you're hoping for (q_hoping_for) — don't match "conversation only" with "actively looking for friends"
  const HOPING_CONVERSATION_ONLY = 'Conversation with new people — not necessarily friendship'
  const HOPING_ACTIVELY_FRIENDS = 'Actively looking for new friends'
  const userHoping = getSingleSelectValue(userIntake, 'q_hoping_for')
  const candidateHoping = getSingleSelectValue(candidateIntake, 'q_hoping_for')
  if (userHoping && candidateHoping) {
    const u = userHoping.trim()
    const c = candidateHoping.trim()
    if ((u === HOPING_CONVERSATION_ONLY && c === HOPING_ACTIVELY_FRIENDS) || (u === HOPING_ACTIVELY_FRIENDS && c === HOPING_CONVERSATION_ONLY)) {
      console.log(`q_hoping_for filter: conversation-only vs actively-friends mismatch`)
      return false
    }
  }

  // q_openness is no longer a hard filter; it contributes to score only (openness section).

  return true
}

// Extract keywords from open-ended responses
function extractKeywords(responses: any[]): Set<string> {
  const keywords = new Set<string>()
  const commonInterests = [
    'music', 'food', 'travel', 'reading', 'hiking', 'yoga', 'coffee', 'art', 'photography', 'cooking',
    'fitness', 'running', 'cycling', 'swimming', 'dancing', 'writing', 'gaming', 'movies', 'tv shows',
    'podcasts', 'concerts', 'festivals', 'museums', 'theater', 'comedy', 'sports', 'basketball', 'soccer',
    'tennis', 'volleyball', 'rock climbing', 'surfing', 'skiing', 'camping', 'backpacking', 'gardening',
    'volunteering', 'meditation', 'mindfulness', 'wine', 'beer', 'cocktails', 'brunch', 'dining out',
    'board games', 'puzzles', 'chess', 'books', 'novels', 'non-fiction', 'poetry', 'philosophy',
    'technology', 'coding', 'programming', 'startups', 'entrepreneurship', 'design', 'fashion', 'style'
  ]

  if (!responses) return keywords

  const allText = responses
    .filter((r: any) => r.type === 'open_ended')
    .map((r: any) => (r.answer || '').toLowerCase())
    .join(' ')

  // Extract common interest keywords
  for (const interest of commonInterests) {
    if (allText.includes(interest)) {
      keywords.add(interest)
    }
  }

  return keywords
}

// Sentinel for optional intake questions the user skipped (stored so they don't show as "missing" in portal)
const INTAKE_ANSWER_SKIPPED = 'N/A'

function isSkippedAnswer(value: any): boolean {
  if (value == null) return true
  if (value === INTAKE_ANSWER_SKIPPED) return true
  if (Array.isArray(value) && value.length === 1 && value[0] === INTAKE_ANSWER_SKIPPED) return true
  return false
}

// Helper functions to extract values from JSONB responses array
function getResponseValue(intake: any, questionId: string): any {
  if (!intake?.responses || !Array.isArray(intake.responses)) return null
  const response = intake.responses.find((r: any) => r.question_id === questionId)
  const value = response?.answer ?? null
  return isSkippedAnswer(value) ? null : value
}

function getMultiSelectValue(intake: any, questionId: string): string[] {
  const value = getResponseValue(intake, questionId)
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

function getSingleSelectValue(intake: any, questionId: string): string | null {
  const value = getResponseValue(intake, questionId)
  return typeof value === 'string' ? value : null
}

// Parse numeric/slider value from intake (age range "± 5 years", travel "15 miles", or plain number)
function getIntakeNumericValue(intake: any, questionId: string): number | null {
  const raw = getResponseValue(intake, questionId)
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'number' && !isNaN(raw)) return raw
  const s = String(raw).trim()
  const num = parseInt(s, 10)
  if (!isNaN(num)) return num
  const pmMatch = s.match(/±\s*(\d+)/)
  if (pmMatch) return parseInt(pmMatch[1], 10)
  const milesMatch = s.match(/(\d+)\s*miles/)
  if (milesMatch) return parseInt(milesMatch[1], 10)
  return null
}

// Travel distance: LA Beta intake (q_radius), default 40 km (~25 miles)
function getIntakeRadiusKm(intake: any): number {
  const miles = getIntakeNumericValue(intake, 'q_radius')
  return miles != null ? Math.round(miles * 1.60934) : 40
}

// Canonical option lists for section-level cosine (order must match onboarding-data.ts)
const OPTIONS_LIFE_CHAPTER = [
  "I'm in college or university", "I'm in graduate school", 'I recently graduated', "I'm early in my career", "I'm growing in my career", "I'm established in my career", "I'm building something (startup, project, business)", "I'm working independently or freelancing", "I'm transitioning into a new career", 'I recently moved to this city', 'I recently got married or entered a long-term partnership', "I'm exploring a new direction", "I'm taking time to figure out what's next", "I'm taking a break or sabbatical", "I'm starting a family", "I'm raising kids", "I'm caring for family members", "I'm semi-retired", "I'm retired",
]
const OPTIONS_EVERYDAY_ANCHOR = [
  'Work', 'Side hustles', 'Job search', 'School', 'Family life', 'Parenting', 'Family caregiving', 'Romantic relationship', 'Close friendships', 'Fitness routine', 'Creative projects', 'Community or volunteering', 'Faith or spiritual practice', 'Travel', 'Something else',
]
const OPTIONS_INTERESTS = [
  'Reading', 'Music', 'Film & TV', 'Podcasts', 'Cooking', 'Travel', 'Fitness', 'Dance', 'Basketball', 'Football', 'Soccer', 'Baseball', 'Running', 'Hiking', 'Outdoors', 'Yoga / Pilates', 'Weightlifting', 'Cycling', 'Swimming', 'Tennis', 'Pickleball', 'Photography', 'Art & design', 'Writing', 'Gaming', 'Entrepreneurship & startups', 'Investing & finance', 'History', 'Science', 'Philosophy', 'Politics & current events',
]
const OPTIONS_CURIOSITY = [
  'Take a pottery class', 'Learn how to paint', 'Learn an instrument', 'Take a dance class', 'Take a cooking class', 'Start learning a new language', 'Join a storytelling workshop', 'Take a photography course', 'Start a fitness program', 'Join a local sports league', 'Take a coding course', 'Take an AI course', 'Take a philosophy class', 'Take an improv class', 'Take a human behavior course', 'Join a public speaking group', 'Take a course on how to build a business', 'Take a class on personal finance',
]
const OPTIONS_GREAT_FIKA = [
  'Swapping stories from our lives (chapters, how we got here)',
  "Stuff we're into lately (books, shows, podcasts, games)",
  "Recent travel and places you've visited",
  "What we're working on (work or projects)",
  'Giving/getting advice for professional & personal growth',
  'Life in our city (neighborhoods, restaurants, hangout spots)',
  'Big questions and how we see the world',
  "Hobbies and things we'd like to try next",
]
const OPTIONS_OPENNESS = [
  "Someone I'd instantly relate to", 'Someone outside my usual bubble', 'Someone whose perspective challenges mine', "I'm open to anyone",
]
const OPTIONS_HOPING_FOR = [
  'Conversation with new people — not necessarily friendship', 'Meeting people nearby — open to friendship if it happens', 'Actively looking for new friends',
]

function multiHotVector(selected: string[], options: string[]): number[] {
  const set = new Set(selected.map((s) => s.trim()))
  return options.map((o) => (set.has(o) ? 1 : 0))
}

function normalizeL2(vec: number[]): number[] {
  let sum = 0
  for (let i = 0; i < vec.length; i++) sum += vec[i] * vec[i]
  const norm = Math.sqrt(sum)
  if (norm === 0) return vec
  return vec.map((x) => x / norm)
}

function sectionCosineScore(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) return 0
  let dot = 0
  for (let i = 0; i < vecA.length; i++) dot += vecA[i] * vecB[i]
  return Math.max(0, dot)
}

// Helper: overlap score for multi-select (overlap / maxSelections) — legacy, used only where section cosine not applied
function multiSelectOverlapScore(userValues: string[], candidateValues: string[]): number {
  if (userValues.length === 0 || candidateValues.length === 0) return 0
  const overlap = userValues.filter((v: string) => candidateValues.includes(v)).length
  const maxSelections = Math.max(userValues.length, candidateValues.length)
  return maxSelections > 0 ? overlap / maxSelections : 0
}

// Align with complete-intake embed text: work, movie/show, book, role model, role model why (no place)
const OPEN_ENDED_IDS: string[] = [
  'q_work',
  'q_movie_show_recommendation',
  'q_book_recommendation',
  'q_role_model',
  'q_role_model_why',
]
// Optional: minimum words in open-ended for full embed weight (currently not used; we use embed when both have vectors)
const EMBEDDING_FULL_WORD_THRESHOLD = 50

function getOpenEndedWordCount(intake: any): number {
  if (!intake?.responses || !Array.isArray(intake.responses)) return 0
  const text = intake.responses
    .filter((r: any) => OPEN_ENDED_IDS.includes(r.question_id) && r.answer)
    .map((r: any) => String(r.answer).trim())
    .join(' ')
  return text.split(/\s+/).filter((w: string) => w.length > 0).length
}

// Section-level cosine similarity + weighted average. Weights: life_chapter 22%, day_to_day_anchors 12%, interests 18%, pick_up_next 14%, great_fika 14%, openness 6%, fika_intent 6%, open_text_embedding 8%.
async function calculateCompatibilityScoreV4(
  _userProfile: UserProfile,
  userIntake: any,
  _candidateProfile: UserProfile,
  candidateIntake: any
): Promise<{ score: number; sectionScores: Record<string, number> }> {
  const sectionScores: Record<string, number> = {}

  // 0. Open text embedding (8%)
  const userVec = ensureEmbedVector(userIntake?.embed_vector)
  const candidateVec = ensureEmbedVector(candidateIntake?.embed_vector)
  const embedScore = (userVec && candidateVec && userVec.length > 0 && candidateVec.length > 0)
    ? Math.max(0, cosineSimilarity(userVec, candidateVec))
    : 0
  sectionScores.open_text_embedding = embedScore

  // 1. Life chapter (22%)
  const uLife = normalizeL2(multiHotVector(getMultiSelectValue(userIntake, 'q_life_chapter'), OPTIONS_LIFE_CHAPTER))
  const cLife = normalizeL2(multiHotVector(getMultiSelectValue(candidateIntake, 'q_life_chapter'), OPTIONS_LIFE_CHAPTER))
  sectionScores.life_chapter = uLife.every((x) => x === 0) && cLife.every((x) => x === 0) ? 0 : sectionCosineScore(uLife, cLife)

  // 2. Day-to-day anchors (12%)
  const uAnchor = normalizeL2(multiHotVector(getMultiSelectValue(userIntake, 'q_everyday_anchor'), OPTIONS_EVERYDAY_ANCHOR))
  const cAnchor = normalizeL2(multiHotVector(getMultiSelectValue(candidateIntake, 'q_everyday_anchor'), OPTIONS_EVERYDAY_ANCHOR))
  sectionScores.day_to_day_anchors = uAnchor.every((x) => x === 0) && cAnchor.every((x) => x === 0) ? 0 : sectionCosineScore(uAnchor, cAnchor)

  // 3. Interests (18%)
  const uInt = normalizeL2(multiHotVector(getMultiSelectValue(userIntake, 'q_interests'), OPTIONS_INTERESTS))
  const cInt = normalizeL2(multiHotVector(getMultiSelectValue(candidateIntake, 'q_interests'), OPTIONS_INTERESTS))
  sectionScores.interests = uInt.every((x) => x === 0) && cInt.every((x) => x === 0) ? 0 : sectionCosineScore(uInt, cInt)

  // 4. Pick up next / curiosity (14%)
  const uCur = normalizeL2(multiHotVector(getMultiSelectValue(userIntake, 'q_curiosity'), OPTIONS_CURIOSITY))
  const cCur = normalizeL2(multiHotVector(getMultiSelectValue(candidateIntake, 'q_curiosity'), OPTIONS_CURIOSITY))
  sectionScores.pick_up_next = uCur.every((x) => x === 0) && cCur.every((x) => x === 0) ? 0 : sectionCosineScore(uCur, cCur)

  // 5. Great Fika conversation (14%)
  const uFika = normalizeL2(multiHotVector(getMultiSelectValue(userIntake, 'q_what_makes_great_fika'), OPTIONS_GREAT_FIKA))
  const cFika = normalizeL2(multiHotVector(getMultiSelectValue(candidateIntake, 'q_what_makes_great_fika'), OPTIONS_GREAT_FIKA))
  sectionScores.great_fika_conversation = uFika.every((x) => x === 0) && cFika.every((x) => x === 0) ? 0 : sectionCosineScore(uFika, cFika)

  // 6. Openness (6%) — one-hot style (single choice); cosine of multi-hot of [val]
  const uOpen = normalizeL2(multiHotVector(getMultiSelectValue(userIntake, 'q_openness'), OPTIONS_OPENNESS))
  const cOpen = normalizeL2(multiHotVector(getMultiSelectValue(candidateIntake, 'q_openness'), OPTIONS_OPENNESS))
  sectionScores.openness = sectionCosineScore(uOpen, cOpen)

  // 7. Fika intent / hoping for (6%) — single choice; cosine of one-hot
  const uHoping = normalizeL2(multiHotVector(getMultiSelectValue(userIntake, 'q_hoping_for').length ? getMultiSelectValue(userIntake, 'q_hoping_for') : [], OPTIONS_HOPING_FOR))
  const cHoping = normalizeL2(multiHotVector(getMultiSelectValue(candidateIntake, 'q_hoping_for').length ? getMultiSelectValue(candidateIntake, 'q_hoping_for') : [], OPTIONS_HOPING_FOR))
  sectionScores.fika_intent = sectionCosineScore(uHoping, cHoping)

  const weights: Record<string, number> = {
    life_chapter: 0.22,
    day_to_day_anchors: 0.12,
    interests: 0.18,
    pick_up_next: 0.14,
    great_fika_conversation: 0.14,
    openness: 0.06,
    fika_intent: 0.06,
    open_text_embedding: 0.08,
  }
  let total = 0
  for (const [k, w] of Object.entries(weights)) {
    total += (sectionScores[k] ?? 0) * w
  }
  const score = Math.min(1, Math.max(0, isNaN(total) ? 0 : total))
  return { score, sectionScores }
}

// Ensure embed_vector is a number[] (PostgREST may return pgvector as string "[0.1,0.2,...]")
function ensureEmbedVector(vec: any): number[] | null {
  if (!vec) return null
  if (Array.isArray(vec) && vec.length > 0 && typeof vec[0] === 'number') return vec
  if (typeof vec === 'string') {
    try {
      const parsed = JSON.parse(vec) as number[]
      return Array.isArray(parsed) ? parsed : null
    } catch { return null }
  }
  return null
}

function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) return 0
  
  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i]
    normA += vecA[i] * vecA[i]
    normB += vecB[i] * vecB[i]
  }

  if (normA === 0 || normB === 0) return 0
  const result = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
  return isNaN(result) ? 0 : result
}

// Map q_prefer_not_to_discuss pills (legacy) to q_topics labels. Also used for q_avoid_topics text matching (Final).
const PREFER_NOT_TO_TOPIC_MAP: Record<string, string[]> = {
  'Politics': ['Current events'],
  'Religion': ['Religion & spirituality'],
  'Work & career': ['Career journeys', 'Entrepreneurship and building things'],
  'Relationship status': ['Relationships and human connection'],
  'Health': ['Health and wellbeing'],
  'Personal finances': [],
}

/** Parse q_avoid_topics free text into words/phrases; topic is excluded if its label (lowercase) contains any of these. */
function avoidTextToKeywords(avoidText: string | null | undefined): string[] {
  if (!avoidText || typeof avoidText !== 'string') return []
  return avoidText
    .split(/[\s,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 1)
}

function topicExcludedByPreferNot(topic: string, preferNot: string[], avoidTopicsText?: string | null): boolean {
  const excludeLabels = new Set<string>()
  if (preferNot?.length) {
    for (const p of preferNot) {
      const mapped = PREFER_NOT_TO_TOPIC_MAP[p?.trim() ?? '']
      if (mapped) mapped.forEach((l: string) => excludeLabels.add(l))
    }
  }
  if (excludeLabels.has(topic)) return true
  const avoidWords = avoidTextToKeywords(avoidTopicsText)
  if (avoidWords.length === 0) return false
  const topicLower = topic.toLowerCase()
  return avoidWords.some((w) => topicLower.includes(w))
}

// Generate match reasons from v4 responses (bidirectional - includes both users' info)
async function generateMatchReasonsV4(
  userIntake: any, 
  candidateIntake: any, 
  userId: string, 
  candidateId: string,
  userName: string = 'You',
  candidateName: string = 'They'
) {
  const shared_interests: string[] = []
  const conversation_hooks: string[] = []
  const user_a_hobbies: string[] = []
  const user_a_talk_topics: string[] = []
  const user_a_interests: string[] = []
  const user_b_hobbies: string[] = []
  const user_b_talk_topics: string[] = []
  const user_b_interests: string[] = []

  // Determine which user is user_a (alphabetically first ID)
  const userAId = userId < candidateId ? userId : candidateId
  const userBId = userId < candidateId ? candidateId : userId
  const userAIntake = userId < candidateId ? userIntake : candidateIntake
  const userBIntake = userId < candidateId ? candidateIntake : userIntake

  // Extract user A's information (q_topics removed from scoring; use q_interests + q_what_makes_great_fika for shared/conversation)
  user_a_hobbies.push(...getMultiSelectValue(userAIntake, 'q_interests').slice(0, 5))
  user_a_talk_topics.push(...getMultiSelectValue(userAIntake, 'q_openness').slice(0, 4))
  user_a_interests.push(...getMultiSelectValue(userAIntake, 'q_interests').slice(0, 6))

  // Extract user B's information
  user_b_hobbies.push(...getMultiSelectValue(userBIntake, 'q_interests').slice(0, 5))
  user_b_talk_topics.push(...getMultiSelectValue(userBIntake, 'q_openness').slice(0, 4))
  user_b_interests.push(...getMultiSelectValue(userBIntake, 'q_interests').slice(0, 6))

  // Prefer not to discuss: q_avoid_topics multi_select (Final) or legacy q_prefer_not_to_discuss; legacy text q_avoid_topics for topicExcludedByPreferNot
  const userAvoidMulti = getMultiSelectValue(userIntake, 'q_avoid_topics').filter((s: string) => s !== 'Nothing in particular' && s !== 'Prefer not to say')
  const candidateAvoidMulti = getMultiSelectValue(candidateIntake, 'q_avoid_topics').filter((s: string) => s !== 'Nothing in particular' && s !== 'Prefer not to say')
  const userPreferNot = userAvoidMulti.length > 0 ? userAvoidMulti : getMultiSelectValue(userIntake, 'q_prefer_not_to_discuss').filter((s: string) => s !== 'Nothing in particular' && s !== 'Prefer not to say')
  const candidatePreferNot = candidateAvoidMulti.length > 0 ? candidateAvoidMulti : getMultiSelectValue(candidateIntake, 'q_prefer_not_to_discuss').filter((s: string) => s !== 'Nothing in particular' && s !== 'Prefer not to say')
  const userAvoidText = getSingleSelectValue(userIntake, 'q_avoid_topics')
  const candidateAvoidText = getSingleSelectValue(candidateIntake, 'q_avoid_topics')

  const topicExcluded = (t: string) =>
    topicExcludedByPreferNot(t, userPreferNot, userAvoidText) || topicExcludedByPreferNot(t, candidatePreferNot, candidateAvoidText)

  // Shared interests from q_interests (no q_topics)
  const userInterests = getMultiSelectValue(userIntake, 'q_interests')
  const candidateInterests = getMultiSelectValue(candidateIntake, 'q_interests')
  const interestOverlap = userInterests.filter((i: string) => candidateInterests.includes(i) && i !== 'Prefer not to say')
  shared_interests.push(...interestOverlap.slice(0, 5))

  // Shared conversation preferences from q_what_makes_great_fika (exclude any marked in q_avoid_topics)
  const userGreatFikaForOverlap = getMultiSelectValue(userIntake, 'q_what_makes_great_fika')
  const candidateGreatFikaForOverlap = getMultiSelectValue(candidateIntake, 'q_what_makes_great_fika')
  const greatFikaOverlap = userGreatFikaForOverlap.filter((t: string) => candidateGreatFikaForOverlap.includes(t) && !topicExcluded(t))
  shared_interests.push(...greatFikaOverlap.slice(0, 3))

  const userLately = getMultiSelectValue(userIntake, 'q_lately')
  const candidateLately = getMultiSelectValue(candidateIntake, 'q_lately')
  const userCuriosity = getMultiSelectValue(userIntake, 'q_curiosity')
  const candidateCuriosity = getMultiSelectValue(candidateIntake, 'q_curiosity')
  const userAnchor = getMultiSelectValue(userIntake, 'q_everyday_anchor')
  const candidateAnchor = getMultiSelectValue(candidateIntake, 'q_everyday_anchor')
  const userLife = getMultiSelectValue(userIntake, 'q_life_chapter')
  const candidateLife = getMultiSelectValue(candidateIntake, 'q_life_chapter')

  const sharedLately = userLately.filter((l: string) => candidateLately.includes(l))
  const sharedCuriosity = userCuriosity.filter((c: string) => candidateCuriosity.includes(c))
  const sharedAnchor = userAnchor.filter((a: string) => candidateAnchor.includes(a))
  const sharedLife = userLife.filter((l: string) => candidateLife.includes(l))

  // Hoping for (q_hoping_for single-choice) + what makes a great Fika (q_what_makes_great_fika multi)
  const userHoping = getSingleSelectValue(userIntake, 'q_hoping_for')
  const candidateHoping = getSingleSelectValue(candidateIntake, 'q_hoping_for')
  const sameHoping = !!(userHoping && candidateHoping && userHoping.trim() === candidateHoping.trim())
  const hopingLabel = userHoping ?? null
  const userGreatFika = getMultiSelectValue(userIntake, 'q_what_makes_great_fika')
  const candidateGreatFika = getMultiSelectValue(candidateIntake, 'q_what_makes_great_fika')
  const sharedGreatFika = userGreatFika.filter((h: string) => candidateGreatFika.includes(h))

  const whyWeIntroducedYou: string[] = []
  if (sameHoping && hopingLabel) whyWeIntroducedYou.push(`You're both looking for: ${String(hopingLabel).trim()}`)
  if (sharedGreatFika.length > 0) whyWeIntroducedYou.push(`You both want: ${sharedGreatFika[0].toLowerCase()}`)
  for (const i of interestOverlap.slice(0, 2)) whyWeIntroducedYou.push(`You're both into ${i}`)
  for (const t of greatFikaOverlap.slice(0, 2)) whyWeIntroducedYou.push(`You both selected "${t}"`)
  for (const l of sharedLately.slice(0, 1)) whyWeIntroducedYou.push(`You both said "${l}" has been on your mind`)
  for (const a of sharedAnchor.slice(0, 1)) {
    if (a !== 'Prefer not to say') whyWeIntroducedYou.push(`You both have "${a}" in your everyday life`)
  }

  const conversationStarters: string[] = []
  if (sharedLately.length > 0) {
    const label = sharedLately[0]
    if (label === 'Purpose & meaning') conversationStarters.push(`You both mentioned purpose has been on your mind lately — What's something you've changed in your life recently because of that?`)
    else if (label === 'My career direction') conversationStarters.push(`You're both thinking about career direction — What's one thing you're trying to figure out right now?`)
    else if (label === 'Relationships & connection') conversationStarters.push(`You're both thinking about relationships and connection — What does community mean to you right now?`)
    else if (label === 'Creativity or a personal project') conversationStarters.push(`You're both in a creative or project headspace — What's something you're working on that excites you?`)
    else if (label === 'A big life decision') conversationStarters.push(`You're both weighing a big life decision — How do you usually approach big choices?`)
    else conversationStarters.push(`You both said "${label}" has been on your mind — What's one way that's showing up for you lately?`)
  }
  if (interestOverlap.length > 0 && conversationStarters.length < 3) {
    const topic = interestOverlap[0]
    if (topic === 'Travel') conversationStarters.push(`You both enjoy talking about travel — What place changed you more than you expected?`)
    else if (topic === 'Philosophy' || topic === 'History' || topic === 'Science') conversationStarters.push(`You both like going deep — What's a belief you've questioned recently?`)
    else if (topic === 'Entrepreneurship & startups') conversationStarters.push(`You both care about building and careers — What's one thing you've learned the hard way?`)
    else conversationStarters.push(`You're both into ${topic} — What got you into it?`)
  }
  if (conversationStarters.length < 2 && (sharedAnchor.includes('Creative projects') || interestOverlap.includes('Art & design') || interestOverlap.includes('Photography'))) {
    conversationStarters.push(`You both seem creatively wired — What's something you're currently working on that excites you?`)
  }
  if (conversationStarters.length < 2 && sharedLife.length > 0) {
    const life = sharedLife[0]
    if (life === "I'm exploring a new direction" || life === "I'm taking time to figure out what's next" || life === "Exploring what's next" || life === 'Starting over / reinventing') conversationStarters.push(`You're both in a chapter of change — What's something you've learned about yourself in the past year?`)
    else if (life === "I'm building something (startup, project, business)" || life === "I'm growing in my career" || life === 'Building something meaningful' || life === 'Growing professionally') conversationStarters.push(`You're both in a building phase — Has your definition of success changed recently?`)
  }
  if (conversationStarters.length < 2 && interestOverlap.length > 0) {
    conversationStarters.push(`You're both into ${interestOverlap[0]} — What do you like about it?`)
  }
  if (conversationStarters.length < 1 && interestOverlap.length > 0) {
    conversationStarters.push(`You're both into ${interestOverlap[0]} — What do you like about it?`)
  }

  const starters = conversationStarters.slice(0, 3)
  const whyBullets = whyWeIntroducedYou.slice(0, 4)

  return {
    whyWeIntroducedYou: whyBullets,
    sharedInterests: shared_interests.slice(0, 5),
    conversationHooks: starters,
    shared_interests: shared_interests.slice(0, 5),
    conversation_hooks: starters,
    user_a_hobbies: user_a_hobbies.slice(0, 5),
    user_a_talk_topics: user_a_talk_topics.slice(0, 4),
    user_a_interests: user_a_interests.slice(0, 6),
    user_b_hobbies: user_b_hobbies.slice(0, 5),
    user_b_talk_topics: user_b_talk_topics.slice(0, 4),
    user_b_interests: user_b_interests.slice(0, 6),
    candidateHobbies: user_b_hobbies.slice(0, 5),
    candidateTalkTopics: user_b_talk_topics.slice(0, 4),
    candidateInterests: user_b_interests.slice(0, 6),
    matchScore: 0
  }
}