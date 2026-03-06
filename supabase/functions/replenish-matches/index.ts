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

async function replenishAllUsers(supabaseClient: any) {
  const batchWeek = getBatchWeekMonday(new Date())
  // Get user IDs who opted in for this week's match run
  const { data: optIns, error: optInError } = await supabaseClient
    .from('weekly_match_opt_ins')
    .select('user_id')
    .eq('batch_week', batchWeek)

  if (optInError) throw optInError
  const optedInIds = (optIns || []).map((r: { user_id: string }) => r.user_id)
  if (optedInIds.length === 0) {
    console.log(`No users opted in for batch_week ${batchWeek}. Skipping replenish.`)
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
  const optedInIds = (optIns || []).map((r: { user_id: string }) => r.user_id).filter((id: string) => id !== userProfile.id)
  if (optedInIds.length === 0) {
    console.log('No other users opted in for this batch_week')
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
    }

    // Apply structured filters (availability, geography, gender preference, meetup format, first conversation feel)
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

    // Calculate compatibility score using embeddings + structured data
    const score = await calculateCompatibilityScoreV4(
      userProfile,
      userIntake,
      effectiveCandidateProfile,
      candidateIntake
    )

    console.log(`Score for ${candidate.id.substring(0, 8)}: ${score.toFixed(3)}`)

    // Generate match reasons with both users' info (bidirectional)
    // Pass both user names so hooks can use names for individual characteristics
    const reasons = await generateMatchReasonsV4(
      userIntake, 
      candidateIntake, 
      userProfile.id, 
      candidate.id,
      userProfile.first_name || 'You',
      candidate.first_name || 'They'
    )
    reasons.matchScore = score // Set the actual calculated score
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

function calculateCompatibilityScore(
  userProfile: UserProfile,
  userIntake: IntakeResponse,
  candidateProfile: UserProfile,
  candidateIntake: IntakeResponse
): number {
  let score = 0

  // Distance penalty (closer is better)
  if (userProfile.lat && userProfile.lng && candidateProfile.lat && candidateProfile.lng) {
    const distance = calculateDistance(
      userProfile.lat, userProfile.lng,
      candidateProfile.lat, candidateProfile.lng
    )
    const maxDistance = Math.max(userProfile.radius_km, candidateProfile.radius_km)
    if (distance > maxDistance) return 0 // Outside acceptable range
    
    score += Math.max(0, 1 - (distance / maxDistance)) * 0.2 // 20% weight
  }

  // Age compatibility (within reasonable range)
  if (userProfile.age && candidateProfile.age) {
    const ageDiff = Math.abs(userProfile.age - candidateProfile.age)
    score += Math.max(0, 1 - (ageDiff / 15)) * 0.1 // 10% weight
  }

  // Shared interests and activities
  const sharedActivities = calculateSharedInterests(userIntake, candidateIntake)
  score += sharedActivities * 0.3 // 30% weight

  // Complementary traits
  const complementarity = calculateComplementarity(userIntake, candidateIntake)
  score += complementarity * 0.2 // 20% weight

  // Social compatibility
  const socialFit = calculateSocialFit(userIntake, candidateIntake)
  score += socialFit * 0.2 // 20% weight

  return Math.min(1, score)
}

function calculateSharedInterests(userIntake: IntakeResponse, candidateIntake: IntakeResponse): number {
  const userActivities = new Set([
    ...(userIntake.sports_fitness || []),
    ...(userIntake.cultural_activities || []),
    ...(userIntake.fun_activities || [])
  ])
  
  const candidateActivities = new Set([
    ...(candidateIntake.sports_fitness || []),
    ...(candidateIntake.cultural_activities || []),
    ...(candidateIntake.fun_activities || [])
  ])

  const intersection = new Set([...userActivities].filter(x => candidateActivities.has(x)))
  const union = new Set([...userActivities, ...candidateActivities])

  return union.size > 0 ? intersection.size / union.size : 0
}

function calculateComplementarity(userIntake: IntakeResponse, candidateIntake: IntakeResponse): number {
  let complementarity = 0
  let factors = 0

  // Introvert/Extrovert balance
  if (userIntake.personality_type && candidateIntake.personality_type) {
    const userExtroversion = userIntake.personality_type.includes('extrovert') ? 1 : 0
    const candidateExtroversion = candidateIntake.personality_type.includes('extrovert') ? 1 : 0
    complementarity += Math.abs(userExtroversion - candidateExtroversion) * 0.5
    factors++
  }

  // Activity level balance
  if (userIntake.social_activity_level && candidateIntake.social_activity_level) {
    const levels = ['I prefer less frequent, lower-key meetups', 'A few quality hangouts each week is ideal', 'I love being busy with friends often']
    const userLevel = levels.indexOf(userIntake.social_activity_level)
    const candidateLevel = levels.indexOf(candidateIntake.social_activity_level)
    if (userLevel >= 0 && candidateLevel >= 0) {
      complementarity += 1 - (Math.abs(userLevel - candidateLevel) / 2)
      factors++
    }
  }

  return factors > 0 ? complementarity / factors : 0
}

function calculateSocialFit(userIntake: IntakeResponse, candidateIntake: IntakeResponse): number {
  let fit = 0
  let factors = 0

  // Hangout frequency compatibility
  if (userIntake.hangout_frequency && candidateIntake.hangout_frequency) {
    const frequencies = ['Once in a while', 'Weekly', 'A few times a week', 'Daily']
    const userFreq = frequencies.indexOf(userIntake.hangout_frequency)
    const candidateFreq = frequencies.indexOf(candidateIntake.hangout_frequency)
    if (userFreq >= 0 && candidateFreq >= 0) {
      fit += 1 - (Math.abs(userFreq - candidateFreq) / 3)
      factors++
    }
  }

  // Social setting preference
  if (userIntake.social_setting && candidateIntake.social_setting) {
    fit += userIntake.social_setting === candidateIntake.social_setting ? 1 : 0.5
    factors++
  }

  return factors > 0 ? fit / factors : 0
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

// Apply structured filters (LA Beta: no availability; geography, gender preference, convo feel, open to meet)
function passesStructuredFilters(
  userIntake: any,
  candidateIntake: any,
  userProfile: UserProfile,
  candidateProfile: UserProfile
): boolean {
  // Filter 1: Geography - within each other's max distance (each can travel their radius, so max distance = sum)
  if (
    userProfile.lat != null && userProfile.lng != null &&
    candidateProfile.lat != null && candidateProfile.lng != null
  ) {
    const distanceKm = calculateDistance(
      userProfile.lat, userProfile.lng,
      candidateProfile.lat, candidateProfile.lng
    )
    const totalMaxKm = (userProfile.radius_km ?? 40) + (candidateProfile.radius_km ?? 40)
    if (distanceKm > totalMaxKm) {
      console.log(`Geography filter: User ${userProfile.id.substring(0, 8)} and candidate ${candidateProfile.id.substring(0, 8)} are ${distanceKm.toFixed(0)} km apart (max ${totalMaxKm.toFixed(0)} km)`)
      return false
    }
  }

  // Filter 2: Gender preference - LA Beta: No preference / Same gender / Different gender
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

  // Filter 2.5: Age preference — when user prefers "around my age", require candidate within ±3 years
  const PREFER_AROUND_MY_AGE = 'Prefer around my age'
  if (
    userProfile.age_preference != null &&
    userProfile.age_preference.trim() === PREFER_AROUND_MY_AGE &&
    userProfile.age != null &&
    candidateProfile.age != null
  ) {
    const diff = Math.abs(userProfile.age - candidateProfile.age)
    if (diff > 3) {
      console.log(`Age filter: User prefers around own age; candidate age ${candidateProfile.age} is ${diff} years from user age ${userProfile.age}`)
      return false
    }
  }

  // Filter 3: What you're hoping for (q_hoping_for) - don't match "conversation only" with "actively looking for friends"
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

  // Filter 4: Who you're open to meet (q_openness) - compatibility
  const OPEN_TO_ANYONE = "I'm open to anyone"
  const INSTANTLY_RELATE = "Someone I'd instantly relate to"
  const userQOpen = getMultiSelectValue(userIntake, 'q_openness')
  const candidateQOpen = getMultiSelectValue(candidateIntake, 'q_openness')
  const hasOpenToAnyone = (opts: string[]) => opts.some((o: string) => o.trim() === OPEN_TO_ANYONE)
  const hasInstantlyRelate = (opts: string[]) => opts.some((o: string) => o.trim() === INSTANTLY_RELATE)
  const wantsSimilarOnly = (opts: string[]) => hasInstantlyRelate(opts) && !hasOpenToAnyone(opts)
  const aOkWithB = hasOpenToAnyone(userQOpen) || !wantsSimilarOnly(userQOpen) || (hasInstantlyRelate(candidateQOpen) || hasOpenToAnyone(candidateQOpen))
  const bOkWithA = hasOpenToAnyone(candidateQOpen) || !wantsSimilarOnly(candidateQOpen) || (hasInstantlyRelate(userQOpen) || hasOpenToAnyone(userQOpen))
  if (!aOkWithB || !bOkWithA) {
    console.log(`q_openness filter: compatibility failed`)
    return false
  }

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

// Helper functions to extract values from JSONB responses array
function getResponseValue(intake: any, questionId: string): any {
  if (!intake?.responses || !Array.isArray(intake.responses)) return null
  const response = intake.responses.find((r: any) => r.question_id === questionId)
  return response?.answer || null
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

// Helper: overlap score for multi-select (overlap / maxSelections)
function multiSelectOverlapScore(userValues: string[], candidateValues: string[]): number {
  if (userValues.length === 0 || candidateValues.length === 0) return 0
  const overlap = userValues.filter((v: string) => candidateValues.includes(v)).length
  const maxSelections = Math.max(userValues.length, candidateValues.length)
  return maxSelections > 0 ? overlap / maxSelections : 0
}

const OPEN_ENDED_IDS: string[] = []
// Stricter: need ~50 words across open-ended for full embedding weight (was 30)
const EMBEDDING_FULL_WORD_THRESHOLD = 50

function getOpenEndedWordCount(intake: any): number {
  if (!intake?.responses || !Array.isArray(intake.responses)) return 0
  const text = intake.responses
    .filter((r: any) => OPEN_ENDED_IDS.includes(r.question_id) && r.answer)
    .map((r: any) => String(r.answer).trim())
    .join(' ')
  return text.split(/\s+/).filter((w: string) => w.length > 0).length
}

// Calculate compatibility using embeddings + structured data (structured-only plan: embed q12 at 8%, rest explicit weights)
async function calculateCompatibilityScoreV4(
  userProfile: UserProfile,
  userIntake: any,
  candidateProfile: UserProfile,
  candidateIntake: any
): Promise<number> {
  let score = 0

  // Recalibrated: q_topics, q_interests, q_life_chapter, q_lately, q_everyday_anchor, q_openness, q_hoping_for, distance (no q_convo_feel)

  // 1. Topics (40% weight) - q_topics
  const userTalkAbout = getMultiSelectValue(userIntake, 'q_topics')
  const candidateTalkAbout = getMultiSelectValue(candidateIntake, 'q_topics')
  score += multiSelectOverlapScore(userTalkAbout, candidateTalkAbout) * 0.40

  // 2. Interests (8% weight) - q_interests
  const userInterests = getMultiSelectValue(userIntake, 'q_interests')
  const candidateInterests = getMultiSelectValue(candidateIntake, 'q_interests')
  score += multiSelectOverlapScore(userInterests, candidateInterests) * 0.08

  // 3. Life chapter (15% weight) - q_life_chapter
  const userLifeChapter = getMultiSelectValue(userIntake, 'q_life_chapter')
  const candidateLifeChapter = getMultiSelectValue(candidateIntake, 'q_life_chapter')
  score += multiSelectOverlapScore(userLifeChapter, candidateLifeChapter) * 0.15

  // 4. Lately (12% weight) - q_lately
  const userLately = getMultiSelectValue(userIntake, 'q_lately')
  const candidateLately = getMultiSelectValue(candidateIntake, 'q_lately')
  score += multiSelectOverlapScore(userLately, candidateLately) * 0.12

  // 5. Everyday anchor (8% weight) - q_everyday_anchor
  const userAnchor = getMultiSelectValue(userIntake, 'q_everyday_anchor')
  const candidateAnchor = getMultiSelectValue(candidateIntake, 'q_everyday_anchor')
  score += multiSelectOverlapScore(userAnchor, candidateAnchor) * 0.08

  // 6. Who open to meet (5% weight) - q_openness
  const userExcitedToMeet = getMultiSelectValue(userIntake, 'q_openness')
  const candidateExcitedToMeet = getMultiSelectValue(candidateIntake, 'q_openness')
  const openToAnyone = "I'm open to anyone"
  let openScore = 0.5 // neutral default
  if (!userExcitedToMeet.some((o: string) => o.trim() === openToAnyone) && !candidateExcitedToMeet.some((o: string) => o.trim() === openToAnyone)) {
    openScore = multiSelectOverlapScore(userExcitedToMeet, candidateExcitedToMeet)
  }
  score += openScore * 0.05

  // 7. Hoping for (4% weight) - q_hoping_for; same pill = full, else neutral
  const userHoping = getSingleSelectValue(userIntake, 'q_hoping_for')
  const candidateHoping = getSingleSelectValue(candidateIntake, 'q_hoping_for')
  if (userHoping && candidateHoping && userHoping.trim() === candidateHoping.trim()) {
    score += 0.04
  }

  // 8. Distance (8% weight)
  if (
    userProfile.lat != null && userProfile.lng != null &&
    candidateProfile.lat != null && candidateProfile.lng != null &&
    (userProfile.radius_km ?? 40) > 0
  ) {
    const distanceKm = calculateDistance(
      userProfile.lat, userProfile.lng,
      candidateProfile.lat, candidateProfile.lng
    )
    const totalMaxKm = (userProfile.radius_km ?? 40) + (candidateProfile.radius_km ?? 40)
    if (totalMaxKm > 0 && distanceKm <= totalMaxKm) {
      const distanceScore = Math.max(0, 1 - distanceKm / totalMaxKm)
      score += distanceScore * 0.08
    }
  }

  const final = Math.min(1, score)
  return isNaN(final) ? 0 : final
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

// Map q_prefer_not_to_discuss pills to q_topics labels we might show in reasons (avoid suggesting these)
const PREFER_NOT_TO_TOPIC_MAP: Record<string, string[]> = {
  'Politics': ['Current events & global affairs'],
  'Religion': ['Religion & spirituality'],
  'Work & career': ['Career journeys', 'Entrepreneurship & building things'],
  'Relationship status': ['Relationships & modern dating'],
  'Health': ['Mental health & emotional growth'],
  'Personal finances': [],
}

function topicExcludedByPreferNot(topic: string, preferNot: string[]): boolean {
  if (!preferNot || preferNot.length === 0) return false
  const excludeLabels = new Set<string>()
  for (const p of preferNot) {
    const mapped = PREFER_NOT_TO_TOPIC_MAP[p?.trim() ?? '']
    if (mapped) mapped.forEach((l: string) => excludeLabels.add(l))
  }
  return excludeLabels.has(topic)
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

  // Extract user A's information (LA Beta intake)
  user_a_hobbies.push(...getMultiSelectValue(userAIntake, 'q_topics').slice(0, 5))
  user_a_talk_topics.push(...getMultiSelectValue(userAIntake, 'q_openness').slice(0, 4))
  user_a_interests.push(...getMultiSelectValue(userAIntake, 'q_interests').slice(0, 6))

  // Extract user B's information (LA Beta intake)
  user_b_hobbies.push(...getMultiSelectValue(userBIntake, 'q_topics').slice(0, 5))
  user_b_talk_topics.push(...getMultiSelectValue(userBIntake, 'q_openness').slice(0, 4))
  user_b_interests.push(...getMultiSelectValue(userBIntake, 'q_interests').slice(0, 6))

  // Prefer not to discuss: exclude these topics from reasons/starters
  const userPreferNot = getMultiSelectValue(userIntake, 'q_prefer_not_to_discuss').filter((s: string) => s !== 'Nothing in particular' && s !== 'Prefer not to say')
  const candidatePreferNot = getMultiSelectValue(candidateIntake, 'q_prefer_not_to_discuss').filter((s: string) => s !== 'Nothing in particular' && s !== 'Prefer not to say')

  // Shared interests from topic overlap (only topics neither marked prefer-not-to-discuss)
  const userTalk = getMultiSelectValue(userIntake, 'q_topics')
  const candidateTalk = getMultiSelectValue(candidateIntake, 'q_topics')
  const overlap = userTalk.filter((t: string) => candidateTalk.includes(t) && !topicExcludedByPreferNot(t, userPreferNot) && !topicExcludedByPreferNot(t, candidatePreferNot))
  shared_interests.push(...overlap.slice(0, 5))

  // Shared interests from q_interests (activities/hobbies)
  const userInterests = getMultiSelectValue(userIntake, 'q_interests')
  const candidateInterests = getMultiSelectValue(candidateIntake, 'q_interests')
  const interestOverlap = userInterests.filter((i: string) => candidateInterests.includes(i) && i !== 'Prefer not to say')
  shared_interests.push(...interestOverlap.slice(0, 3))

  const userLately = getMultiSelectValue(userIntake, 'q_lately')
  const candidateLately = getMultiSelectValue(candidateIntake, 'q_lately')
  const userAnchor = getMultiSelectValue(userIntake, 'q_everyday_anchor')
  const candidateAnchor = getMultiSelectValue(candidateIntake, 'q_everyday_anchor')
  const userLife = getMultiSelectValue(userIntake, 'q_life_chapter')
  const candidateLife = getMultiSelectValue(candidateIntake, 'q_life_chapter')

  const sharedLately = userLately.filter((l: string) => candidateLately.includes(l))
  const sharedAnchor = userAnchor.filter((a: string) => candidateAnchor.includes(a))
  const sharedLife = userLife.filter((l: string) => candidateLife.includes(l))

  // Hoping for (same pill) - add to reasons
  const userHoping = getSingleSelectValue(userIntake, 'q_hoping_for')
  const candidateHoping = getSingleSelectValue(candidateIntake, 'q_hoping_for')
  const sameHoping = userHoping && candidateHoping && userHoping.trim() === candidateHoping.trim()

  const whyWeIntroducedYou: string[] = []
  if (sameHoping && userHoping) whyWeIntroducedYou.push(`You're both looking for: ${userHoping.trim()}`)
  for (const t of overlap.slice(0, 2)) whyWeIntroducedYou.push(`You both selected "${t}"`)
  for (const l of sharedLately.slice(0, 1)) whyWeIntroducedYou.push(`You both said "${l}" has been on your mind`)
  for (const a of sharedAnchor.slice(0, 1)) {
    if (a !== 'Prefer not to say') whyWeIntroducedYou.push(`You both have "${a}" in your everyday life`)
  }
  for (const i of interestOverlap.slice(0, 2)) whyWeIntroducedYou.push(`You're both into ${i}`)

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
  if (overlap.length > 0 && conversationStarters.length < 3) {
    const topic = overlap[0]
    if (topic === 'Travel & different cultures') conversationStarters.push(`You both enjoy talking about travel — What place changed you more than you expected?`)
    else if (topic === 'Psychology & human behavior' || topic === 'Philosophy & big questions') conversationStarters.push(`You both like going deep — What's a belief you've questioned recently?`)
    else if (topic === 'Career journeys' || topic === 'Entrepreneurship & building things') conversationStarters.push(`You both care about building and careers — What's one thing you've learned the hard way?`)
    else conversationStarters.push(`You both enjoy ${topic} — What got you into it?`)
  }
  if (conversationStarters.length < 2 && (sharedAnchor.includes('A creative pursuit') || overlap.includes('Visual art & design'))) {
    conversationStarters.push(`You both seem creatively wired — What's something you're currently working on that excites you?`)
  }
  if (conversationStarters.length < 2 && sharedLife.length > 0) {
    const life = sharedLife[0]
    if (life === "Exploring what's next" || life === 'Starting over / reinventing') conversationStarters.push(`You're both in a chapter of change — What's something you've learned about yourself in the past year?`)
    else if (life === 'Building something meaningful' || life === 'Growing professionally') conversationStarters.push(`You're both in a building phase — Has your definition of success changed recently?`)
  }
  if (conversationStarters.length < 2 && interestOverlap.length > 0) {
    conversationStarters.push(`You're both into ${interestOverlap[0]} — What do you like about it?`)
  }
  if (conversationStarters.length < 1 && overlap.length > 0) {
    conversationStarters.push(`You both enjoy ${overlap[0]} — What got you into it?`)
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