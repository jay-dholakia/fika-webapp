/**
 * SMS agent: state machine, message templates, venue picker, slot↔day/window mapping.
 * Used by webhook and Edge Functions. Copy: we reach out by SMS when we find a good Fika intro; we text a time and place to confirm — no fixed weekly blast.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { haversineKm } from '@/lib/distance'
import { searchNearbyCafesGooglePlaces, upsertVenueFromGooglePlace } from '@/lib/google-places-venues'
import { DEFAULT_RADIUS_KM } from '@/lib/intake-radius'
import { SMS_PACING_MS } from '@/lib/sms-pacing'

export const SMS_STATES = {
  GLOBAL_READY: 'global_ready',
  AWAITING_OPT_IN: 'awaiting_opt_in',
  OPTED_IN: 'opted_in',
  MATCH_OFFERED: 'match_offered',
  MATCH_CLOSED: 'match_closed',
  YES_WAITING: 'yes_waiting',
  AWAITING_AVAILABILITY: 'awaiting_availability',
  AWAITING_SECOND_CONFIRM: 'awaiting_second_confirm',
  AWAITING_FIRST_CONFIRM: 'awaiting_first_confirm',
  ACCEPTED_SCHEDULING_DAY: 'accepted_scheduling_day',
  SCHEDULING_WINDOW: 'scheduling_window',
  VENUE_PROPOSED: 'venue_proposed',
  CONFIRMED: 'confirmed',
} as const

const READY_FOR_INTRO_VARIANTS = [
  "You're in. We'll text you when there's a strong Fika intro for you.",
  "You're in. As soon as we find a strong intro, we'll text you.",
  "You're in. We'll reach out when we find someone worth meeting.",
]

function pickReadyForIntroMessage(): string {
  const idx = Math.floor(Math.random() * READY_FOR_INTRO_VARIANTS.length)
  return READY_FOR_INTRO_VARIANTS[idx] ?? READY_FOR_INTRO_VARIANTS[0]
}

/** Slot id prefix (wed, thu, ...) to SMS day label */
const SLOT_DAY_TO_LABEL: Record<string, string> = {
  mon: 'MON',
  tue: 'TUE',
  wed: 'WED',
  thu: 'THU',
  fri: 'FRI',
  sat: 'SAT',
  sun: 'SUN',
}

/** Time index 0–19 to window: Morning (0–3 ≈ 9a–10:30a), Afternoon (4–11), Evening (12–19) */
export function slotIdToDayAndWindow(slotId: string): { day: string; window: 'Morning' | 'Afternoon' | 'Evening' } | null {
  const parts = slotId.split('_')
  const day = parts[0]?.toLowerCase()
  const timeStr = parts.slice(1).join('_')
  if (!day || !SLOT_DAY_TO_LABEL[day]) return null
  const hour = parseInt(timeStr?.split('_')[0] ?? '9', 10)
  const window: 'Morning' | 'Afternoon' | 'Evening' = hour < 12 ? 'Morning' : hour < 17 ? 'Afternoon' : 'Evening'
  return { day: SLOT_DAY_TO_LABEL[day], window }
}

/** Get unique days from overlapping slot IDs for SMS "When might you be free? WED THU SAT" */
export function getDaysFromSlotIds(slotIds: string[]): string[] {
  const set = new Set<string>()
  for (const id of slotIds) {
    const d = slotIdToDayAndWindow(id)
    if (d) set.add(d.day)
  }
  return Array.from(set).sort()
}

/** Format slot id (e.g. wed_14_30) to display time "Wed 2:30pm" for proposal SMS. */
export function slotIdToDisplayTime(slotId: string): { day: string; time: string } {
  const dw = slotIdToDayAndWindow(slotId)
  const parts = slotId.split('_')
  const hour = parseInt(parts[1] ?? '9', 10)
  const min = parseInt(parts[2] ?? '0', 10)
  const period = hour >= 12 ? 'pm' : 'am'
  const hour12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour
  const timeStr = min === 0 ? `${hour12}${period}` : `${hour12}:${min.toString().padStart(2, '0')}${period}`
  return {
    day: dw?.day ?? parts[0]?.toUpperCase() ?? 'Wed',
    time: timeStr,
  }
}

/** Normalize incoming phone to E.164 for lookup (ensure +1 for US 10-digit). */
export function normalizeIncomingPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return phone.startsWith('+') ? phone : `+${digits}`
}

/** Look up user_id by phone (profiles.phone). */
export async function getUserIdByPhone(
  supabase: SupabaseClient,
  phone: string
): Promise<string | null> {
  const normalized = normalizeIncomingPhone(phone)
  const { data } = await supabase
    .from('profiles')
    .select('id')
    .eq('phone', normalized)
    .maybeSingle()
  return data?.id ?? null
}

/** User location and travel willingness for venue selection. */
export type UserLocation = {
  city?: string | null
  lat?: number | null
  lng?: number | null
  /** Max distance (km) user is willing to travel to venue; from intake q_radius. Uses default if omitted. */
  radius_km?: number | null
}

function hasValidLatLng(u: UserLocation): boolean {
  const lat = u.lat != null ? Number(u.lat) : NaN
  const lng = u.lng != null ? Number(u.lng) : NaN
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
}

/**
 * Pick a venue from `venues` only: lat/lng minimax within each user's radius (no city / random fallbacks).
 * When this returns null, `pickVenueForMatch` uses Google Places.
 */
export async function pickVenueFromDatabase(
  supabase: SupabaseClient,
  userA: UserLocation,
  userB: UserLocation
): Promise<{ id: string; name: string; neighborhood: string | null; city: string } | null> {
  const maxDistA = userA.radius_km != null && Number.isFinite(Number(userA.radius_km)) ? Number(userA.radius_km) : DEFAULT_RADIUS_KM
  const maxDistB = userB.radius_km != null && Number.isFinite(Number(userB.radius_km)) ? Number(userB.radius_km) : DEFAULT_RADIUS_KM

  if (!hasValidLatLng(userA) || !hasValidLatLng(userB)) return null

  const latA = Number(userA.lat)
  const lngA = Number(userA.lng)
  const latB = Number(userB.lat)
  const lngB = Number(userB.lng)

  const { data: venues } = await supabase
    .from('venues')
    .select('id, name, neighborhood, city, lat, lng')
    .eq('google_permanently_closed', false)
    .not('lat', 'is', null)
    .not('lng', 'is', null)

  if (!venues?.length) return null

  type VenueRow = { id: string; name: string; neighborhood: string | null; city: string; lat: number; lng: number }
  const withScores = (venues as VenueRow[])
    .map((v) => {
      const latV = typeof v.lat === 'number' ? v.lat : Number(v.lat)
      const lngV = typeof v.lng === 'number' ? v.lng : Number(v.lng)
      if (!Number.isFinite(latV) || !Number.isFinite(lngV)) return null
      const distA = haversineKm(latA, lngA, latV, lngV)
      const distB = haversineKm(latB, lngB, latV, lngV)
      if (distA > maxDistA || distB > maxDistB) return null
      const maxDist = Math.max(distA, distB)
      return { venue: v, maxDist }
    })
    .filter((x): x is { venue: VenueRow; maxDist: number } => x != null)
    .sort((a, b) => a.maxDist - b.maxDist)

  if (withScores.length === 0) return null
  const { venue } = withScores[0]
  return { id: venue.id, name: venue.name, neighborhood: venue.neighborhood, city: venue.city }
}

/**
 * Prefer curated `venues`, then Google Places (New) nearby cafes; upserts discovered places for reuse.
 * Pass `meetingAtUtc` when the proposed Fika time is known so Google picks can respect regular opening hours.
 */
export async function pickVenueForMatch(
  supabase: SupabaseClient,
  userA: UserLocation,
  userB: UserLocation,
  opts?: { meetingAtUtc?: Date }
): Promise<{ id: string; name: string; neighborhood: string | null; city: string } | null> {
  // When we know the proposed meeting time, prefer a fresh Google validation
  // (hours + businessStatus) instead of relying on cached/old venue rows.
  if (opts?.meetingAtUtc) {
    const place = await searchNearbyCafesGooglePlaces({ userA, userB, meetingAtUtc: opts.meetingAtUtc })
    if (place) return upsertVenueFromGooglePlace(supabase, place)
  }

  const fromDb = await pickVenueFromDatabase(supabase, userA, userB)
  if (fromDb) return fromDb

  const place = await searchNearbyCafesGooglePlaces({
    userA,
    userB,
    meetingAtUtc: undefined,
  })
  if (!place) return null
  return upsertVenueFromGooglePlace(supabase, place)
}

// ---------- Message templates ----------
// After intake, we text when we have a good Fika intro; scheduling proposes a time and place by SMS for YES/NO confirmation.

/** One-line hint so users save the concierge number and don't miss intros. */
export function messageSaveAsContactHint(): string {
  return 'Save this number as Fika ☕ so you never miss an intro.'
}

export type TimedSmsMessage = {
  content: string
  delayAfterMs?: number
}

/** First-time sequence after signup (active market). `isAfterDeadline` kept for API compatibility. */
export function messageEntryFirstTimeMessages(
  _isAfterDeadline: boolean,
  _nextMondayPhrase: string = 'next Monday',
  appBase: string = 'https://letsfika.vercel.app'
): TimedSmsMessage[] {
  const base = appBase.trim().replace(/\/$/, '') || 'https://letsfika.vercel.app'
  return [
    { content: 'You’re in 🤝', delayAfterMs: SMS_PACING_MS.quickAck },
    {
      content: 'We’re lining up your first intro now — we’ll text you as soon as there’s a strong match.',
      delayAfterMs: SMS_PACING_MS.reflective,
    },
    {
      content: 'Know a few people nearby who’d be into this? The more people who join, the faster intros start.',
      delayAfterMs: SMS_PACING_MS.context,
    },
    { content: `Update your profile anytime:\n${base}/app` },
  ]
}

/** First-time entry when user's market is inactive. Returns 4 messages (URL standalone). */
export function messageEntryFirstTimeMessagesInactiveMarket(
  appBase: string = 'https://letsfika.vercel.app',
  _cityLabel?: string | null
): TimedSmsMessage[] {
  const base = appBase.trim().replace(/\/$/, '') || 'https://letsfika.vercel.app'
  return [
    { content: 'You’re in 🤝', delayAfterMs: SMS_PACING_MS.quickAck },
    {
      content: 'We’re building up Fika in your area — once there are a few strong matches, we’ll send your first intro.',
      delayAfterMs: SMS_PACING_MS.reflective,
    },
    {
      content: 'Know a few people nearby who’d be into this? The more people who join, the faster intros start.',
      delayAfterMs: SMS_PACING_MS.context,
    },
    { content: `Update your profile anytime:\n${base}/app` },
  ]
}

/** Reply when user in an inactive market texts in. */
export function messageInactiveMarketReply(_placeLabel: string): string {
  return `We're getting Fika going in your area. When it opens up, we'll reach out.`
}

export function messageEntry(): string {
  return `Hey! Welcome to Fika. 😊\n\n${pickReadyForIntroMessage()}`
}

/** Greeting variant after signup. */
export function messageEntryAfterDeadline(
  _nextMondayPhrase: string = 'next Monday',
  options?: { firstName?: string | null; isGreeting?: boolean }
): string {
  const base = pickReadyForIntroMessage()
  if (options?.isGreeting && options?.firstName != null) {
    const name = String(options.firstName).trim()
    if (name && name !== ' ') {
      return `Hi ${name}! ${base}`
    }
  }
  return base
}

/** Short reminder when they text HI/FIKA again — avoid re-sending the full intro. */
export function messageEntryReminder(): string {
  return pickReadyForIntroMessage()
}

/** Short commitment line (e.g. user-initiated SMS). */
export function messageFikaUserInitiatedCommitment(): string {
  return `You're all set.`
}

/** Body before availability link (link sent as separate message). */
export function messageFikaUserInitiatedLinkBody(_availabilityUrl: string): string {
  return `We'll text you when there's a strong Fika intro for you.\n\nWhen it's time to meet, we'll send a time and place by text.`
}

/** Generic concierge reply when user texts in. */
export function messageTextFikaToGetLink(): string {
  return pickReadyForIntroMessage()
}

/** Reminder to set availability when a match is in progress. Text only; send availability link as separate message. */
export function messageAvailabilityReminder(_availabilityUrl: string): string {
  return `Quick reminder: when we have a time and place for your Fika, we'll text it to you.\n\nReply YES or NO to confirm.`
}

/** Availability received — scheduling next. */
export function messageAvailabilityLockAllSet(): string {
  return `You're all set.\n\nWe'll text you when it's time to line it up.`
}

/** Availability not submitted in time for this intro round. */
export function messageAvailabilityLockNotSubmitted(): string {
  return `We couldn't lock in a time for this round.\n\nNo worries — we'll reach out when we find another good Fika intro for you.`
}

/** When user is known but hasn't completed onboarding/intake. Text only; send onboardingUrl as a separate message after this. */
export function messageOnboardingRequired(_onboardingUrl: string): string {
  return `You're almost set.\n\nWe just need a few more details before we can match you.`
}

export function messageWeeklyOptIn(): string {
  return pickReadyForIntroMessage()
}

/** Legacy name: weekly blast disabled; kept for any stale imports. */
export function messageWeeklyPoolCronNudge(): string {
  return `${pickReadyForIntroMessage()}\n\nReply Help for options.`
}

/** Legacy name: weekly blast disabled. */
export function messageWeeklyPoolFirstContactHint(): string {
  return `${pickReadyForIntroMessage()}\n\nReply Help for options.`
}

/** Legacy name: weekly blast disabled. */
export function messageWeeklyPoolAwaitingOptInNudge(): string {
  return `${pickReadyForIntroMessage()}\n\nReply Help for options.`
}

/** Legacy name: weekly blast disabled. */
export function messageWeeklyPoolYoureInAvailability(): string {
  return `You're in.\n\nWhen it's time to schedule your intro, we'll text you a time and place.`
}

/** Legacy: between rounds / window closed — neutral copy. */
export function messageWeeklyPoolOptInWindowClosed(_nextSundayPhrase: string): string {
  return `We're not opening new opt-ins for this period.\n\n${pickReadyForIntroMessage()}`
}

/** Legacy name: weekly blast disabled. */
export function messageWeeklyPoolSkip(): string {
  return `No worries — we'll reach out when we find a good Fika intro for you.`
}

export function messageWeeklyOptInFollowUp(): string {
  return `Quick update: ${pickReadyForIntroMessage()}`
}

/** Rich “you both care about …” line from overlap + optional hook text. */
export function formatMatchIntroSharedContext(sharedInterests: string[], conversationThread: string): string {
  const cleaned = sharedInterests.map((s) => String(s).trim()).filter(Boolean).slice(0, 6)
  const thread = conversationThread.trim()
  if (cleaned.length === 0) {
    return thread || "You're both pointed in a similar direction — we think it could be a rich conversation."
  }
  let interestPart: string
  if (cleaned.length === 1) interestPart = cleaned[0]!
  else if (cleaned.length === 2) interestPart = `${cleaned[0]} & ${cleaned[1]}`
  else interestPart = `${cleaned.slice(0, -1).join(', ')}, & ${cleaned[cleaned.length - 1]}`
  let line = `You both care about ${interestPart}.`
  if (thread) {
    const t = thread.length > 220 ? `${thread.slice(0, 217)}…` : thread
    line += ` ${t}`
  }
  return line
}

export function messageMatchOffer(params: {
  otherFirstName: string
  otherAge: number | null
  otherCity?: string | null
  otherBio: string
  sharedInterests: string[]
  conversationThread: string
}): string {
  const { otherFirstName, otherAge, otherCity, sharedInterests, conversationThread } = params
  const cityTrim = otherCity?.trim() ?? ''
  const whoLine =
    otherAge != null && cityTrim
      ? `${otherFirstName}, ${otherAge} — ${cityTrim}`
      : otherAge != null
        ? `${otherFirstName}, ${otherAge}`
        : cityTrim
          ? `${otherFirstName} — ${cityTrim}`
          : otherFirstName

  const contextBlock = formatMatchIntroSharedContext(sharedInterests, conversationThread)

  return (
    `We found someone we think you should meet.\n\n` +
    `${whoLine}\n\n` +
    `${contextBlock}\n\n` +
    `If you're into it, reply YES or PASS.`
  )
}

/** Phase 1 (new protocol): simple simultaneous offer, no profile details yet. */
export function messageStrongIntroOffer(): string {
  return `We found someone we think you should meet.\n\nReply YES or PASS.`
}

export function messageMatchRevealPrompt(firstName?: string | null): string {
  const name = firstName?.trim()
  if (name) {
    return `Hey ${name} - we found a good Fika intro for you. Want to see it? Send me a 👍.`
  }
  return `We found a good Fika intro for you. Want to see it? Send me a 👍.`
}

export function formatMatchRevealSentence(params: {
  otherFirstName: string
  sharedInterests: string[]
  conversationHooks: string[]
}): string {
  const { otherFirstName, sharedInterests, conversationHooks } = params
  const formatTopicList = (topics: string[]): string => {
    if (topics.length === 0) return ''
    if (topics.length === 1) return topics[0]!
    if (topics.length === 2) return `${topics[0]} and ${topics[1]}`
    return `${topics[0]}, ${topics[1]}, and ${topics[2]}`
  }

  const sanitizeInterest = (value: string): string => {
    const normalized = value.trim().replace(/\.$/, '')
    const lower = normalized.toLowerCase()
    if (/(books|shows|podcasts|games|music|movies)/.test(lower) && normalized.includes(',')) {
      return normalized
        .split(',')
        .map((part) => part.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 2)
        .join(' + ')
    }
    return normalized
  }

  const normalizeRevealTopic = (topic: string): string => {
    const normalized = topic.trim().replace(/\.$/, '')
    const lower = normalized.toLowerCase()

    if (
      lower.startsWith("what we're working on") ||
      lower.startsWith('what we are working on') ||
      lower.startsWith("what you're working on") ||
      lower.startsWith('what you are working on')
    ) {
      return 'work and projects'
    }
    if (
      lower.startsWith("stuff we're into lately") ||
      lower.startsWith('stuff we are into lately') ||
      lower.startsWith("things we're into lately") ||
      lower.startsWith('things we are into lately') ||
      lower.startsWith("what we're into lately") ||
      lower.startsWith('what we are into lately') ||
      lower.startsWith("stuff you're into lately") ||
      lower.startsWith('stuff you are into lately')
    ) {
      return ''
    }

    const parentheticalMatch = normalized.match(/\(([^)]+)\)/)
    const lowerWithoutParens = lower.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s{2,}/g, ' ').trim()
    if (
      parentheticalMatch &&
      (
        lowerWithoutParens.startsWith("stuff we're into lately") ||
        lowerWithoutParens.startsWith('stuff we are into lately') ||
        lowerWithoutParens.startsWith("things we're into lately") ||
        lowerWithoutParens.startsWith('things we are into lately') ||
        lowerWithoutParens.startsWith("what we're into lately") ||
        lowerWithoutParens.startsWith('what we are into lately')
      )
    ) {
      return ''
    }

    return normalized
      .replace(/\s*\((work or projects|projects or work)\)\s*/gi, '')
      .replace(/\bwhat we're\b/gi, "what you're")
      .replace(/\bwhat we are\b/gi, "what you're")
      .replace(/\bstuff we're\b/gi, "the things you're")
      .replace(/\bstuff we are\b/gi, "the things you're")
      .replace(/\bthings we're\b/gi, "the things you're")
      .replace(/\bthings we are\b/gi, "the things you're")
      .replace(/\s{2,}/g, ' ')
      .trim()
  }

  const cleanedInterests = sharedInterests.map((s) => sanitizeInterest(String(s))).filter(Boolean)
  const cleanedHooks = conversationHooks.map((topic) => normalizeRevealTopic(String(topic))).filter(Boolean)
  let interestTeaser = cleanedInterests.slice(0, 2)
  let remainingHooks = [...cleanedHooks]

  if (interestTeaser.length === 0) {
    const hookWithExamples = cleanedHooks.find((hook) => /\(([^)]+)\)/.test(hook))
    const exampleMatch = hookWithExamples?.match(/\(([^)]+)\)/)
    const examples = exampleMatch?.[1]
      ?.split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => sanitizeInterest(part.toLowerCase())) ?? []

    if (examples.length > 0) {
      interestTeaser = examples
      remainingHooks = cleanedHooks.filter((hook) => hook !== hookWithExamples)
    }
  }

  const topicTeaser = remainingHooks
    .map((topic) => topic.charAt(0).toLowerCase() + topic.slice(1))
    .filter((topic, index, list) => list.indexOf(topic) === index)
    .slice(0, 3)

  if (interestTeaser.length > 0 && topicTeaser.length > 0) {
    const interests =
      interestTeaser.length === 1 ? interestTeaser[0]! : `${interestTeaser[0]} + ${interestTeaser[1]}`
    const topics = formatTopicList(topicTeaser)
    return `Meet ${otherFirstName}. You're both into ${interests}, and both like talking about ${topics}.`
  }
  if (interestTeaser.length > 0) {
    const interests =
      interestTeaser.length === 1 ? interestTeaser[0]! : `${interestTeaser[0]} + ${interestTeaser[1]}`
    return `Meet ${otherFirstName}. You're both into ${interests}.`
  }
  if (topicTeaser.length > 0) {
    const topics = formatTopicList(topicTeaser)
    return `Meet ${otherFirstName}. You both like talking about ${topics}.`
  }
  return `Meet ${otherFirstName}.`
}

/** User text didn’t match the current intro phase. */
export function messageMatchOfferedUnrecognized(phase: 'reveal_pending' | 'revealed' = 'revealed'): string {
  if (phase === 'reveal_pending') {
    return `Send me a 👍 if you want to see the intro.`
  }
  return `Send me a 👍 if you'd like to meet. Or reply PASS if this person doesn't feel like the right fit.`
}

/** Phase 2 teaser after both users say YES. */
export function messageTeaserPreview(params: {
  otherFirstName: string
  otherBio: string
}): string {
  const { otherFirstName, otherBio } = params
  return `Quick preview:\n\nYou'd be meeting ${otherFirstName}.\n${otherBio}`
}

export function messageMutualYesContext(params: {
  sharedInterests: string[]
  conversationThread: string
  venueName: string
  neighborhood?: string | null
  broadAvailabilityLabel?: string | null
}): string {
  const { sharedInterests, conversationThread, venueName, neighborhood, broadAvailabilityLabel } = params
  const context = formatMatchIntroSharedContext(sharedInterests, conversationThread)
  const venueLine = neighborhood?.trim()
    ? `A likely spot for this one would be ${venueName} in ${neighborhood}.`
    : `A likely spot for this one would be ${venueName}.`
  const availabilityLine = broadAvailabilityLabel?.trim()
    ? `You both have ${broadAvailabilityLabel.toLowerCase()} open. I'll suggest a time now.`
    : `You both seem free at similar times this week. I'll suggest a time now.`
  return `${context}\n\n${venueLine}\n${availabilityLine}`
}

/** Nudge when state is still AWAITING_AVAILABILITY (legacy state name; scheduling is proposal-first). */
export function messageAwaitingAvailabilityReady(): string {
  return `You're almost set.\n\nWhen we send a time and place, send me a 👍 if it works for you, or reply NO if you'd like a different time. Reply Help anytime.`
}

/** Tuesday intro with full plan (one proposed time + venue). Reply YES by 9 PM tonight. */
export function messageIntroWithPlan(params: {
  otherFirstName: string
  areaLabel: string
  day: string
  time: string
  venueName: string
  neighborhood: string
}): string {
  const { otherFirstName, areaLabel, day, time, venueName, neighborhood } = params
  return `You've been matched with ${otherFirstName}.\n\nYou both live near ${areaLabel} and are free ${day} evening.\n\nFika plan\n\n${day} — ${time}\n${venueName} (${neighborhood})\n\nReply Yes to confirm by 9 PM tonight.`
}

export function messageConversationContext(params: {
  sharedInterests: string[]
  starterQuestion: string
}): string {
  const { sharedInterests, starterQuestion } = params
  let text = `Here's a little context for your Fika:\n\nYou both mentioned:\n${sharedInterests.join(' and ')}\n\nA question you could kick things off with:\n\n"${starterQuestion}"`
  return text
}

export function messageSchedulingDay(days: string[]): string {
  return `When are you free for a quick coffee chat?\n\n${days.join('\n')}\n\nReply with one or more days that work.`
}

export function messageSchedulingWindow(): string {
  return `What time works best?\n\nMorning\nAfternoon\nEvening\n\nReply with one.`
}

export function messageVenueProposed(day: string, time: string, venueName: string, neighborhood: string): string {
  return `Looks like ${day} ${time.toLowerCase()} works for you both.\n\nHow about:\n\n${time} at ${venueName} in ${neighborhood}\n\nReply Confirm or Change`
}

/** Both confirmed — Fika is locked in. `dateLine` e.g. Mon (3/31) — 1pm; `venueLine` e.g. Vees Cafe (90016). */
export function messageYoureAllSet(params: {
  otherFirstName: string
  dateLine: string
  venueLine: string
}): string {
  const { otherFirstName, dateLine, venueLine } = params
  const name = otherFirstName.trim() || 'your intro'
  return `Your Fika is set with ${name} ☕️\n\n${dateLine}\n${venueLine}\n\nWe'll remind you the day of.`
}

export function messageDayOfReminder(time: string, venueName: string, neighborhood: string, starterQuestion?: string): string {
  let text = `Your Fika is today at ${time}. ☕\n\n${venueName} (${neighborhood})\n\nIf you're running late, text here and we'll pass it along.`
  if (starterQuestion) {
    text += `\n\nA question you might enjoy:\n${starterQuestion}`
  }
  return text
}

export function messageOptInConfirmation(): string {
  return pickReadyForIntroMessage()
}

/** When user replies YES (legacy): may send app link. Text only; send availabilityUrl as a separate message after this. */
export function messageOptInSetAvailability(_availabilityUrl: string): string {
  return `Love it.\n\nIf they're in too, I'll line it up and text you both a time and place.`
}

export function messageSkipped(): string {
  return `No worries. We’ll reach out again when we find another good Fika intro for you.`
}

export function messagePassConfirmation(): string {
  return `Got it.\n\nWe'll keep looking for someone who feels like a better fit.`
}

/** First person said YES — waiting for the other to confirm. */
export function messageYesWaitingForOther(): string {
  return `Love it.\n\nIf they're in too, I'll line it up and text you both a time and place.`
}

/** Notify the person who said YES when the other passed or intro didn't get confirmed. */
export function messageMatchPassed(): string {
  return `This one didn't come together.\n\nWe'll reach out when we find another good intro.`
}

export function messageIntroNoLongerAvailable(): string {
  return `That intro is no longer available, but we'll send another intro soon.`
}

/** Legacy name: window closed — neutral copy. */
export function messageOptInWindowClosed(_nextMondayPhrase: string = 'next Monday'): string {
  return `We’ll reach out when we find a good Fika intro for you.`
}

/** Notify the user who said YES when the other didn't respond before the intro expired. */
export function messageMatchExpiredOtherNoResponse(): string {
  return `This one didn't come together.\n\nWe'll reach out when we find another good intro.`
}

/** Notify the user who didn't respond before the intro expired. */
export function messageMatchExpiredYouNoResponse(_nextMondayPhrase: string = 'next Monday'): string {
  return `This one didn't come together.\n\nWe'll reach out when we find another good intro.`
}

/** When someone declines the proposed time/venue (after both said YES to intro). */
export function messageProposalDeclined(): string {
  return `No problem.\n\nWe'll reach out when we find another good intro.`
}

/** When we've offered 2 times and still no match (max retries reached). */
export function messageProposalMaxRetries(): string {
  return `We couldn't find a time that works for both.\n\nWe'll reach out when we find another good intro.`
}

/** Notify the other person when their match declines the proposed time. */
export function messageProposalDeclinedToOther(): string {
  return `They couldn't do this time.\n\nWe'll reach out when we have another intro for you.`
}

/** Re-propose a new time to the person who declined (attempt 2). */
export function messageReProposalToDecliner(params: { meetingDateLabel: string; time: string; venueName: string; neighborhood: string }): string {
  const { meetingDateLabel, time } = params
  return `No worries.\n\nHow about ${meetingDateLabel} at ${time}?\n\nReply YES or NO.`
}

/** Notify the other person we're trying a different time. */
export function messageReProposalToOther(params: { meetingDateLabel: string; time: string; venueName: string; neighborhood: string }): string {
  const { meetingDateLabel, time } = params
  return `No worries.\n\nHow about ${meetingDateLabel} at ${time}?\n\nReply YES or NO.`
}

export type ProposalConfirmFields = {
  meetingDateLabel: string
  time: string
  venueName: string
  neighborhood: string
}

/** Same proposal for both parties (symmetric time confirmation). */
export function messageProposalToConfirmSymmetric(params: ProposalConfirmFields): string {
  const { meetingDateLabel, time } = params
  return `Looks like this could work:\n\n${meetingDateLabel} at ${time}\n\nSend me a 👍 if this time works for you. Reply NO if you'd like a different time.`
}

/** User who said YES first — the other person just completed the pair. */
export function messageProposalToConfirmFirstYes(params: ProposalConfirmFields & { otherFirstName: string }): string {
  const { otherFirstName, meetingDateLabel, time } = params
  return `${otherFirstName} is in.\n\n${meetingDateLabel} at ${time}\n\nSend me a 👍 if this time works for you. Reply NO if you'd like a different time.`
}

/** User who said YES second — they just triggered the proposal. */
export function messageProposalToConfirmSecondYes(params: ProposalConfirmFields): string {
  return messageProposalToConfirmSymmetric(params)
}

/** @deprecated Prefer messageProposalToConfirmSymmetric or first/second variants. */
export function messageProposalToConfirm(params: {
  otherFirstName: string
  meetingDateLabel: string
  time: string
  venueName: string
  neighborhood: string
}): string {
  const { meetingDateLabel, time, venueName, neighborhood } = params
  return messageProposalToConfirmSymmetric({ meetingDateLabel, time, venueName, neighborhood })
}

// ---------- Day-of relay (here / on my way / running late / can't make it) ----------

/** Reply to sender after relaying their text to the other person. */
export function messageRelayConfirmToSender(otherFirstName: string): string {
  const name = otherFirstName || 'your intro'
  return `Sent to ${name}.`
}

/** Relay free-text content to the other person in the intro pair. */
export function messageRelayToOther(senderFirstName: string, text: string): string {
  const name = senderFirstName || 'Your intro'
  return `${name}: ${text}`
}


/** Day-of reminder (e.g. 3 hours before). otherFirstName = match's first name. */
export function messageThreeHourReminder(time: string, venueName: string, neighborhood: string, otherFirstName?: string | null): string {
  const name = otherFirstName?.trim() || 'your intro'
  return `Your Fika is in about 3 hours.\n\n${time}\n${venueName} (${neighborhood})\n\nYou can text here to coordinate with ${name} if needed.`
}

/** Relay-closed + follow-up prompt copy. */
export function messageRelayClosedFeedbackPrompt(): string {
  return `Your Fika coordination thread is now closed.\nHow did it go? Reply with quick feedback so we can improve your future Fikas.`
}

export {
  getFikaDateFromSlot,
  getFikaTimeMs,
  getTodayPT,
  getTodayYmdInTimezone,
  isFikaToday,
  isInRelayWindow,
  isRelayClosed,
} from '@/lib/fika-schedule-time'

/** Post-Fika: ask how it went and for feedback (sent ~2 hours after Fika). */
export function messagePostFikaFeedback(): string {
  return `Your Fika coordination thread is now closed.\nHow did it go? Reply with quick feedback so we can improve your future Fikas.`
}

/** Reply after we store their post-Fika feedback (first time). */
export function messageThanksForFeedback(): string {
  return `Thanks for sharing — we really appreciate it.`
}

/** Reply when they've already sent feedback for this Fika and send more. */
export function messageThanksForFeedbackAgain(): string {
  return `Got it, thanks! Always happy to hear from you.`
}

/** When we can't relay (e.g. no phone for other person). Don't promise retries. */
export function messageRelayCouldNotDeliver(): string {
  return `We couldn't get your update through this time — try reaching out to them directly if you can.`
}

/** STOP: we'll stop texting; account still on web. Text only; send webappUrl as a separate message after this. */
export function messageSmsOptOut(_webappUrl: string, _conciergeNumber: string): string {
  return `We'll stop texting you.\n\nIf you ever want back in, just text us here.`
}

/** When they text back after opting out. */
export function messageSmsOptBackIn(): string {
  return `You're back in.\n\nWe’ll reach out when we find a good Fika intro for you.`
}

/** Confirmed Fika upcoming: reminder. Text only; send webappUrl as a separate message after this. */
export function messageConfirmedUpcoming(day: string, time: string, venueName: string, neighborhood: string, _webappUrl: string): string {
  return `Your Fika is coming up.\n\n${day} at ${time}\n${venueName} (${neighborhood})\n\nIf you can't make it, reply Cancel.`
}

/** HELP while user has a confirmed upcoming Fika (deterministic; no AI). */
export function messageSmsHelpConfirmedUpcoming(params: {
  day: string
  time: string
  venueName: string
  neighborhood: string
}): string {
  const { day, time, venueName, neighborhood } = params
  return `You're set for ${day} at ${time} at ${venueName} (${neighborhood}).\n\nIf you can't make it, reply Cancel.\n\nCloser to the time, you can text your intro in this thread.`
}

/** Short ack for thanks / ok / 👍 on upcoming Fika thread. */
export function messageGratitudeAckUpcoming(): string {
  return `Of course — see you then.`
}

/** Rate limit hit for AI concierge replies. */
export function messageSmsAiRateLimited(): string {
  return `I can only send a few tips per day here.\n\nIf you can't make this Fika, reply Cancel.`
}

/** When OpenAI is off or fails; no state change. */
export function messageConciergeAiFallbackShort(appBase: string): string {
  const _base = appBase.replace(/\/$/, '')
  return `Thanks for texting.\n\nReply Help or Cancel and I'll keep it simple here.`
}

/** User asked to reschedule; SMS no longer supports changing time. */
export function messageRescheduleNotSupported(appBase: string): string {
  const _base = appBase.replace(/\/$/, '')
  return `We can't change this Fika's time by text.\n\nIf you can't make it, reply Cancel.`
}

/** CANCEL acknowledged. */
export function messageCancelAck(): string {
  return `Got your cancel — we'll follow up and let your Fika intro know.`
}

/** Canceller: cancel + optional retry (no rescheduling). */
export function messageCancelRetryInitiator(): string {
  return `Got it.\n\nWe'll let them know.\n\nWant us to try this intro again another time?\nReply YES or NO.`
}

/** Other participant after someone cancelled a confirmed Fika. */
export function messageCancelRetryOtherUser(): string {
  return `Your Fika won't happen at the original time.\n\nWant us to try this intro again another time?\nReply YES or NO.`
}

export function messageCancelRetryBothYes(): string {
  return `Got it — we'll reach back out with a new time.`
}

export function messageCancelRetryClosed(): string {
  return `No worries — we'll close this one out here.`
}

export function messageCancelRetryNudge(): string {
  return `Quick check — want to try this intro again another time?\nReply YES or NO.`
}

export function messageCancelRetryHelp(): string {
  return `Reply YES if you'd like us to try this intro again another time, or NO if not. We can't propose new times by text.`
}

export function messageCancelAlreadyInCancelRetryFlow(): string {
  return `We already have your cancel — reply YES or NO about trying this intro again another time.`
}

/** HELP: one static reply (no state-based routing). */
export function messageSmsHelp(): string {
  return `Reply YES or PASS when we send an intro.\n\nIf you need anything else, text us here.`
}

// ---------- Broadened keywords (normalize then match) ----------

function normalizeKeyword(content: string): string {
  return content.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Opt-in: IN, YES, etc. */
export function isOptInKeyword(content: string): boolean {
  const k = normalizeKeyword(content)
  return ['in', 'yes', 'yep', 'sure', 'ok', 'okay', "i'm in", 'count me in'].includes(k)
}

/** Weekly pool: user texts FIKA to opt in for this batch week. */
export function isFikaWeeklyOptInKeyword(content: string): boolean {
  const k = normalizeKeyword(content).replace(/[!.]/g, '')
  return k === 'fika' || k === 'fika ☕' || k.startsWith('fika ')
}

/** Skip opt-in. */
export function isSkipKeyword(content: string): boolean {
  const k = normalizeKeyword(content)
  return ['skip', 'no', 'nah', 'not this week', 'pass'].includes(k)
}

/** Match offer: YES. */
export function isMatchYesKeyword(content: string): boolean {
  const k = normalizeKeyword(content)
  return ['yes', 'yep', 'sure', 'sounds good', 'lets do it', "let's do it", 'ok', 'okay', '👍'].includes(k)
}

/** Match offer: PASS. */
export function isMatchPassKeyword(content: string): boolean {
  const k = normalizeKeyword(content)
  return ['pass', 'no', 'nah', 'skip', 'not this one'].includes(k)
}

/** Decline the proposed time/venue (when in AWAITING_SECOND_CONFIRM or AWAITING_FIRST_CONFIRM). */
export function isProposalDeclineKeyword(content: string): boolean {
  const k = normalizeKeyword(content)
  return (
    ['no', 'nah', 'nope', 'pass', 'change', 'no thanks', 'not this time', 'different time', "can't do that", "cant do that", "doesn't work", 'not that time', 'another time'].includes(k) ||
    k.includes("can't do") ||
    k.includes('cant do') ||
    k.includes('doesn\'t work') ||
    k.includes('dont work') ||
    k.includes('another time')
  )
}

/** Venue: CONFIRM. */
export function isConfirmKeyword(content: string): boolean {
  const k = normalizeKeyword(content)
  return ['confirm', 'confirmed', 'yes', 'yep', 'sure', 'ok', 'okay', 'looks good', 'sounds good', 'lets do it', "let's do it"].includes(k)
}

/** Re-send availability link. */
export function isResendLinkKeyword(content: string): boolean {
  const k = normalizeKeyword(content)
  return ['link', 'resend', 'send link', 'again', "didn't get it", 'link didnt work', 'link didn\'t work'].includes(k)
}

/** HELP. */
export function isHelpKeyword(content: string): boolean {
  const k = normalizeKeyword(content)
  return ['help', 'help me', '?', 'what'].includes(k) || k.startsWith('help')
}

/** Keyword READY — legacy handler still clears pending match_availability rows if any exist. */
export function isAvailabilityReadyKeyword(content: string): boolean {
  const k = normalizeKeyword(content).replace(/[!?.]+$/g, '').trim()
  return k === 'ready'
}

/** STOP / opt out. (Use keyword Cancel in the confirmed-Fika flow to cancel the intro — not listed here so it can route there.) */
export function isStopKeyword(content: string): boolean {
  const k = normalizeKeyword(content)
  return ['stop', 'unsubscribe', 'opt out', 'optout'].includes(k)
}

/** RESCHEDULE. */
export function isRescheduleKeyword(content: string): boolean {
  return normalizeKeyword(content).includes('reschedule')
}

/** CANCEL (for confirmed upcoming). */
export function isCancelKeyword(content: string): boolean {
  const k = normalizeKeyword(content)
  return ['cancel', 'cancelled', 'canceled'].includes(k)
}

/** Retry opt-in after cancel (same as match YES). */
export function isCancelRetryYesKeyword(content: string): boolean {
  return isMatchYesKeyword(content)
}

/** Decline retry intro (narrower than match PASS — no "skip" alone). */
export function isCancelRetryNoKeyword(content: string): boolean {
  const k = normalizeKeyword(content)
  return (
    ['no', 'nope', 'nah', 'pass', 'n', 'not now', 'no thanks', 'not this one', 'not this time'].includes(k) ||
    k.startsWith('no ')
  )
}

/**
 * Thanks / ok / 👍 style replies on the confirmed-upcoming thread (not scheduling actions).
 * Keep narrow so questions still go to the AI path.
 */
export function isGratitudeOrShortAckKeyword(content: string): boolean {
  const trimmed = content.trim()
  if (trimmed.length === 0 || trimmed.length > 100) return false
  const emojiOnlyAcks = ['👍', '👍🏻', '👍🏼', '👍🏽', '👍🏾', '👍🏿', '🙏', '❤️', '♥️', '✨']
  if (emojiOnlyAcks.includes(trimmed)) return true
  const k = normalizeKeyword(content)
  const phrases = [
    'thanks',
    'thank you',
    'thank u',
    'thx',
    'ty',
    'tysm',
    'tyvm',
    'np',
    'no prob',
    'no problem',
    'ok',
    'okay',
    'k',
    'cool',
    'great',
    'perfect',
    'got it',
    'sounds good',
    'appreciate it',
    'cheers',
    'awesome',
    'sweet',
    'yay',
    'love it',
    'good to know',
    'nice',
    'same',
    'see you',
    'see ya',
    'cu',
    'makes sense',
    'legend',
    'perf',
  ]
  if (phrases.includes(k)) return true
  if (k.startsWith('thanks') && k.length < 28) return true
  return false
}

/** Incoming message is a short greeting (Hi, Yo, Hey, etc.) — for personalizing reply. */
export function isGreetingKeyword(content: string): boolean {
  const k = normalizeKeyword(content).replace(/[!.]/g, '')
  const greetings = [
    'hi', 'hey', 'hello', 'yo', 'sup', 'howdy', 'hiya', 'heyy', 'helloo', 'hola',
    "what's up", 'whats up', 'hey there', 'hi there', 'good morning', 'good afternoon', 'good evening',
  ]
  if (greetings.includes(k)) return true
  if (/^(hi|hey|hello|yo|sup)\s*!?\.?$/.test(k)) return true
  return false
}

/** Get or create SMS conversation state (for entry message after onboarding). */
export async function getOrCreateSmsState(
  supabase: SupabaseClient,
  userId: string,
  state: string,
  opts: { week_anchor_monday?: string; match_id?: string; payload?: Record<string, unknown> }
): Promise<void> {
  const weekAnchorMonday = opts.week_anchor_monday ?? null
  const matchId = opts.match_id ?? null
  if (matchId == null) {
    await supabase.rpc('upsert_global_sms_conversation_state', {
      p_user_id: userId,
      p_week_anchor_monday: weekAnchorMonday,
      p_state: state,
      p_payload: opts.payload ?? {},
      p_last_sendblue_message_handle: null,
    })
    return
  }
  await supabase.from('sms_conversation_states').upsert(
    {
      user_id: userId,
      week_anchor_monday: weekAnchorMonday,
      match_id: matchId,
      state,
      payload: opts.payload ?? {},
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,week_anchor_monday,match_id' }
  )
}
