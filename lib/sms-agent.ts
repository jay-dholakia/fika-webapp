/**
 * SMS agent: state machine, message templates, venue picker, slot↔day/window mapping.
 * Used by webhook and Edge Functions (cron).
 */

import type { SupabaseClient } from '@supabase/supabase-js'

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

/** Pick a venue for a match: first venue in same city as both users, or first by id. */
export async function pickVenueForMatch(
  supabase: SupabaseClient,
  userACity: string | null,
  userBCity: string | null
): Promise<{ id: string; name: string; neighborhood: string | null; city: string } | null> {
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
// Cadence: Monday opt-in → Tuesday morning intros run (deadline) → Wed–Sun meet.

/** First-time "you're all set" sequence: intro concierge + cadence. Returns 3 messages to send in order.
 * nextMondayPhrase = day-aware "tomorrow" | "Monday" | "next Monday" from getNextMondayPhrase(timezone).
 * appBase = site origin (no trailing slash), e.g. https://letsfika.vercel.app — used for portal link at end of msg 3. */
export function messageEntryFirstTimeMessages(isAfterDeadline: boolean, nextMondayPhrase: string = 'next Monday', appBase: string = 'https://letsfika.vercel.app'): string[] {
  const base = appBase.trim().replace(/\/$/, '') || 'https://letsfika.vercel.app'
  const msg1 = `You're in. I'm your Fika concierge — once a week I'll ask if you want a Fika, send you one intro, and help you set it up if you both say yes.`
  const msg2AfterDeadline = `This week's window is already closed, so I'll check in ${nextMondayPhrase}. Have a great week!`
  const msg2OnTime = `I'll check in ${nextMondayPhrase} to see if you're up for a Fika this week. Have a great week!`
  const msg2 = isAfterDeadline ? msg2AfterDeadline : msg2OnTime
  const msg3 = `To learn more or edit your profile: ${base}/app`
  return [msg1, msg2, msg3]
}

export function messageEntry(): string {
  return `Hey! I'm Fika — think of me as your friend who sets up intros. 😊\n\nEach week I match you with one person nearby for a real conversation. Want in this week? Reply IN or SKIP. If you're in, set your availability for Wed–Sun before Tuesday morning and we'll send your intro Tuesday morning.`
}

/** When sign-in completes after the Tuesday morning intro run — set expectation for next week. nextMondayPhrase = day-aware "tomorrow" | "Monday" | "next Monday". */
export function messageEntryAfterDeadline(
  nextMondayPhrase: string = 'next Monday',
  options?: { firstName?: string | null; isGreeting?: boolean }
): string {
  const base = `You're all set! This week's window has closed, but we'll text you ${nextMondayPhrase} so you can opt in for next week.`
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
  return `Want an intro this week? Just reply IN or SKIP — and if you're in, set your availability for Wed–Sun before Tuesday morning.`
}

/** When user is known but hasn't completed onboarding/intake — send link to finish profile. */
export function messageOnboardingRequired(onboardingUrl: string): string {
  return `Hey, we've got you in the system — just need a few more details before we can match you.\n\nFinish up here:\n\n${onboardingUrl}\n\nReply back once you're done and we'll send you the weekly intro.`
}

export function messageWeeklyOptIn(): string {
  return `Want a Fika intro this week? Reply IN or SKIP. If you're in, set your availability for Wed–Sun before Tuesday morning and we'll send your intro Tuesday morning.`
}

export function messageWeeklyOptInFollowUp(): string {
  return `Quick ping — reply IN or SKIP and set your availability before Tuesday morning to get your intro.`
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

export function messageYoureAllSet(day: string, time: string, venueName: string, neighborhood: string): string {
  return `You're all set for your Fika ☕\n\n${day} — ${time}\n${venueName} (${neighborhood})\n\nReach out here if you need to coordinate.`
}

export function messageDayOfReminder(time: string, venueName: string, neighborhood: string, starterQuestion?: string): string {
  let text = `Your Fika is today at ${time} at ${venueName} (${neighborhood}). We'll text you closer to the time with more details — and you can update your intro if you're running late.\n\nHope you both have a great conversation!`
  if (starterQuestion) {
    text += `\n\nA question you might enjoy:\n${starterQuestion}`
  }
  return text
}

export function messageOptInConfirmation(): string {
  return `You're in! We'll send your intro Tuesday morning.`
}

/** When user replies IN: send link to webapp availability page to finalize opt-in. */
export function messageOptInSetAvailability(availabilityUrl: string): string {
  return `Got it! Set your availability for Wed–Sun before Tuesday morning here:\n\n${availabilityUrl}\n\nWe'll send your intro Tuesday morning.`
}

export function messageSkipped(): string {
  return `No worries — we'll check in again next week.`
}

export function messagePassConfirmation(): string {
  return `Got it — we'll find someone else for you next time.`
}

/** First person said YES — waiting for the other to reply. */
export function messageYesWaitingForOther(): string {
  return `Nice — we'll let you know as soon as they reply.`
}

/** Notify the person who said YES when the other passed. */
export function messageMatchPassed(): string {
  return `They passed on this one — we'll send you another match next week.`
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

export type RelayIntent = 'here' | 'on_my_way' | 'running_late' | 'cant_make_it' | null

const RELAY_HERE = /\b(here|i'?m here|just got here|arrived)\b/i
const RELAY_ON_MY_WAY = /\b(on my way|heading over|leaving now|omw|on the way)\b/i
const RELAY_RUNNING_LATE = /\b(running late|gonna be late|be there in|running behind|late)\b/i
const RELAY_CANT_MAKE_IT = /\b(can'?t make it|something came up|not gonna make it|won'?t make it)\b/i

/** Detect day-of relay intent from message text. */
export function detectRelayIntent(text: string): RelayIntent {
  const t = text.trim().toLowerCase()
  if (RELAY_CANT_MAKE_IT.test(t)) return 'cant_make_it'
  if (RELAY_HERE.test(t)) return 'here'
  if (RELAY_ON_MY_WAY.test(t)) return 'on_my_way'
  if (RELAY_RUNNING_LATE.test(t)) return 'running_late'
  return null
}

/** Reply to sender after they send a relay update. */
export function messageRelayConfirmToSender(otherFirstName: string, intent: RelayIntent): string {
  const name = otherFirstName || 'your match'
  switch (intent) {
    case 'here':
      return `Got it — I'll let ${name} know you're there.`
    case 'on_my_way':
      return `I'll let ${name} know you're on your way.`
    case 'running_late':
      return `I'll let ${name} know you're running a bit behind.`
    case 'cant_make_it':
      return `I'll let ${name} know. We'll help you reschedule or find another time.`
    default:
      return `I'll pass it along to ${name}.`
  }
}

/** Message to the other person when their match sends a relay update. */
export function messageRelayToOther(senderFirstName: string, intent: RelayIntent): string {
  const name = senderFirstName || 'Your match'
  switch (intent) {
    case 'here':
      return `${name} is here.`
    case 'on_my_way':
      return `${name} is on their way.`
    case 'running_late':
      return `${name} is running a bit behind — no rush.`
    case 'cant_make_it':
      return `${name} can't make it today — something came up. We'll help you reschedule or match again.`
    default:
      return `${name} sent an update.`
  }
}

/** 3 hours before Fika: reminder + how to update your Fika intro if running late. */
export function messageThreeHourReminder(time: string, venueName: string, neighborhood: string): string {
  return `Your Fika is in about 3 hours — ${time} at ${venueName} (${neighborhood}).\n\nRunning late? Reply HERE when you arrive, or RUNNING LATE, and we'll let them know.`
}

/** Hint when they have a Fika today but message didn't match a relay intent. */
export function messageRelayHint(): string {
  return `You can update your Fika intro anytime — reply HERE when you arrive, ON MY WAY, RUNNING LATE, or CAN'T MAKE IT and we'll let them know.`
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

/** True if the Fika start time is in the past (no relay). Uses 60min grace so "running late" after start still relays. */
const RELAY_GRACE_MS = 60 * 60 * 1000

export function isFikaTimeInPast(batchWeek: string, slotId: string): boolean {
  const ms = getFikaTimeMs(batchWeek, slotId)
  return ms != null && ms + RELAY_GRACE_MS < Date.now()
}

/** When they text Concierge after Fika time: acknowledge, no relay, set expectation for feedback. */
export function messageFikaInPast(): string {
  return `Your Fika was earlier today — we can't pass along updates now. We'll reach out in a few hours to see how it went and get your feedback.`
}

/** Post-Fika: ask how it went and for feedback (sent ~2 hours after Fika). */
export function messagePostFikaFeedback(): string {
  return `How did your Fika go? We'd love to hear — just reply with any feedback.`
}

/** Reply after we store their post-Fika feedback (first time). */
export function messageThanksForFeedback(): string {
  return `Thanks for sharing — we really appreciate it.`
}

/** Reply when they've already sent feedback for this Fika and send more. */
export function messageThanksForFeedbackAgain(): string {
  return `Got it, thanks! We're always happy to hear from you.`
}

/** When we can't relay (e.g. no phone for other person). Don't promise retries. */
export function messageRelayCouldNotDeliver(): string {
  return `We couldn't get your update through this time — try reaching out to them directly if you can.`
}

/** STOP: we'll stop texting; account still on web; how to opt back in. */
export function messageSmsOptOut(webappUrl: string, conciergeNumber: string): string {
  return `We'll stop texting you. Your Fika account is still on the web: ${webappUrl}\n\nYou can manage or delete your account there, and text ${conciergeNumber} from the number we have on file whenever you want to start getting messages again.`
}

/** When they text back after opting out. */
export function messageSmsOptBackIn(): string {
  return `You're back in — we'll text you for the next round.`
}

/** Confirmed Fika upcoming: fun reminder + CTA. */
export function messageConfirmedUpcoming(day: string, time: string, venueName: string, neighborhood: string, webappUrl: string): string {
  return `Your Fika is coming up — ${day} at ${time} at ${venueName} (${neighborhood}). ☕\n\nQuestions? Need to reschedule or cancel? Reply with your question, or RESCHEDULE or CANCEL and we'll help. You can also manage your account here: ${webappUrl}`
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
  return `No worries — just reply IN or SKIP for this week and we'll go from there.`
}

export function fallbackOptedIn(): string {
  return `Set your availability before Tuesday morning using the link we sent — or reply LINK and we'll send it again.`
}

export function fallbackMatchOffered(): string {
  return `Reply YES if you'd like the intro, or PASS if not — we're here when you're ready.`
}

export function fallbackVenueProposed(): string {
  return `Reply CONFIRM when you're good with this spot (or CHANGE if you'd like somewhere else).`
}

export function fallbackSchedulingDay(): string {
  return `Reply with one or more days that work — WED, THU, FRI, SAT, or SUN.`
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
  return `You're all set. Reply anytime if you have questions or need to reschedule or cancel.`
}

export function fallbackGeneric(): string {
  return `Not sure what you need — reply HELP anytime, or IN/SKIP for this week's intro.`
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
