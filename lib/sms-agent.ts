/**
 * SMS agent: state machine, message templates, venue picker, slot↔day/window mapping.
 * Used by webhook and Edge Functions (cron).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { haversineKm } from '@/lib/distance'
import { DEFAULT_RADIUS_KM } from '@/lib/intake-radius'

export const SMS_STATES = {
  AWAITING_OPT_IN: 'awaiting_opt_in',
  OPTED_IN: 'opted_in',
  MATCH_OFFERED: 'match_offered',
  YES_WAITING: 'yes_waiting',
  AWAITING_SECOND_CONFIRM: 'awaiting_second_confirm',
  AWAITING_FIRST_CONFIRM: 'awaiting_first_confirm',
  ACCEPTED_SCHEDULING_DAY: 'accepted_scheduling_day',
  SCHEDULING_WINDOW: 'scheduling_window',
  VENUE_PROPOSED: 'venue_proposed',
  CONFIRMED: 'confirmed',
} as const

/** Slot id prefix (wed, thu, ...) to SMS day label */
const SLOT_DAY_TO_LABEL: Record<string, string> = {
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
 * Pick a venue for a match using lat/lng when both users have coordinates:
 * only considers venues within each user's willing-to-travel radius (from intake q_radius),
 * then chooses the venue that minimizes the maximum distance to either user (fair to both).
 * Falls back to city-based selection when lat/lng are missing.
 */
export async function pickVenueForMatch(
  supabase: SupabaseClient,
  userA: UserLocation,
  userB: UserLocation
): Promise<{ id: string; name: string; neighborhood: string | null; city: string } | null> {
  const userACity = userA.city ?? null
  const userBCity = userB.city ?? null
  const maxDistA = userA.radius_km != null && Number.isFinite(Number(userA.radius_km)) ? Number(userA.radius_km) : DEFAULT_RADIUS_KM
  const maxDistB = userB.radius_km != null && Number.isFinite(Number(userB.radius_km)) ? Number(userB.radius_km) : DEFAULT_RADIUS_KM

  if (hasValidLatLng(userA) && hasValidLatLng(userB)) {
    const latA = Number(userA.lat)
    const lngA = Number(userA.lng)
    const latB = Number(userB.lat)
    const lngB = Number(userB.lng)

    const { data: venues } = await supabase
      .from('venues')
      .select('id, name, neighborhood, city, lat, lng')
      .not('lat', 'is', null)
      .not('lng', 'is', null)

    if (venues?.length) {
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

      if (withScores.length > 0) {
        const { venue } = withScores[0]
        return { id: venue.id, name: venue.name, neighborhood: venue.neighborhood, city: venue.city }
      }
    }
  }

  const city = userACity || userBCity || 'Los Angeles'
  const { data } = await supabase
    .from('venues')
    .select('id, name, neighborhood, city')
    .ilike('city', `%${city}%`)
    .limit(1)
    .maybeSingle()
  if (data) return data
  const { data: fallback } = await supabase
    .from('venues')
    .select('id, name, neighborhood, city')
    .limit(1)
    .maybeSingle()
  return fallback
}

// ---------- Message templates ----------
// Cadence: Opt-in window Sunday 12am PT – Monday 11am PT (user texts FIKA); Monday 11am PT lock; Tuesday 9am PT intros; Tuesday 9pm PT confirm; Wed–Sat meet.

/** One-line hint so users save the concierge number and don't miss intros. */
export function messageSaveAsContactHint(): string {
  return 'Save this number as Fika ☕ so you never miss an intro.'
}

/** First-time "you're all set" sequence after signup (active market). Returns 4 messages (URL standalone).
 * isAfterDeadline = this week's Fika window already closed. */
export function messageEntryFirstTimeMessages(isAfterDeadline: boolean, _nextMondayPhrase: string = 'next Monday', appBase: string = 'https://letsfika.vercel.app'): string[] {
  const base = appBase.trim().replace(/\/$/, '') || 'https://letsfika.vercel.app'
  const msg1 = `You're in.\n\nOnce a week you can opt into a Fika — a thoughtful introduction to someone nearby.`
  const msg2AfterDeadline = `This week's opt-in window has already closed (opens Sunday 12am PT, ends Monday 11am PT).\n\nText FIKA next Sunday to opt in.`
  const msg2OnTime = `Opt-in window opens Sunday 12am PT and ends Monday 11am PT — text FIKA in that window to join.`
  const msg2 = isAfterDeadline ? msg2AfterDeadline : msg2OnTime
  const msg3 = `To edit your profile or learn more, use the link I'll send next.`
  const msg4Link = `${base}/app`
  return [msg1, msg2, msg3, msg4Link]
}

/** First-time entry when user's market is inactive. Returns 3 messages (URL standalone). */
export function messageEntryFirstTimeMessagesInactiveMarket(
  appBase: string = 'https://letsfika.vercel.app',
  cityLabel?: string | null
): string[] {
  const base = appBase.trim().replace(/\/$/, '') || 'https://letsfika.vercel.app'
  const city = cityLabel?.trim() || 'your city'
  const msg1 = `You're in.\n\nWe're still building the Fika community in ${city}. Keep an eye on your portal for updates when we launch.`
  const msg2 = `To edit your profile or learn more, use the link I'll send next.`
  const msg3Link = `${base}/app`
  return [msg1, msg2, msg3Link]
}

/** One-time when a market is turned active: inform user they can text FIKA to opt in. */
export function messageMarketGoLive(cityLabel: string, _nextMondayPhrase: string = 'next Monday'): string {
  return `Fika is live in ${cityLabel}! Text FIKA during the weekly opt-in window (Sunday 12am PT – Monday 11am PT) to get that week's intro.`
}

/** Reply when user in an inactive market texts in. Opt-in window / text FIKA is only for active markets. */
export function messageInactiveMarketReply(placeLabel: string): string {
  const city = placeLabel?.trim() || 'your city'
  return `We're still building the Fika community in ${city}. Keep an eye on your portal for updates when we launch.`
}

export function messageEntry(): string {
  return `Hey! Welcome to Fika. 😊\n\nEach week I check in to see if you’re up for a Fika, send you one thoughtful intro nearby, and help you set it up if you both say yes. Want in this week? Reply Yes or Skip. If you're in, set your availability for Wed–Sat by Monday 12pm PT and we'll send your intro Tuesday 9am PT.`
}

/** When they text after the opt-in window closed (Monday 11am PT). Window opens Sunday 12am PT, ends Monday 11am PT; they must text FIKA next Sunday. */
export function messageEntryAfterDeadline(
  _nextMondayPhrase: string = 'next Monday',
  options?: { firstName?: string | null; isGreeting?: boolean }
): string {
  const base = `This week's opt-in window has closed (it opens Sunday 12am PT and ends Monday 11am PT). Text FIKA next Sunday to opt in for next week.`
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
  return `Want an intro this week? Just reply Yes or Skip — and if you're in, set your availability for Wed–Sat by Monday 12pm PT.`
}

/** User-initiated opt-in: commitment line when they text FIKA. */
export function messageFikaUserInitiatedCommitment(): string {
  return `You're in for this week's Fika.`
}

/** User-initiated opt-in: body before availability link (link sent as separate message). */
export function messageFikaUserInitiatedLinkBody(_availabilityUrl: string): string {
  return `Set your availability between Wednesday and Saturday using the link I'll send next.\n\nYou can update it until Monday at 11 AM PT.`
}

/** When they message with no state (haven't texted FIKA this week). */
export function messageTextFikaToGetLink(): string {
  return `Text FIKA to join this week's introductions.`
}

/** Sunday evening: reminder to set availability (only if not submitted). Text only; send availability link as separate message. */
export function messageAvailabilityReminder(_availabilityUrl: string): string {
  return `Quick reminder to set your availability for this week's Fika.\n\nPlease submit it by 11 AM PT tomorrow.`
}

/** Monday 11 AM PT: availability submitted — all set. */
export function messageAvailabilityLockAllSet(): string {
  return `You're all set for this week's Fika.\n\nWe'll send your introduction tomorrow morning.`
}

/** Monday 11 AM PT: availability not submitted in time. */
export function messageAvailabilityLockNotSubmitted(): string {
  return `Looks like availability wasn't submitted in time for this week.\n\nYou can opt in again next Sunday.`
}

/** When user is known but hasn't completed onboarding/intake. Text only; send onboardingUrl as a separate message after this. */
export function messageOnboardingRequired(_onboardingUrl: string): string {
  return `Hey, we've got you in the system — just need a few more details before we can match you.\n\nFinish up using the link I'll send next.\n\nReply back once you're done and we'll send you the weekly intro.`
}

export function messageWeeklyOptIn(): string {
  return `Want a Fika intro this week? Reply Yes or Skip. If you're in, set your availability for Wed–Sat by Monday 12pm PT and we'll send your intro Tuesday 9am PT.`
}

export function messageWeeklyOptInFollowUp(): string {
  return `Quick ping — reply Yes or Skip and set your availability by Monday 12pm PT to get your intro.`
}

export function messageMatchOffer(params: {
  otherFirstName: string
  otherAge: number | null
  otherBio: string
  sharedInterests: string[]
  conversationThread: string
}): string {
  const { otherFirstName, otherAge, otherBio, sharedInterests, conversationThread } = params
  const ageLine = otherAge != null ? `${otherFirstName}, ${otherAge}` : otherFirstName
  let text = `Found someone you might really vibe with.\n\n${ageLine}\n${otherBio}\n\n`
  if (sharedInterests.length > 0) {
    text += `You've both got:\n${sharedInterests.map((s) => `• ${s}`).join('\n')}\n\n`
  }
  text += `Something to talk about:\n${conversationThread}\n\nWant the intro? Reply YES or PASS`
  return text
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
  return `You've been matched with ${otherFirstName}.\n\nYou both live near ${areaLabel} and are free ${day} evening.\n\nFika plan\n\n${day} — ${time}\n${venueName} (${neighborhood})\n\nReply YES to confirm by 9 PM tonight.`
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
  return `Looks like ${day} ${time.toLowerCase()} works for you both.\n\nHow about:\n\n${time} at ${venueName} in ${neighborhood}\n\nReply CONFIRM or CHANGE`
}

/** Both confirmed — Fika is locked in. */
export function messageYoureAllSet(day: string, time: string, venueName: string, neighborhood: string): string {
  return `Your Fika is confirmed ☕\n\n${day} — ${time}\n${venueName} (${neighborhood})\n\nNeed to coordinate or update anything? Just reply here.`
}

export function messageDayOfReminder(time: string, venueName: string, neighborhood: string, starterQuestion?: string): string {
  let text = `Your Fika is today at ${time} at ${venueName} (${neighborhood}). We'll text you closer to the time with more details — and you can update your intro if you're running late.\n\nHope you both have a great conversation!`
  if (starterQuestion) {
    text += `\n\nA question you might enjoy:\n${starterQuestion}`
  }
  return text
}

export function messageOptInConfirmation(): string {
  return `You're in! We'll send your intro Tuesday 9am PT.`
}

/** When user replies YES (legacy): send availability link. Text only; send availabilityUrl as a separate message after this. */
export function messageOptInSetAvailability(_availabilityUrl: string): string {
  return `You're all set for this week's Fika.\n\nSet your availability between Wednesday and Saturday using the link I'll send next. You can update it until Monday at 11 AM PT.`
}

export function messageSkipped(): string {
  return `No worries — text FIKA next Sunday to join that week's introductions.`
}

export function messagePassConfirmation(): string {
  return `Got it — we'll find someone else for you next time.`
}

/** First person said YES — waiting for the other to confirm. */
export function messageYesWaitingForOther(): string {
  return `Nice — we'll let you know as soon as they confirm.`
}

/** Notify the person who said YES when the other passed or intro didn't get confirmed. */
export function messageMatchPassed(): string {
  return `This week's Fika didn't get confirmed.\n\nYou can opt in again next Sunday.`
}

/** Sent when opt-in window closes (Monday 11am PT) to users who didn't opt in. */
export function messageOptInWindowClosed(_nextMondayPhrase: string = 'next Monday'): string {
  return `This week's opt-in window has closed (Sunday 12am PT – Monday 11am PT). Text FIKA next Sunday to opt in.`
}

/** Notify the user who said YES when the other didn't respond by Tuesday 9pm PT (intro expired). */
export function messageMatchExpiredOtherNoResponse(): string {
  return `This week's Fika didn't get confirmed.\n\nYou can opt in again next Sunday.`
}

/** Notify the user who didn't respond to the intro by Tuesday 9pm PT (intro expired). */
export function messageMatchExpiredYouNoResponse(_nextMondayPhrase: string = 'next Monday'): string {
  return `This week's Fika didn't get confirmed.\n\nYou can opt in again next Sunday.`
}

/** When someone declines the proposed time/venue (after both said YES to intro). */
export function messageProposalDeclined(): string {
  return `No problem — we'll match you again next week.`
}

/** When we've offered 2 times and still no match (max retries reached). */
export function messageProposalMaxRetries(): string {
  return `We couldn't find a time that works for both — we'll match you again next week.`
}

/** Notify the other person when their match declines the proposed time. */
export function messageProposalDeclinedToOther(): string {
  return `They couldn't do this time — we'll send you another match next week.`
}

/** Re-propose a new time to the person who declined (attempt 2). */
export function messageReProposalToDecliner(params: { day: string; time: string; venueName: string; neighborhood: string }): string {
  const { day, time, venueName, neighborhood } = params
  return `How about ${day} ${time} at ${venueName} (${neighborhood})?\n\nReply YES or NO.`
}

/** Notify the other person we're trying a different time. */
export function messageReProposalToOther(params: { day: string; time: string; venueName: string; neighborhood: string }): string {
  const { day, time, venueName, neighborhood } = params
  return `They couldn't do that time — how about ${day} ${time} at ${venueName} (${neighborhood})?\n\nReply YES to confirm.`
}

/** Propose one time from shared availability; ask them to confirm. Second YES-er gets this first, then first YES-er. */
export function messageProposalToConfirm(params: {
  otherFirstName: string
  day: string
  time: string
  venueName: string
  neighborhood: string
}): string {
  const { otherFirstName, day, time, venueName, neighborhood } = params
  return `You're matched with ${otherFirstName}.\n\n${day} ${time} at ${venueName} (${neighborhood}).\n\nReply YES to confirm.`
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

/** Fika date (YYYY-MM-DD) from batch_week (Monday) + slotId (e.g. wed_14_30). */
export function getFikaDateFromSlot(batchWeek: string, slotId: string): string {
  const monday = new Date(batchWeek + 'T12:00:00Z')
  const dayMap: Record<string, number> = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 }
  const dayPrefix = slotId.slice(0, 3).toLowerCase()
  const offset = dayMap[dayPrefix] ?? 2
  monday.setUTCDate(monday.getUTCDate() + offset)
  return monday.toISOString().slice(0, 10)
}

/** Today's date (YYYY-MM-DD) in America/Los_Angeles. */
export function getTodayPT(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
}

/** True if the Fika for this match is today (PT). */
export function isFikaToday(batchWeek: string, slotId: string): boolean {
  return getFikaDateFromSlot(batchWeek, slotId) === getTodayPT()
}

const DAY_OFFSET: Record<string, number> = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 }

/** Fika start time in ms (PT, using PST -08:00). Used to block relay after Fika and for post-Fika timing. */
export function getFikaTimeMs(batchWeek: string, slotId: string): number | null {
  const monday = new Date(batchWeek + 'T12:00:00Z')
  const prefix = slotId.slice(0, 3).toLowerCase()
  const offset = DAY_OFFSET[prefix] ?? 2
  monday.setUTCDate(monday.getUTCDate() + offset)
  const dateStr = monday.toISOString().slice(0, 10)
  const parts = slotId.split('_')
  const hour = parseInt(parts[1] ?? '14', 10)
  const min = parseInt(parts[2] ?? '0', 10)
  const iso = `${dateStr}T${hour.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}:00-08:00`
  const d = new Date(iso)
  return isNaN(d.getTime()) ? null : d.getTime()
}

/** True if now is inside relay window: 3h before start through 2h after start. */
export function isInRelayWindow(batchWeek: string, slotId: string): boolean {
  const ms = getFikaTimeMs(batchWeek, slotId)
  if (ms == null) return false
  const now = Date.now()
  const opensAt = ms - 3 * 60 * 60 * 1000
  const closesAt = ms + 2 * 60 * 60 * 1000
  return now >= opensAt && now <= closesAt
}

/** True if relay window has already closed for this Fika. */
export function isRelayClosed(batchWeek: string, slotId: string): boolean {
  const ms = getFikaTimeMs(batchWeek, slotId)
  return ms != null && Date.now() > ms + 2 * 60 * 60 * 1000
}

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
  return `You're back in.\n\nText FIKA on Sunday to join the next round of introductions.`
}

/** Confirmed Fika upcoming: reminder. Text only; send webappUrl as a separate message after this. */
export function messageConfirmedUpcoming(day: string, time: string, venueName: string, neighborhood: string, _webappUrl: string): string {
  return `Your Fika is coming up — ${day} at ${time} at ${venueName} (${neighborhood}). ☕\n\nQuestions? Reply RESCHEDULE or CANCEL and we'll help. I'll send you the link to manage your account next.`
}

/** RESCHEDULE acknowledged. */
export function messageRescheduleAck(): string {
  return `We'll help you reschedule — we'll text you shortly to pick a new time.`
}

/** CANCEL acknowledged. */
export function messageCancelAck(): string {
  return `Got your cancel — we'll follow up and let your Fika intro know.`
}

// ---------- Human fallbacks when message doesn't match a keyword ----------

export function fallbackAwaitingOptIn(): string {
  return `Text FIKA anytime Sunday to join that week's introductions.`
}

export function fallbackOptedIn(): string {
  return `Set your availability using the link we sent, or reply LINK to receive it again.`
}

export function fallbackMatchOffered(): string {
  return `Reply YES to confirm your Fika plan.`
}

export function fallbackVenueProposed(): string {
  return `Reply CONFIRM when you're good with this spot (or CHANGE if you'd like somewhere else).`
}

export function fallbackSchedulingDay(): string {
  return `Reply with one or more days that work — WED, THU, FRI, or SAT.`
}

export function fallbackSchedulingWindow(): string {
  return `Reply with one: MORNING, AFTERNOON, or EVENING.`
}

export function fallbackYesWaiting(): string {
  return `We'll let you know as soon as they reply — hang tight!`
}

export function fallbackAwaitingConfirm(): string {
  return `Reply YES to confirm this time and venue — almost there!`
}

export function fallbackConfirmed(): string {
  return `You're all set. Reply anytime if you need help.`
}

export function fallbackGeneric(): string {
  return `Not sure what you need — reply HELP anytime.`
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

/** STOP / opt out. */
export function isStopKeyword(content: string): boolean {
  const k = normalizeKeyword(content)
  return ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel'].includes(k)
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

/** Human fallback / help message for a given state. */
export function getFallbackForState(state: string): string {
  switch (state) {
    case SMS_STATES.AWAITING_OPT_IN:
      return fallbackAwaitingOptIn()
    case SMS_STATES.OPTED_IN:
      return fallbackOptedIn()
    case SMS_STATES.MATCH_OFFERED:
      return fallbackMatchOffered()
    case SMS_STATES.VENUE_PROPOSED:
      return fallbackVenueProposed()
    case SMS_STATES.ACCEPTED_SCHEDULING_DAY:
      return fallbackSchedulingDay()
    case SMS_STATES.SCHEDULING_WINDOW:
      return fallbackSchedulingWindow()
    case SMS_STATES.YES_WAITING:
      return fallbackYesWaiting()
    case SMS_STATES.AWAITING_SECOND_CONFIRM:
    case SMS_STATES.AWAITING_FIRST_CONFIRM:
      return fallbackAwaitingConfirm()
    case SMS_STATES.CONFIRMED:
      return fallbackConfirmed()
    default:
      return fallbackGeneric()
  }
}

/** Get or create SMS conversation state (for entry message after onboarding). */
export async function getOrCreateSmsState(
  supabase: SupabaseClient,
  userId: string,
  state: string,
  opts: { batch_week?: string; match_id?: string; payload?: Record<string, unknown> }
): Promise<void> {
  const batchWeek = opts.batch_week ?? null
  const matchId = opts.match_id ?? null
  if (matchId == null) {
    await supabase.rpc('upsert_global_sms_conversation_state', {
      p_user_id: userId,
      p_batch_week: batchWeek,
      p_state: state,
      p_payload: opts.payload ?? {},
      p_last_sendblue_message_handle: null,
    })
    return
  }
  await supabase.from('sms_conversation_states').upsert(
    {
      user_id: userId,
      batch_week: batchWeek,
      match_id: matchId,
      state,
      payload: opts.payload ?? {},
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,batch_week,match_id' }
  )
}
