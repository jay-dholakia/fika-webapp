/**
 * SMS agent: state machine, message templates, venue picker, slot↔day/window mapping.
 * Used by webhook and Edge Functions. Copy: we reach out by SMS when we find a good Fika intro; we text a time and place to confirm.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { haversineKm } from '@/lib/distance'
import { searchNearbyCafesGooglePlaces, upsertVenueFromGooglePlace } from '@/lib/google-places-venues'
import { DEFAULT_RADIUS_KM } from '@/lib/intake-radius'
import { SMS_PACING_MS } from '@/lib/sms-pacing'
import { isSensitiveWorkIntakeLabel, normalizeWorkIntakeLabel } from '@/lib/work-sensitive-intake'

export const SMS_STATES = {
  GLOBAL_READY: 'global_ready',
  // Social flow (global rows, match_id IS NULL)
  SOCIAL_INVITED: 'social_invited',
  SOCIAL_RSVP_ACCEPTED: 'social_rsvp_accepted',
  SOCIAL_MORNING_REMINDER: 'social_morning_reminder',
  SOCIAL_REVEAL_SENT: 'social_reveal_sent',
  // 1v1 flow (per-match rows, match_id NOT NULL)
  ONEV1_OFFERED: '1v1_offered',
  ONEV1_ACCEPTED: '1v1_accepted',
  ONEV1_AWAITING_AVAILABILITY: '1v1_awaiting_availability',
  ONEV1_PROPOSED: '1v1_proposed',
  ONEV1_CONFIRMED: '1v1_confirmed',
  ONEV1_MORNING_REMINDER: '1v1_morning_reminder',
  ONEV1_REMINDER_SENT: '1v1_reminder_sent',
} as const

const READY_FOR_INTRO_VARIANTS = [
  "You're in. We host Fika socials and set up curated 1-on-1 intros — we'll reach out when we have something for you.",
  "You're in. We set up two kinds of meetups: Fika socials and curated 1-on-1 intros. We'll text you when we have something.",
  "You're in. Expect two types of meetups — Fika socials and curated 1-on-1 intros. We'll reach out when the time's right.",
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

/** Get unique days from overlapping slot IDs for SMS day-pick prompts. */
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
  if (phone.includes('@')) return phone  // Apple ID email from Mac iMessage — preserve as-is
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
  if (place) return upsertVenueFromGooglePlace(supabase, place)

  // Final fallback: ignore user radius constraints and return closest DB venue to the pair
  if (hasValidLatLng(userA) && hasValidLatLng(userB)) {
    const anyVenue = await pickVenueFromDatabase(supabase, { ...userA, radius_km: 100 }, { ...userB, radius_km: 100 })
    if (anyVenue) return anyVenue
  }

  return null
}

// ---------- Message templates ----------
// After intake, we text when we have a good Fika intro; scheduling proposes a time and place by SMS for Yes/No confirmation.

/** One-line hint so users save the concierge number and don't miss intros. */
export function messageSaveAsContactHint(): string {
  return 'Save this number as Fika ☕ so you never miss an intro.'
}

export type TimedSmsMessage = {
  content: string
  delayAfterMs?: number
}

/** Same preset body as web/app “Text us” CTAs (`Hi — set me up for Fika.`). */
export const CONCIERGE_SIGNUP_SMS_BODY = 'Hi — set me up for Fika.'

/**
 * Opens the user’s SMS app to the concierge with {@link CONCIERGE_SIGNUP_SMS_BODY} prefilled (tap or share).
 * Uses `SENDBLUE_CONCIERGE_NUMBER` or `NEXT_PUBLIC_SENDBLUE_CONCIERGE_NUMBER`.
 */
export function buildConciergeSignupInviteSmsHref(): string | null {
  const raw =
    (process.env.SENDBLUE_CONCIERGE_NUMBER || process.env.NEXT_PUBLIC_SENDBLUE_CONCIERGE_NUMBER || '').trim()
  if (!raw) return null
  return `sms:${raw}?body=${encodeURIComponent(CONCIERGE_SIGNUP_SMS_BODY)}`
}

/** Invite-a-friend lines (prefilled SMS when configured, else plain concierge body text). */
function firstTimeEntryInviteBlock(): string {
  const inviteHref = buildConciergeSignupInviteSmsHref()
  return inviteHref
    ? `Know someone who'd want to join? Send them this:\n${inviteHref}`
    : `Know someone who'd want to join? They can text us:\n${CONCIERGE_SIGNUP_SMS_BODY}`
}

/** First-time sequence after signup (active market). Two SMS: confirmation, then referral. */
export function messageEntryFirstTimeMessages(
  _isAfterDeadline: boolean,
  _nextMondayPhrase: string = 'next Monday',
  _appBase: string = 'https://letsfika.vercel.app'
): TimedSmsMessage[] {
  return [
    { content: "You're in ☕ We'll reach out when we have a great intro for you.", delayAfterMs: SMS_PACING_MS.quickAck },
    { content: firstTimeEntryInviteBlock(), delayAfterMs: SMS_PACING_MS.quickAck },
  ]
}

/** First-time entry when user's market is inactive. Two SMS: confirmation, then referral. */
export function messageEntryFirstTimeMessagesInactiveMarket(
  _appBase: string = 'https://letsfika.vercel.app',
  _cityLabel?: string | null
): TimedSmsMessage[] {
  return [
    { content: "We're growing Fika in your area — we'll reach out when we have a great intro for you.", delayAfterMs: SMS_PACING_MS.quickAck },
    { content: firstTimeEntryInviteBlock(), delayAfterMs: SMS_PACING_MS.quickAck },
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
  return `You're in. We'll text you when we have a Fika social or a 1-on-1 intro lined up for you.`
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
  return `Quick reminder: when we have a time and place for your Fika, we'll text it to you.\n\nReply Yes or No to confirm.`
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
  return `You're almost set.\n\nWe just need a few more details to get you set up.`
}

export function messageWeeklyOptIn(): string {
  return pickReadyForIntroMessage()
}

/** Sent when user says Yes to the weekly opt-in. */
export function messageWeeklyOptInYes(): string {
  return `You're in ☕\n\nWe'll let you know who you're meeting shortly before the Fika. Text 'cancel' anytime before then if your plans change.`
}

/** Sent when user says No to the weekly opt-in. */
export function messageWeeklyOptInNo(): string {
  return `No worries — we'll reach out when there's a next one.`
}

/** Weekly opt-in SMS inviting user to a specific event. */

type RevealPronounPack = {
  /** e.g. She's, He's, They're, Ze's */
  contractLead: string
  loveVerbAfterAnd: 'loves' | 'love'
  standaloneLoveLead: string
}

const DEFAULT_REVEAL_PRONOUN_PACK: RevealPronounPack = {
  contractLead: "They're",
  loveVerbAfterAnd: 'love',
  standaloneLoveLead: 'They love',
}

/** Subject contraction + love phrasing from profile `pronouns` (e.g. she/her, they/them, ze/zir). */
function revealPronounPackFromProfilePronouns(raw: string | null | undefined): RevealPronounPack {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) return DEFAULT_REVEAL_PRONOUN_PACK

  const firstSegment =
    trimmed
      .split(/[/,\s]+/)
      .map((s) => s.trim())
      .find((s) => s.replace(/[^a-zA-Z]/g, '').length > 0) ?? trimmed
  const letters = firstSegment.replace(/[^a-zA-Z]/g, '')
  if (!letters) return DEFAULT_REVEAL_PRONOUN_PACK

  const lowered = letters.toLowerCase()
  if (lowered === 'she') {
    return { contractLead: "She's", loveVerbAfterAnd: 'loves', standaloneLoveLead: 'She loves' }
  }
  if (lowered === 'he') {
    return { contractLead: "He's", loveVerbAfterAnd: 'loves', standaloneLoveLead: 'He loves' }
  }
  if (lowered === 'they') {
    return { contractLead: "They're", loveVerbAfterAnd: 'love', standaloneLoveLead: 'They love' }
  }

  const cap = letters.charAt(0).toUpperCase() + letters.slice(1).toLowerCase()
  return {
    contractLead: `${cap}'s`,
    loveVerbAfterAnd: 'loves',
    standaloneLoveLead: `${cap} loves`,
  }
}

function truncateRevealWorkLabel(raw: string, max = 52): string {
  const t = raw.replace(/\s+/g, ' ').trim()
  if (!t) return ''
  if (t.length <= max) return t
  return `${t.slice(0, max - 1)}…`
}

/** Natural phrasing after pronoun contraction (avoid "He's a On sabbatical"). */
function revealWorkIntroFragment(pack: RevealPronounPack, workDisplay: string, rawForKey: string): string {
  const key = normalizeWorkIntakeLabel(rawForKey)
  if (key === 'on sabbatical') return `${pack.contractLead} on sabbatical`
  if (key === 'taking a career break') return `${pack.contractLead} taking a career break`
  return `${pack.contractLead} a ${workDisplay}`
}

/**
 * Reveal bubble (after user replies YES to see intro): Meet → job + loves → shared talk chips → meet ask.
 * Example: Meet Maya. She's a Graphic Designer and loves typography and film photography.
 * You both like talking about travel stories, creative side projects, and what's been making you laugh lately.
 * Want to meet for Fika? Reply with a Yes or No.
 */
export function formatMatchRevealSentence(params: {
  otherFirstName: string
  /** Profile `pronouns` for the other person (e.g. she/her, they/them). */
  otherPronouns?: string | null
  /** Intake `q_work` line for the other person (their job / how they describe work). */
  otherWorkLabel?: string | null
  sharedInterests: string[]
  conversationHooks: string[]
  /** Shared `q_like_talking_about` chip labels (exact overlap strings). */
  fikaTalkOverlap?: string[]
  /** e.g. "Wed, Jun 18 at 6pm" — included in reveal if venue is pre-set */
  dateLine?: string | null
  /** e.g. "Verve Coffee (Silver Lake)" — included in reveal if pre-set */
  venueLine?: string | null
  /** Intake `q_current_interest` — what they're into right now */
  currentInterest?: string | null
  /** Intake `q_friend_description` — how a close friend would describe them */
  friendDescription?: string | null
}): string {
  const { otherFirstName, otherPronouns, otherWorkLabel, sharedInterests, conversationHooks, fikaTalkOverlap = [], dateLine, venueLine, currentInterest, friendDescription } =
    params

  const pronounPack = revealPronounPackFromProfilePronouns(otherPronouns)

  const normalizeSmartPunctuation = (value: string): string =>
    value
      .replace(/[\u2018\u2019\u2032]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')

  const formatTopicList = (topics: string[]): string => {
    if (topics.length === 0) return ''
    if (topics.length === 1) return topics[0]!
    if (topics.length === 2) return `${topics[0]} and ${topics[1]}`
    return `${topics[0]}, ${topics[1]}, and ${topics[2]}`
  }

  const sanitizeInterest = (value: string): string => {
    const normalized = normalizeSmartPunctuation(value).trim().replace(/\.$/, '')
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
    const normalized = normalizeSmartPunctuation(topic).trim().replace(/\.$/, '')
    const lower = normalized.toLowerCase()

    if (
      lower.startsWith("what we're working on") ||
      lower.startsWith('what we are working on') ||
      lower.startsWith("what you're working on") ||
      lower.startsWith('what you are working on')
    ) {
      return 'work and projects'
    }
    if (lower.includes('swapping stories') && (lower.includes('chapter') || lower.includes('chapters'))) {
      return 'life stories and how you each got here'
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

  const sentenceCaseTopic = (topic: string): string =>
    /^[A-Z0-9]{2,}$/.test(topic) ? topic : topic.charAt(0).toLowerCase() + topic.slice(1)

  const name = otherFirstName.trim() || 'Someone'
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

  const interestsPhrase =
    interestTeaser.length === 0 ? '' : interestTeaser.length === 1 ? interestTeaser[0]! : `${interestTeaser[0]} and ${interestTeaser[1]}`

  const cleanedFikaTalk = fikaTalkOverlap
    .map((s) => normalizeSmartPunctuation(String(s)).trim())
    .filter(Boolean)
    .filter((s, i, arr) => arr.indexOf(s) === i)
  const fikaTeaser = cleanedFikaTalk.map(sentenceCaseTopic).slice(0, 3)

  const hookTalkFillers = remainingHooks
    .map(sentenceCaseTopic)
    .filter((topic, index, list) => topic && list.indexOf(topic) === index)
    .filter((t) => !fikaTeaser.some((f) => f.toLowerCase() === t.toLowerCase()))
    .slice(0, Math.max(0, 3 - fikaTeaser.length))

  const talkTeaser = [...fikaTeaser, ...hookTalkFillers].slice(0, 3)

  const rawWork = String(otherWorkLabel ?? '').trim()
  const workDisplay = isSensitiveWorkIntakeLabel(rawWork) ? '' : truncateRevealWorkLabel(rawWork)

  const profileSentence = (() => {
    if (workDisplay && interestsPhrase) {
      return `${revealWorkIntroFragment(pronounPack, workDisplay, rawWork)} and ${pronounPack.loveVerbAfterAnd} ${interestsPhrase}.`
    }
    if (workDisplay) {
      return `${revealWorkIntroFragment(pronounPack, workDisplay, rawWork)}.`
    }
    if (interestsPhrase) {
      return `${pronounPack.standaloneLoveLead} ${interestsPhrase}.`
    }
    return ''
  })()

  const talkSentence =
    talkTeaser.length > 0 ? `You both like talking about ${formatTopicList(talkTeaser)}.` : ''

  const currentInterestClean = currentInterest?.trim() || ''
  const friendDescriptionClean = friendDescription?.trim() || ''
  const subjectHave = pronounPack.contractLead.replace("'re", "'ve")
  const currentInterestSentence = currentInterestClean
    ? `${subjectHave} been ${currentInterestClean.charAt(0).toLowerCase() + currentInterestClean.slice(1).replace(/\.$/, '')}.`
    : ''
  const friendDescriptionSentence = friendDescriptionClean
    ? `Their friends describe them as ${friendDescriptionClean.charAt(0).toLowerCase() + friendDescriptionClean.slice(1).replace(/\.$/, '')}.`
    : ''

  if (dateLine?.trim() || venueLine?.trim()) {
    const contextParts = [profileSentence, currentInterestSentence, friendDescriptionSentence, talkSentence].filter(Boolean).join(' ')
    const timeParts = [dateLine?.trim(), venueLine?.trim()].filter(Boolean).join('\n')
    return [`Meet ${name}.`, contextParts, timeParts, 'Reply Yes to meet them, or No to pass.']
      .filter(Boolean)
      .join('\n\n')
  }
  const bits = [`Meet ${name}.`, profileSentence, currentInterestSentence, friendDescriptionSentence, talkSentence, 'Want to meet for Fika? Reply with a Yes or No.'].filter(Boolean)
  return bits.join(' ')
}

/** User confirmed intro for Fika Social but isn't at the event time yet (or time unknown). */
export function messageFikaSocialAwaitingEvent(): string {
  return `You're all set for this Fika Social. See you at the venue. Reply HELP if you need anything.`
}

/** While waiting for 👍/Yes to confirm after social intro reveal. */
export function messageFikaSocialConfirmNudge(): string {
  return `Reply 👍 or Yes to confirm you're coming to this Fika Social. (Or reply HELP.)`
}

/** Phase 2 teaser after both users say YES. */
export function messageTeaserPreview(params: {
  otherFirstName: string
  otherBio: string
}): string {
  const { otherFirstName, otherBio } = params
  return `Quick preview:\n\nYou'd be meeting ${otherFirstName}.\n${otherBio}`
}


/** Nudge when state is still AWAITING_AVAILABILITY (legacy state name; scheduling is proposal-first). */
export function messageAwaitingAvailabilityReady(): string {
  return `You're almost set.\n\nWhen we send a time and place, reply Yes if it works for you, or No if you'd like a different time. Reply Help anytime.`
}

/** Tuesday intro with full plan (one proposed time + venue). Reply Yes by 9 PM tonight. */
export function messageIntroWithPlan(params: {
  otherFirstName: string
  areaLabel: string
  day: string
  time: string
  venueName: string
  neighborhood: string
}): string {
  const { otherFirstName, areaLabel, day, time, venueName, neighborhood } = params
  return `You've been paired with ${otherFirstName}.\n\nYou both live near ${areaLabel} and are free ${day} evening.\n\nFika plan\n\n${day} — ${time}\n${venueName} (${neighborhood})\n\nReply Yes to confirm by 9 PM tonight.`
}

export function messageConversationContext(params: {
  sharedInterests: string[]
  starterQuestion: string
}): string {
  const { sharedInterests, starterQuestion } = params
  let text = `Here's a little context for your Fika:\n\nYou both mentioned:\n${sharedInterests.join(' and ')}\n\nA question you could kick things off with:\n\n"${starterQuestion}"`
  return text
}

export function messageVenueProposed(day: string, time: string, venueName: string, neighborhood: string): string {
  return `Looks like ${day} ${time.toLowerCase()} works for you both.\n\nHow about:\n\n${time} at ${venueName} in ${neighborhood}\n\nReply Confirm or Change`
}

export const FIKA_PROMPT_QUESTIONS: string[] = [
  "What's something you've changed your mind about in the last year?",
  "What does your ideal Saturday look like — and how close is your life to that?",
  "Is there a version of your life you almost lived?",
  "What are you most proud of that has nothing to do with work?",
  "What's a belief you hold that most people around you disagree with?",
  "What's something most people don't know about you that you wish they did?",
  "What's the best piece of advice you've ever received — and do you actually follow it?",
  "When did you last do something for the first time?",
  "What's a chapter of your life you rarely talk about but that shaped who you are?",
  "What does success look like for you in five years — and is that what you actually want?",
  "Is there something you keep putting off that you know would be good for you?",
  "What's a risk you've taken that you're glad you took?",
  "What's something you think about often that most people wouldn't expect?",
  "If your closest friend described you to a stranger, what would they say — and would you agree?",
  "What's the hardest thing you've navigated in the last couple of years?",
]

/** Deterministically pick two questions for a match so both users get the same prompts. */
export function pickFikaPromptQuestions(matchId: string): [string, string] {
  const hash = matchId.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)
  const n = FIKA_PROMPT_QUESTIONS.length
  const i = hash % n
  const j = (hash * 31 + 7) % n === i ? (hash * 31 + 7 + 1) % n : (hash * 31 + 7) % n
  return [FIKA_PROMPT_QUESTIONS[i], FIKA_PROMPT_QUESTIONS[j]]
}

export function messageDayOfReminder(time: string, venueName: string, neighborhood: string): string {
  return `Your Fika is today at ${time} ☕\n\n${venueName} (${neighborhood})\n\nText here if you're running late.`
}

export function messageOptInConfirmation(): string {
  return pickReadyForIntroMessage()
}

export function messageSkipped(): string {
  return `No worries. We’ll reach out again when we find another good Fika intro for you.`
}

export function messagePassConfirmation(): string {
  return `Got it.\n\nWe'll keep looking for someone who feels like a better fit.`
}

export function messageIntroNoLongerAvailable(): string {
  return `That intro is no longer available, but we'll send another intro soon.`
}

export function messageOptInWindowClosed(): string {
  return `Sorry, the opt-in window for this Fika has closed. We’ll reach out for the next one!`
}

export function messageOptInFilledUp(): string {
  return `This Fika has filled up — you’re first on the list for the next one! 🙌`
}

export function messageRsvpCancelled(): string {
  return `No worries — we’ll see you at a future Fika 👋`
}

export function messageEventCancelledByAdmin(): string {
  return `Unfortunately we’ve had to cancel this Fika. Really sorry for the inconvenience — we’ll have another one soon and hope to see you there.`
}

export function isCancellationSignal(text: string): boolean {
  const lower = text.toLowerCase().trim()
  return [
    "can’t make it", "cant make it", "cancel", "won’t be able", "wont be able",
    "i’m out", "im out", "nevermind", "never mind",
  ].some(phrase => lower.includes(phrase))
}

/** Notify the user who said YES when the other didn't respond before the intro expired. */
export function messageMatchExpiredOtherNoResponse(): string {
  return `This intro didn't come together, but thanks for being open to it. We'll reach out when we have another great intro.`
}

/** Notify the user who didn't respond before the intro expired. */
export function messageMatchExpiredYouNoResponse(_nextMondayPhrase: string = 'next Monday'): string {
  return `This one didn't come together.\n\nWe'll reach out when we find another good intro.`
}


/** STOP: we'll stop texting; account still on web. Text only; send webappUrl as a separate message after this. */
export function messageSmsOptOut(_webappUrl: string, _conciergeNumber: string): string {
  return `We'll stop texting you.\n\nIf you ever want back in, just text us here.`
}

/** When they text back after opting out. */
export function messageSmsOptBackIn(): string {
  return `You're back in.\n\nWe’ll reach out when we find a good Fika intro for you.`
}


/** HELP: one static reply (no state-based routing). */
export function messageSmsHelp(): string {
  return `Reply Yes or No when we send an intro.\n\nIf you need anything else, text us here.`
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

/** STOP / opt out. (Use keyword Cancel in the confirmed-Fika flow to cancel the intro — not listed here so it can route there.) */
export function isStopKeyword(content: string): boolean {
  const k = normalizeKeyword(content)
  return ['stop', 'unsubscribe', 'opt out', 'optout'].includes(k)
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
  opts: { match_id?: string; payload?: Record<string, unknown> }
): Promise<void> {
  const matchId = opts.match_id ?? null
  if (matchId == null) {
    await supabase.rpc('upsert_global_sms_conversation_state', {
      p_user_id: userId,
      p_state: state,
      p_payload: opts.payload ?? {},
      p_last_sendblue_message_handle: null,
    })
    return
  }
  await supabase.from('sms_conversation_states').upsert(
    {
      user_id: userId,
      match_id: matchId,
      state,
      payload: opts.payload ?? {},
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,match_id' }
  )
}
