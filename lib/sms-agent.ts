/**
 * SMS agent: state machine, message templates, venue picker, slot↔day/window mapping.
 * Used by webhook and Edge Functions. Copy: we reach out by SMS when we find a good Fika intro; we text a time and place to confirm — no fixed weekly blast.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { haversineKm } from '@/lib/distance'
import { searchNearbyCafesGooglePlaces, upsertVenueFromGooglePlace } from '@/lib/google-places-venues'
import { DEFAULT_RADIUS_KM } from '@/lib/intake-radius'

export const SMS_STATES = {
  GLOBAL_READY: 'global_ready',
  AWAITING_OPT_IN: 'awaiting_opt_in',
  OPTED_IN: 'opted_in',
  MATCH_OFFERED: 'match_offered',
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
  "You're all set — we'll reach out when we find a good Fika intro for you.",
  "You're all set. As soon as we have a good Fika intro for you, we'll text you.",
  "Thanks for checking in. We'll message you when we find a good Fika intro for you.",
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

/** First-time sequence after signup (active market). `isAfterDeadline` kept for API compatibility. */
export function messageEntryFirstTimeMessages(
  _isAfterDeadline: boolean,
  _nextMondayPhrase: string = 'next Monday',
  appBase: string = 'https://letsfika.vercel.app'
): string[] {
  const base = appBase.trim().replace(/\/$/, '') || 'https://letsfika.vercel.app'
  const msg1 = `You're in. We'll text you when we have a good Fika intro for you.`
  const msg2 = `To edit your profile or learn more, use the link I'll send next.`
  const msg3Link = `${base}/app`
  return [msg1, msg2, msg3Link]
}

/** First-time entry when user's market is inactive. Returns 3 messages (URL standalone). */
export function messageEntryFirstTimeMessagesInactiveMarket(
  appBase: string = 'https://letsfika.vercel.app',
  _cityLabel?: string | null
): string[] {
  const base = appBase.trim().replace(/\/$/, '') || 'https://letsfika.vercel.app'
  const msg1 = `You're in. We're not actively growing Fika in your area just yet, but we hope to be soon. When that changes, we'll reach out.`
  const msg2 = `To edit your profile or learn more, use the link I'll send next.`
  const msg3Link = `${base}/app`
  return [msg1, msg2, msg3Link]
}

/** Reply when user in an inactive market texts in. */
export function messageInactiveMarketReply(_placeLabel: string): string {
  return `We're not actively growing Fika in your area just yet, but we hope to be soon. When that changes, we'll reach out.`
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
  return `We'll reach out when we find a good Fika intro for you.\n\nWhen it's time to meet, we'll text you a proposed time and place to confirm by reply.`
}

/** Generic concierge reply when user texts in. */
export function messageTextFikaToGetLink(): string {
  return pickReadyForIntroMessage()
}

/** Reminder to set availability when a match is in progress. Text only; send availability link as separate message. */
export function messageAvailabilityReminder(_availabilityUrl: string): string {
  return `Quick reminder: when we have a time and place for your Fika, we'll text it to you—reply Yes or No to confirm.\n\nYou can also use the link I'll send next for your account.`
}

/** Availability received — scheduling next. */
export function messageAvailabilityLockAllSet(): string {
  return `You're all set.\n\nWe'll text you with a proposed time and place when your intro is ready to schedule.`
}

/** Availability not submitted in time for this intro round. */
export function messageAvailabilityLockNotSubmitted(): string {
  return `We couldn't lock in a time for this round.\n\nNo worries — we'll reach out when we find another good Fika intro for you.`
}

/** When user is known but hasn't completed onboarding/intake. Text only; send onboardingUrl as a separate message after this. */
export function messageOnboardingRequired(_onboardingUrl: string): string {
  return `Hey, we've got you in the system — just need a few more details before we can match you.\n\nFinish up using the link I'll send next.\n\nAfter that, we'll reach out when we find a good Fika intro for you.`
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
  return `You're in.\n\nWe'll text you a proposed time and place when we're scheduling your intro.\n\nUse the link I'll send next for your profile.`
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

export function messageMatchOffer(params: {
  otherFirstName: string
  otherAge: number | null
  otherCity?: string | null
  otherBio: string
  sharedInterests: string[]
  conversationThread: string
}): string {
  const { otherFirstName, otherAge, otherCity, otherBio, sharedInterests, conversationThread } = params
  const cityPart = otherCity?.trim() ? ` · ${otherCity.trim()}` : ''
  const agePart = otherAge != null ? `, ${otherAge}` : ''
  const whoLine = `${otherFirstName}${agePart}${cityPart}`

  let text =
    `We have a Fika intro lined up for you — it's for this one person, ${otherFirstName}, not a general pool.\n\n`
  text += `${whoLine}\n${otherBio}\n\n`
  if (sharedInterests.length > 0) {
    text += `You both share:\n${sharedInterests.map((s) => `• ${s}`).join('\n')}\n\n`
  }
  text += `Something to talk about:\n${conversationThread}\n\n`
  text += `Reply Yes if you want to meet ${otherFirstName}, or Pass to skip this match (just this person).`
  return text
}

/** Phase 1 (new protocol): simple simultaneous offer, no profile details yet. */
export function messageStrongIntroOffer(): string {
  return `We found a strong Fika intro for you — want us to set it up?\n\nReply Yes or Pass.`
}

/** Phase 2 teaser after both users say YES. */
export function messageTeaserPreview(params: {
  otherFirstName: string
  otherBio: string
}): string {
  const { otherFirstName, otherBio } = params
  return `Nice — quick preview:\n\nYou'd be meeting ${otherFirstName}.\n${otherBio}`
}

/** Nudge when state is still AWAITING_AVAILABILITY (legacy state name; scheduling is proposal-first). */
export function messageAwaitingAvailabilityReady(): string {
  return `You're almost set.\n\nWhen we send a time and place, reply Yes to confirm or No if it doesn't work. Reply Help anytime.`
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

/** Both confirmed — Fika is locked in. */
export function messageYoureAllSet(day: string, time: string, venueName: string, neighborhood: string): string {
  return `Your Fika is confirmed ☕\n\n${day} — ${time}\n${venueName} (${neighborhood})\n\nWe'll send a reminder on the day of your Fika.\nYou'll also be able to text your intro directly on this number ~3 hours before the scheduled time to communicate about any last minute things (running late, can't find parking, etc.)`
}

export function messageDayOfReminder(time: string, venueName: string, neighborhood: string, starterQuestion?: string): string {
  let text = `Your Fika is today at ${time} at ${venueName} (${neighborhood}). We'll text you closer to the time with more details — and you can update your intro if you're running late.\n\nHope you both have a great conversation!`
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
  return `We found a good Fika intro for you.\n\nWe'll text you a proposed time and place next—reply Yes or No to confirm.\n\nYou can also open your Fika with the link I'll send next.`
}

export function messageSkipped(): string {
  return `No worries. We’ll reach out again when we find another good Fika intro for you.`
}

export function messagePassConfirmation(): string {
  return `Got it — we'll keep looking for another good Fika intro for you.`
}

/** First person said YES — waiting for the other to confirm. */
export function messageYesWaitingForOther(): string {
  return `Awesome — I’ve sent this to them. As soon as they say yes, we’ll lock it in for you both.`
}

/** Notify the person who said YES when the other passed or intro didn't get confirmed. */
export function messageMatchPassed(): string {
  return `This intro didn’t get confirmed.\n\nWe’ll reach out again when we find another good Fika intro for you.`
}

/** Legacy name: window closed — neutral copy. */
export function messageOptInWindowClosed(_nextMondayPhrase: string = 'next Monday'): string {
  return `We’ll reach out when we find a good Fika intro for you.`
}

/** Notify the user who said YES when the other didn't respond before the intro expired. */
export function messageMatchExpiredOtherNoResponse(): string {
  return `This intro didn’t get confirmed.\n\nWe’ll reach out again when we find another good Fika intro for you.`
}

/** Notify the user who didn't respond before the intro expired. */
export function messageMatchExpiredYouNoResponse(_nextMondayPhrase: string = 'next Monday'): string {
  return `This intro didn’t get confirmed.\n\nWe’ll reach out again when we find another good Fika intro for you.`
}

/** When someone declines the proposed time/venue (after both said YES to intro). */
export function messageProposalDeclined(): string {
  return `No problem — we'll reach out when we find another good Fika intro for you.`
}

/** When we've offered 2 times and still no match (max retries reached). */
export function messageProposalMaxRetries(): string {
  return `We couldn't find a time that works for both — we'll reach out when we find another good Fika intro for you.`
}

/** Notify the other person when their match declines the proposed time. */
export function messageProposalDeclinedToOther(): string {
  return `They couldn't do this time — we'll reach out when we have another intro for you.`
}

/** Re-propose a new time to the person who declined (attempt 2). */
export function messageReProposalToDecliner(params: { meetingDateLabel: string; time: string; venueName: string; neighborhood: string }): string {
  const { meetingDateLabel, time, venueName, neighborhood } = params
  return `Perfect — how about ${meetingDateLabel} at ${time} at ${venueName} (${neighborhood}) near both of you?\n\nReply Yes or No.`
}

/** Notify the other person we're trying a different time. */
export function messageReProposalToOther(params: { meetingDateLabel: string; time: string; venueName: string; neighborhood: string }): string {
  const { meetingDateLabel, time, venueName, neighborhood } = params
  return `No worries — would ${meetingDateLabel} at ${time} at ${venueName} (${neighborhood}) near both of you work?\n\nReply Yes or No.`
}

/** Propose one time + place; ask them to confirm. Second YES-er gets this first, then first YES-er. */
export function messageProposalToConfirm(params: {
  otherFirstName: string
  meetingDateLabel: string
  time: string
  venueName: string
  neighborhood: string
}): string {
  const { otherFirstName, meetingDateLabel, time, venueName, neighborhood } = params
  return `Awesome — we’re lining up ${meetingDateLabel} at ${time} at ${venueName} (${neighborhood}) near both of you. Does that work?\n\nReply Yes or No.`
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
  return `Your Fika is in about 3 hours: ${time} at ${venueName} (${neighborhood}).\nText here to coordinate directly with ${name}. Relay closes 2 hours after your scheduled time.`
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
  return `We'll stop texting you.\n\nYour Fika account is still available online — I'll send the link next.\n\nYou can manage or delete your account there, and text this number anytime if you'd like to rejoin.`
}

/** When they text back after opting out. */
export function messageSmsOptBackIn(): string {
  return `You're back in.\n\nWe’ll reach out when we find a good Fika intro for you.`
}

/** Confirmed Fika upcoming: reminder. Text only; send webappUrl as a separate message after this. */
export function messageConfirmedUpcoming(day: string, time: string, venueName: string, neighborhood: string, _webappUrl: string): string {
  return `Your Fika is coming up — ${day} at ${time} at ${venueName} (${neighborhood}). ☕\n\nNeed to change it? Reply Reschedule or Cancel and we'll help. I'll send you the link to manage your account next.`
}

/** HELP while user has a confirmed upcoming Fika (deterministic; no AI). */
export function messageSmsHelpConfirmedUpcoming(params: {
  day: string
  time: string
  venueName: string
  neighborhood: string
}): string {
  const { day, time, venueName, neighborhood } = params
  return `You're set for ${day} at ${time} at ${venueName} (${neighborhood}). ☕\n\nTo change plans: reply Reschedule or Cancel.\n\nAbout 3 hours before start through ~2 hours after, you can text your intro on this number to coordinate (running late, parking, etc.).\n\nOr open your account at letsfika.co`
}

/** Short ack for thanks / ok / 👍 on upcoming Fika thread. */
export function messageGratitudeAckUpcoming(): string {
  return `Of course — see you then.`
}

/** Rate limit hit for AI concierge replies. */
export function messageSmsAiRateLimited(): string {
  return `I can only send a few tips per day in text. For plan changes reply Reschedule or Cancel, or open letsfika.co — see you soon!`
}

/** When OpenAI is off or fails; no state change. */
export function messageConciergeAiFallbackShort(appBase: string): string {
  const base = appBase.replace(/\/$/, '')
  return `Thanks for texting! I can’t go deep here. For plan changes: reply Help, Reschedule, or Cancel — or open ${base}`
}

/** RESCHEDULE acknowledged. */
export function messageRescheduleAck(): string {
  return `We'll help you reschedule — we'll text you shortly to pick a new time.`
}

/** RESCHEDULE rejected: only allow one reschedule per person per Fika. */
export function messageRescheduleLimitReached(): string {
  return `Totally understand — to keep things simple, we can only reschedule once per Fika.\n\nReply Cancel to cancel this intro, or we’ll reach out with another intro soon.`
}

/** Notify the other person that their partner is rescheduling. */
export function messageRescheduleHeadsUpToOther(): string {
  return `Heads up — your Fika partner needs to reschedule. We’re proposing a new time now.`
}

/** CANCEL acknowledged. */
export function messageCancelAck(): string {
  return `Got your cancel — we'll follow up and let your Fika intro know.`
}

/** HELP: one static reply (no state-based routing). */
export function messageSmsHelp(): string {
  return `Visit letsfika.co for how it works. Reply Yes or Pass to match prompts when you get them.`
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
  return ['yes', 'yep', 'sure', 'sounds good', 'lets do it', "let's do it", 'ok', 'okay'].includes(k)
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
