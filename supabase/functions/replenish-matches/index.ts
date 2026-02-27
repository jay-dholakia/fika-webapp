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
  }

  // Find potential matches - get enough candidates to fill up to 5 matches (only from users opted in for this week)
  const potentialMatches = await findPotentialMatches(
    supabaseClient,
    effectiveUserProfile,
    userIntake,
    batchWeek,
    50 // Get top 50 candidates to ensure we have enough above threshold
  )

  console.log(`Found ${potentialMatches.length} potential matches for user ${userId.substring(0, 8)}`)

  // Create match candidates
  // Only create matches above 0.35 threshold
  const MATCH_SCORE_THRESHOLD = 0.35
  const MAX_MATCHES = 5
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
        await createMatchCandidate(supabaseClient, userId, match.id, match.score, match.reasons, batchWeek)
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

  // Get potential matches: in bowl, active, and opted in for this week
  const { data: potentialUsers, error: usersError } = await supabaseClient
    .from('profiles')
    .select('*')
    .eq('in_match_bowl', true)
    .eq('is_active', true)
    .in('id', optedInIds)

  if (usersError) throw usersError

  console.log(`Found ${potentialUsers?.length || 0} potential users to match against`)

  const scoredMatches = []

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

function generateMatchReasons(userIntake: IntakeResponse, candidateIntake: IntakeResponse) {
  const shared_interests = []
  const conversation_hooks = []

  // Find shared activities
  const userActivities = [
    ...(userIntake.sports_fitness || []),
    ...(userIntake.cultural_activities || []),
    ...(userIntake.fun_activities || [])
  ]
  
  const candidateActivities = [
    ...(candidateIntake.sports_fitness || []),
    ...(candidateIntake.cultural_activities || []),
    ...(candidateIntake.fun_activities || [])
  ]

  for (const activity of userActivities) {
    if (candidateActivities.includes(activity)) {
      shared_interests.push(activity)
    }
  }

  // Generate conversation hooks
  if (userIntake.coffee_or_tea && candidateIntake.coffee_or_tea) {
    if (userIntake.coffee_or_tea === candidateIntake.coffee_or_tea) {
      conversation_hooks.push(`${userIntake.coffee_or_tea} lovers`)
    }
  }

  if (userIntake.favorite_cuisines && candidateIntake.favorite_cuisines) {
    const sharedCuisines = userIntake.favorite_cuisines.filter((c: string) => 
      candidateIntake.favorite_cuisines.includes(c)
    )
    if (sharedCuisines.length > 0) {
      conversation_hooks.push(`${sharedCuisines[0]} food fans`)
    }
  }

  return {
    shared_interests: shared_interests.slice(0, 3),
    conversation_hooks: conversation_hooks.slice(0, 3),
    complementary_traits: []
  }
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
  batchWeek: string
) {
  // Ensure consistent ordering (user_a < user_b per constraint)
  const orderedUserA = userA < userB ? userA : userB
  const orderedUserB = userA < userB ? userB : userA

  // Use upsert to avoid duplicate key errors
  // Try insert first, then update if conflict
  const { data: insertData, error: insertError } = await supabaseClient
    .from('match_candidates')
    .insert({
      user_a: orderedUserA,
      user_b: orderedUserB,
      score,
      reasons,
      status: 'active',
      batch_week: batchWeek,
      expires_at: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString() // 72 hours
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
          expires_at: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString()
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

// Apply structured filters (no age filter; we no longer intake age)
function passesStructuredFilters(
  userIntake: any,
  candidateIntake: any,
  userProfile: UserProfile,
  candidateProfile: UserProfile
): boolean {
  // Filter 1: Availability overlap - require at least one shared slot
  const userTimes = getAvailabilityTimes(userIntake)
  const candidateTimes = getAvailabilityTimes(candidateIntake)
  if (userTimes.length > 0 && candidateTimes.length > 0) {
    const hasOverlap = userTimes.some((t: string) => candidateTimes.includes(t))
    if (!hasOverlap) {
      console.log(`Availability filter: No overlapping availability between user and candidate`)
      return false
    }
  }

  // Filter 2: Geography - within each other's max distance (each can travel their radius, so max distance = sum)
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

  // Filter 3: Gender preference - mutual compatibility (each person's gender must be in the other's preference)
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

    const preferenceAllowsGender = (pref: string, gender: string): boolean => {
      if (pref === 'no preference') return true
      if (pref.includes('women') && (gender === 'woman' || gender === 'women')) return true
      if (pref.includes('men') && (gender === 'man' || gender === 'men')) return true
      if (pref.includes('non-binary') && (gender === 'non-binary' || gender === 'nonbinary')) return true
      return false
    }

    if (!preferenceAllowsGender(candidatePref, userGenderNorm)) {
      console.log(`Gender filter: Candidate ${candidateProfile.id.substring(0, 8)} preference "${candidateProfile.gender_preference}" does not include user gender "${userProfile.gender}"`)
      return false
    }
    if (!preferenceAllowsGender(userPref, candidateGenderNorm)) {
      console.log(`Gender filter: User ${userProfile.id.substring(0, 8)} preference "${userProfile.gender_preference}" does not include candidate gender "${candidateProfile.gender}"`)
      return false
    }
  }

  // Filter 4: Meetup format - at least one overlapping format (q4_where_most_yourself)
  const userFormats = getMultiSelectValue(userIntake, 'q4_where_most_yourself')
  const candidateFormats = getMultiSelectValue(candidateIntake, 'q4_where_most_yourself')
  if (userFormats.length > 0 && candidateFormats.length > 0) {
    const formatOverlap = userFormats.some((f: string) => candidateFormats.includes(f))
    if (!formatOverlap) {
      console.log(`Meetup format filter: No overlapping format between user and candidate`)
      return false
    }
  }

  // Filter 5: First conversation feel - at least one overlapping preference (q10_first_conversation_feel)
  const userFeel = getMultiSelectValue(userIntake, 'q10_first_conversation_feel')
  const candidateFeel = getMultiSelectValue(candidateIntake, 'q10_first_conversation_feel')
  if (userFeel.length > 0 && candidateFeel.length > 0) {
    const feelOverlap = userFeel.some((f: string) => candidateFeel.includes(f))
    if (!feelOverlap) {
      console.log(`First conversation feel filter: No overlapping preference between user and candidate`)
      return false
    }
  }

  // Filter 6: Who you're open to meet (q6_who_excited_to_meet) - compatibility, not overlap
  // "I'm open to anyone" = compatible with all. Difference-seeking = compatible with all.
  // "Someone I'd instantly relate to" (without "open to anyone") = other must have "instantly relate" OR "open to anyone".
  const OPEN_TO_ANYONE = "I'm open to anyone"
  const INSTANTLY_RELATE = "Someone I'd instantly relate to"
  const userQ6 = getMultiSelectValue(userIntake, 'q6_who_excited_to_meet')
  const candidateQ6 = getMultiSelectValue(candidateIntake, 'q6_who_excited_to_meet')
  const hasOpenToAnyone = (opts: string[]) => opts.some((o: string) => o.trim() === OPEN_TO_ANYONE)
  const hasInstantlyRelate = (opts: string[]) => opts.some((o: string) => o.trim() === INSTANTLY_RELATE)
  const wantsSimilarOnly = (opts: string[]) => hasInstantlyRelate(opts) && !hasOpenToAnyone(opts)
  const aOkWithB = hasOpenToAnyone(userQ6) || !wantsSimilarOnly(userQ6) || (hasInstantlyRelate(candidateQ6) || hasOpenToAnyone(candidateQ6))
  const bOkWithA = hasOpenToAnyone(candidateQ6) || !wantsSimilarOnly(candidateQ6) || (hasInstantlyRelate(userQ6) || hasOpenToAnyone(userQ6))
  if (!aOkWithB || !bOkWithA) {
    console.log(`q6 filter: Who you're open to meet - compatibility failed (user wants similar but candidate doesn't signal relate/open, or vice versa)`)
    return false
  }

  // Filter 7: q15 political/social - don't match "avoid" with "actively enjoy"
  const Q15_AVOID = "I'd rather avoid political topics altogether"
  const Q15_ACTIVELY_ENJOY = "I actively enjoy discussing politics and current events"
  const userQ15 = getSingleSelectValue(userIntake, 'q15_political_social')
  const candidateQ15 = getSingleSelectValue(candidateIntake, 'q15_political_social')
  if (userQ15 && candidateQ15) {
    const u = userQ15.trim()
    const c = candidateQ15.trim()
    if ((u === Q15_AVOID && c === Q15_ACTIVELY_ENJOY) || (u === Q15_ACTIVELY_ENJOY && c === Q15_AVOID)) {
      console.log(`q15 filter: Political/social conversation preference mismatch (avoid vs actively enjoy)`)
      return false
    }
  }

  // Filter 8: q13 country belief - don't match "Moving in the right direction" with "In need of major change"
  const Q13_RIGHT_DIRECTION = "Moving in the right direction"
  const Q13_MAJOR_CHANGE = "In need of major change"
  const userQ13 = getSingleSelectValue(userIntake, 'q13_country_belief')
  const candidateQ13 = getSingleSelectValue(candidateIntake, 'q13_country_belief')
  if (userQ13 && candidateQ13) {
    const u = userQ13.trim()
    const c = candidateQ13.trim()
    if ((u === Q13_RIGHT_DIRECTION && c === Q13_MAJOR_CHANGE) || (u === Q13_MAJOR_CHANGE && c === Q13_RIGHT_DIRECTION)) {
      console.log(`q13 filter: Country belief mismatch (moving in the right direction vs in need of major change)`)
      return false
    }
  }

  return true
}

function getAvailabilityTimes(intake: any): string[] {
  const fromColumn = intake?.availability_times
  if (Array.isArray(fromColumn) && fromColumn.length > 0) return fromColumn
  return getMultiSelectValue(intake, 'q9_availability')
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

// Travel distance: intake only (q8_distance_miles), default 40 km (~25 miles)
function getIntakeRadiusKm(intake: any): number {
  const miles = getIntakeNumericValue(intake, 'q8_distance_miles')
  return miles != null ? Math.round(miles * 1.60934) : 40
}

// Helper: overlap score for multi-select (overlap / maxSelections)
function multiSelectOverlapScore(userValues: string[], candidateValues: string[]): number {
  if (userValues.length === 0 || candidateValues.length === 0) return 0
  const overlap = userValues.filter((v: string) => candidateValues.includes(v)).length
  const maxSelections = Math.max(userValues.length, candidateValues.length)
  return maxSelections > 0 ? overlap / maxSelections : 0
}

const OPEN_ENDED_IDS = ['q12_first_conversation']
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

  // 1. Embedding similarity (8% max) - q12 only; only when both have substantive open-ended text (avoid constant "No open-ended answers" inflation)
  const userVec = ensureEmbedVector(userIntake.embed_vector)
  const candidateVec = ensureEmbedVector(candidateIntake.embed_vector)
  const EMBED_WEIGHT = 0.08
  if (userVec && candidateVec) {
    const userWords = getOpenEndedWordCount(userIntake)
    const candidateWords = getOpenEndedWordCount(candidateIntake)
    const userFactor = Math.min(1, userWords / EMBEDDING_FULL_WORD_THRESHOLD)
    const candidateFactor = Math.min(1, candidateWords / EMBEDDING_FULL_WORD_THRESHOLD)
    const combinedFactor = Math.min(userFactor, candidateFactor)
    if (combinedFactor > 0) {
      const embeddingSimilarity = cosineSimilarity(userVec, candidateVec)
      score += embeddingSimilarity * EMBED_WEIGHT * combinedFactor
    }
  }

  // 2. Topics (32% weight) - q5_talk_about (main driver for conversation fit)
  const userTalkAbout = getMultiSelectValue(userIntake, 'q5_talk_about')
  const candidateTalkAbout = getMultiSelectValue(candidateIntake, 'q5_talk_about')
  score += multiSelectOverlapScore(userTalkAbout, candidateTalkAbout) * 0.32

  // 3. First conversation feel (14% weight) - q10_first_conversation_feel (prioritized over life chapter)
  const userFirstFeel = getMultiSelectValue(userIntake, 'q10_first_conversation_feel')
  const candidateFirstFeel = getMultiSelectValue(candidateIntake, 'q10_first_conversation_feel')
  score += multiSelectOverlapScore(userFirstFeel, candidateFirstFeel) * 0.14

  // 4. Life chapter (10% weight) - q2_life_chapter
  const userLifeChapter = getMultiSelectValue(userIntake, 'q2_life_chapter')
  const candidateLifeChapter = getMultiSelectValue(candidateIntake, 'q2_life_chapter')
  score += multiSelectOverlapScore(userLifeChapter, candidateLifeChapter) * 0.10

  // 5. Meetup format (7% weight) - q4_where_most_yourself
  const userMeetupFormat = getMultiSelectValue(userIntake, 'q4_where_most_yourself')
  const candidateMeetupFormat = getMultiSelectValue(candidateIntake, 'q4_where_most_yourself')
  score += multiSelectOverlapScore(userMeetupFormat, candidateMeetupFormat) * 0.07

  // 6. Who excited to meet (6% weight) - q6_who_excited_to_meet
  const userExcitedToMeet = getMultiSelectValue(userIntake, 'q6_who_excited_to_meet')
  const candidateExcitedToMeet = getMultiSelectValue(candidateIntake, 'q6_who_excited_to_meet')
  const openToAnyone = "I'm open to anyone"
  let q6Score = 0.5 // neutral default
  if (!userExcitedToMeet.some((o: string) => o.trim() === openToAnyone) && !candidateExcitedToMeet.some((o: string) => o.trim() === openToAnyone)) {
    q6Score = multiSelectOverlapScore(userExcitedToMeet, candidateExcitedToMeet)
  }
  score += q6Score * 0.06

  // 7. Distance (6% weight) - closer is better among those who pass geography filter
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
      score += distanceScore * 0.06
    }
  }

  // 8. Work/study (5% weight) - q3_work_or_study
  const userWorkStudy = getSingleSelectValue(userIntake, 'q3_work_or_study')
  const candidateWorkStudy = getSingleSelectValue(candidateIntake, 'q3_work_or_study')
  if (userWorkStudy && candidateWorkStudy) {
    score += (userWorkStudy.trim() === candidateWorkStudy.trim() ? 1 : 0.3) * 0.05
  }

  // 9. Profession / university / major (4% weight) - same industry, same school, or same major
  const userProfession = getSingleSelectValue(userIntake, 'q3_profession')
  const candidateProfession = getSingleSelectValue(candidateIntake, 'q3_profession')
  const userUniversity = getSingleSelectValue(userIntake, 'q3_university')
  const candidateUniversity = getSingleSelectValue(candidateIntake, 'q3_university')
  const userMajor = getSingleSelectValue(userIntake, 'q3_major')
  const candidateMajor = getSingleSelectValue(candidateIntake, 'q3_major')
  const workSchoolMatch =
    (userProfession && candidateProfession && userProfession.trim() === candidateProfession.trim()) ||
    (userUniversity && candidateUniversity && userUniversity.trim() === candidateUniversity.trim()) ||
    (userMajor && candidateMajor && userMajor.trim() === candidateMajor.trim())
  if (workSchoolMatch) score += 0.04

  // 10. q15 political/social (4% weight) - compatibility; avoid vs actively enjoy already filtered
  const userQ15 = getSingleSelectValue(userIntake, 'q15_political_social')
  const candidateQ15 = getSingleSelectValue(candidateIntake, 'q15_political_social')
  if (userQ15 && candidateQ15) {
    const u = userQ15.trim()
    const c = candidateQ15.trim()
    if (u === c) {
      score += 0.04
    } else {
      // Adjacent: open to it / prefer non-political are compatible; give partial
      const opts = ["I actively enjoy discussing politics and current events", "I'm open to it if it comes up", "I prefer keeping conversations non-political", "I'd rather avoid political topics altogether"]
      const i = opts.indexOf(u)
      const j = opts.indexOf(c)
      if (i >= 0 && j >= 0 && Math.abs(i - j) === 1) score += 0.02
    }
  }

  // 11. q13 country belief (2% weight) - same = full; adjacent in order = partial; Filter 8 blocks right direction vs major change
  const userQ13 = getSingleSelectValue(userIntake, 'q13_country_belief')
  const candidateQ13 = getSingleSelectValue(candidateIntake, 'q13_country_belief')
  if (userQ13 && candidateQ13) {
    const u = userQ13.trim()
    const c = candidateQ13.trim()
    if (u === c) {
      score += 0.02
    } else {
      const opts = ['Moving in the right direction', 'In need of major change', 'More stable than people think', 'Hard to define in one sentence', 'Prefer not to say']
      const i = opts.indexOf(u)
      const j = opts.indexOf(c)
      if (i >= 0 && j >= 0 && Math.abs(i - j) === 1) score += 0.01
    }
  }

  // 12. q14 societal discussion (2% weight) - compatibility
  const userQ14 = getSingleSelectValue(userIntake, 'q14_societal_discussion')
  const candidateQ14 = getSingleSelectValue(candidateIntake, 'q14_societal_discussion')
  if (userQ14 && candidateQ14) {
    const u = userQ14.trim()
    const c = candidateQ14.trim()
    score += (u === c ? 0.02 : 0.01) // same = full; different but both answered = small
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

  // Extract user A's information (V6 intake)
  user_a_hobbies.push(...getMultiSelectValue(userAIntake, 'q5_talk_about').slice(0, 5))
  user_a_talk_topics.push(...getMultiSelectValue(userAIntake, 'q6_who_excited_to_meet').slice(0, 4))
  const userAOpenEnded = (userAIntake?.responses || []).filter((r: any) =>
    r.question_id === 'q12_first_conversation'
  )
  if (userAOpenEnded.length > 0) {
    user_a_interests.push(...Array.from(extractKeywords(userAOpenEnded)).slice(0, 4))
  }

  // Extract user B's information (V6 intake)
  user_b_hobbies.push(...getMultiSelectValue(userBIntake, 'q5_talk_about').slice(0, 5))
  user_b_talk_topics.push(...getMultiSelectValue(userBIntake, 'q6_who_excited_to_meet').slice(0, 4))
  const userBOpenEnded = (userBIntake?.responses || []).filter((r: any) =>
    r.question_id === 'q12_first_conversation'
  )
  if (userBOpenEnded.length > 0) {
    user_b_interests.push(...Array.from(extractKeywords(userBOpenEnded)).slice(0, 4))
  }

  // Extract shared interests from open-ended responses (keyword-based) - only q12 now
  const openEndedIdsForKeywords = ['q12_first_conversation']
  if (userIntake.responses && candidateIntake.responses) {
    const userOpenEnded = (userIntake.responses as any[]).filter((r: any) => openEndedIdsForKeywords.includes(r.question_id))
    const candidateOpenEnded = (candidateIntake.responses as any[]).filter((r: any) => openEndedIdsForKeywords.includes(r.question_id))
    const userKeywords = extractKeywords(userOpenEnded)
    const candidateKeywords = extractKeywords(candidateOpenEnded)
    const sharedKeywords = [...userKeywords].filter(k => candidateKeywords.has(k))
    shared_interests.push(...sharedKeywords.slice(0, 5))
  }

  // Generate comprehensive conversation hooks using OpenAI
  // This analyzes all open-ended responses to find deeper commonalities
  try {
    // Safe string from any answer type (string, array, number)
    function answerToText(answer: unknown): string {
      if (answer == null) return ''
      if (typeof answer === 'string') return answer.trim()
      if (Array.isArray(answer)) return answer.map((a: any) => String(a).trim()).filter(Boolean).join(', ').trim()
      return String(answer).trim()
    }

    // V6 open-ended: only q12_first_conversation (work/study detail no longer free text)
    const openEndedQuestionIds = ['q12_first_conversation']

    // Collect all open-ended responses from both users (skip empty or N/A)
    const userResponses: Record<string, string> = {}
    const candidateResponses: Record<string, string> = {}

    if (userIntake.responses && Array.isArray(userIntake.responses)) {
      openEndedQuestionIds.forEach(qId => {
        const response = userIntake.responses.find((r: any) => r.question_id === qId)
        if (response?.answer != null) {
          const text = answerToText(response.answer)
          if (text.length > 0 && text !== 'N/A') userResponses[qId] = text
        }
      })
    }

    if (candidateIntake.responses && Array.isArray(candidateIntake.responses)) {
      openEndedQuestionIds.forEach(qId => {
        const response = candidateIntake.responses.find((r: any) => r.question_id === qId)
        if (response?.answer != null) {
          const text = answerToText(response.answer)
          if (text.length > 0 && text !== 'N/A') candidateResponses[qId] = text
        }
      })
    }

    // Call OpenAI when we have at least one substantive open-ended from each (only q12 now)
    if (Object.keys(userResponses).length >= 1 && Object.keys(candidateResponses).length >= 1) {
      const openaiApiKey = Deno.env.get('OPENAI_API_KEY')
      console.log(`OpenAI API key present: ${!!openaiApiKey}, User responses: ${Object.keys(userResponses).length}, Candidate responses: ${Object.keys(candidateResponses).length}`)
      if (openaiApiKey) {
        const prompt = `You are analyzing two people's questionnaire responses to identify meaningful, insightful connections that would make them want to have a conversation. Go beyond surface-level similarities - look for deeper patterns, shared values, complementary perspectives, or interesting contrasts that spark curiosity.

${userName}'s responses:
${Object.entries(userResponses).map(([qId, answer]) => {
  const questionText = userIntake.responses.find((r: any) => r.question_id === qId)?.question_text || qId;
  return `- ${questionText}: ${answer}`;
}).join('\n\n')}

${candidateName}'s responses:
${Object.entries(candidateResponses).map(([qId, answer]) => {
  const questionText = candidateIntake.responses.find((r: any) => r.question_id === qId)?.question_text || qId;
  return `- ${questionText}: ${answer}`;
}).join('\n\n')}

Generate 3-5 conversation hooks that are:
1. INSIGHTFUL and SPECIFIC - reveal something interesting about their connection, not just "you both like X"
2. DEEP and MEANINGFUL - focus on values, perspectives, life experiences, or complementary traits
3. CONVERSATION-STARTERS - things that would naturally lead to engaging discussions
4. 15-30 words each - enough detail to be interesting, not just surface-level

CRITICAL FORMATTING RULES:
- For SHARED/COMMON things: Start with "You both..." and NEVER include names in that phrase
- For INDIVIDUAL characteristics: Use names "${userName}" and "${candidateName}" when describing how each person differs
- NEVER say "You both [name] and [name] both" - this is grammatically incorrect
- If describing a shared trait with individual variations, use: "You both [shared trait], with ${userName} [their way] and ${candidateName} [their way]"

Look for:
- Shared values or worldviews (not just hobbies)
- Similar life experiences or challenges
- Complementary interests or perspectives
- Interesting contrasts that create curiosity
- What they're excited about or working toward
- How they approach life, relationships, or growth

BAD examples (grammatically incorrect or too generic):
- "You both chris and jay both value..." (WRONG - redundant "both")
- "You both love music and travel" (too generic)
- "You both are students" (too generic)

GOOD examples (insightful and grammatically correct):
- "You both are in transition phases, which could lead to interesting conversations about navigating change and figuring out what's next."
- "You both value authenticity and meaningful connections, with ${userName} finding it through creative expression and ${candidateName} through deep conversations about ideas."
- "You both are curious about the world, which could spark conversations about how you each explore new perspectives and learn from different experiences."

Return ONLY the hooks, one per line, no numbering or bullets. Each hook should be a complete, thoughtful sentence (15-30 words). Start shared traits with "You both" and never include names in that opening phrase.

Hooks:`

        const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openaiApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
              {
                role: 'system',
                content: 'You are an expert at identifying deep, meaningful connections between people. You go beyond surface similarities to find shared values, complementary perspectives, and insights that spark genuine curiosity and conversation. Your hooks are specific, thoughtful, and reveal something interesting about how two people might connect.'
              },
              {
                role: 'user',
                content: prompt
              }
            ],
            temperature: 0.8,
            max_tokens: 500,
          }),
        })

        if (openaiResponse.ok) {
          const data = await openaiResponse.json()
          const generatedHooks = data.choices?.[0]?.message?.content || ''
          
          // Parse the response into individual hooks
          const hooks = generatedHooks
            .split('\n')
            .map((line: string) => line.trim())
            .filter((line: string) => line.length > 0 && !line.match(/^(Hooks?:|^\d+[\.\)])/i))
            .map((hook: string) => {
              // Replace any "Person A" or "Person B" references with "you"
              return hook
                .replace(/Person A/gi, 'you')
                .replace(/Person B/gi, 'you')
                .replace(/person a/gi, 'you')
                .replace(/person b/gi, 'you')
                .replace(/\bA\b/g, 'you') // Replace standalone "A" (context-dependent, but safer)
                .replace(/\bB\b/g, 'you') // Replace standalone "B" (context-dependent, but safer)
            })
            .slice(0, 5) // Take up to 5 hooks

          conversation_hooks.push(...hooks)
          console.log(`Generated ${hooks.length} conversation hooks from OpenAI`)
        } else {
          const errorText = await openaiResponse.text()
          console.error('OpenAI API error:', openaiResponse.status, errorText)
        }
      } else {
        console.log('OpenAI API key not found in environment variables')
      }
    } else {
      console.log(`Skipping OpenAI - insufficient responses: User=${Object.keys(userResponses).length}, Candidate=${Object.keys(candidateResponses).length}`)
    }
  } catch (error) {
    console.error('Error generating conversation hooks with OpenAI:', error)
    // Fallback will be handled below
  }

  // Fallback: If we didn't get enough hooks from OpenAI, create from structured data (no q1; use q5, q10, q2)
  if (conversation_hooks.length < 2) {
    // First conversation feel overlap (q10_first_conversation_feel)
    const userFeel = getMultiSelectValue(userIntake, 'q10_first_conversation_feel')
    const candidateFeel = getMultiSelectValue(candidateIntake, 'q10_first_conversation_feel')
    const sharedFeel = userFeel.filter((f: string) => candidateFeel.includes(f))
    if (sharedFeel.length > 0 && conversation_hooks.length < 3) {
      const f = sharedFeel[0]
      if (f.includes('Light') || f.includes('easy')) {
        conversation_hooks.push(`You both are open to light, easy conversation, which suggests you value genuine connection and relaxed interactions.`)
      } else if (f.includes('Thoughtful') || f.includes('reflective')) {
        conversation_hooks.push(`You both enjoy thoughtful, reflective conversation, indicating you like diving into ideas and meaningful topics.`)
      } else if (f.includes('Curious') || f.includes('exploratory')) {
        conversation_hooks.push(`You both like curious, exploratory conversation, which could lead to interesting exchanges and new perspectives.`)
      } else if (f.includes('Deep dive') || f.includes('one topic')) {
        conversation_hooks.push(`You both enjoy deep dives into a topic, suggesting you value focused, in-depth conversation.`)
      } else if (f.includes('mix') || f.includes('see where')) {
        conversation_hooks.push(`You both are open to going where the conversation leads, which could make for natural and varied chats.`)
      }
    }

    // Life chapter overlap (q2_life_chapter) - current option labels
    const userLifeChapter = getMultiSelectValue(userIntake, 'q2_life_chapter')
    const candidateLifeChapter = getMultiSelectValue(candidateIntake, 'q2_life_chapter')
    const sharedLifeChapter = userLifeChapter.filter((t: string) => candidateLifeChapter.includes(t))
    if (sharedLifeChapter.length > 0 && conversation_hooks.length < 3) {
      const focus = sharedLifeChapter[0]
      if (focus === 'Building something meaningful' || focus === 'Growing professionally') {
        conversation_hooks.push(`You both focus on building and growth, which could lead to interesting conversations about goals and what you're working toward.`)
      } else if (focus === 'Raising a family' || focus === 'Supporting family members') {
        conversation_hooks.push(`You both are in a family-focused chapter, suggesting you might connect over shared values around relationships and priorities.`)
      } else if (focus === 'Starting over / reinventing' || focus === "Exploring what's next") {
        conversation_hooks.push(`You both are navigating transition or exploration, which could lead to meaningful conversations about change and what's next.`)
      } else if (focus === 'Mentoring and giving back') {
        conversation_hooks.push(`You both are in a mentoring-and-giving-back chapter, which could create space for conversations about what you've learned and what matters to you.`)
      } else if (focus === 'Establishing roots in a new city' || focus === 'Feeling grounded and steady') {
        conversation_hooks.push(`You both are in a grounded or roots-establishing chapter, which could lead to conversations about place, community, and stability.`)
      }
    }

    // Talk about / topics overlap (q5_talk_about)
    const userActivities = getMultiSelectValue(userIntake, 'q5_talk_about')
    const candidateActivities = getMultiSelectValue(candidateIntake, 'q5_talk_about')
    const sharedActivities = userActivities.filter((a: string) => candidateActivities.includes(a))
    if (sharedActivities.length >= 2 && conversation_hooks.length < 2) {
      const topTwo = sharedActivities.slice(0, 2)
      conversation_hooks.push(`You both enjoy ${topTwo.join(' and ')}, which could be a great starting point for conversations and meeting up.`)
    } else if (sharedActivities.length >= 1 && conversation_hooks.length < 2) {
      conversation_hooks.push(`You both enjoy ${sharedActivities[0]}, which could be a great starting point for conversation.`)
    } else if (shared_interests.length >= 2 && conversation_hooks.length < 2) {
      const topTwo = shared_interests.slice(0, 2)
      conversation_hooks.push(`You both share interests in ${topTwo.join(' and ')}, which could be a great starting point for conversation.`)
    }
  }

  return {
    sharedInterests: shared_interests.slice(0, 3),
    conversationHooks: conversation_hooks.slice(0, 3),
    // Store both users' info for bidirectional display
    user_a_hobbies: user_a_hobbies.slice(0, 5),
    user_a_talk_topics: user_a_talk_topics.slice(0, 4),
    user_a_interests: user_a_interests.slice(0, 4),
    user_b_hobbies: user_b_hobbies.slice(0, 5),
    user_b_talk_topics: user_b_talk_topics.slice(0, 4),
    user_b_interests: user_b_interests.slice(0, 4),
    // Keep old fields for backward compatibility (will be deprecated)
    candidateHobbies: user_b_hobbies.slice(0, 5),
    candidateTalkTopics: user_b_talk_topics.slice(0, 4),
    candidateInterests: user_b_interests.slice(0, 4),
    matchScore: 0 // Will be set by caller
  }
}