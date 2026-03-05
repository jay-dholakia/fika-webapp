/**
 * SMS agent: state machine, message templates, venue picker, slot↔day/window mapping.
 * Used by webhook and Edge Functions (cron).
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export const SMS_STATES = {
  AWAITING_OPT_IN: 'awaiting_opt_in',
  OPTED_IN: 'opted_in',
  MATCH_OFFERED: 'match_offered',
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

export function messageEntry(): string {
  return `Hi — I'm the Fika agent.\nEach week I introduce you to one thoughtful person nearby for a real conversation.\n\nI'll handle the intro and help coordinate the meetup.\n\nWant an introduction this week?\nReply YES or SKIP`
}

export function messageWeeklyOptIn(): string {
  return `Would you like a Fika introduction this week?\n\nReply IN or SKIP`
}

export function messageWeeklyOptInFollowUp(): string {
  return `Quick check — should I look for someone for you this week?\nIN / SKIP`
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
  let text = `I found someone you might enjoy meeting.\n\n${ageLine}\n${otherBio}\n\n`
  if (sharedInterests.length > 0) {
    text += `Shared interests:\n${sharedInterests.map((s) => `• ${s}`).join('\n')}\n\n`
  }
  text += `Potential conversation thread:\n${conversationThread}\n\nWould you like the introduction?\nReply YES or PASS`
  return text
}

export function messageConversationContext(params: {
  sharedInterests: string[]
  starterQuestion: string
}): string {
  const { sharedInterests, starterQuestion } = params
  let text = `Great — here's a little context for your Fika:\n\nYou both mentioned interest in:\n${sharedInterests.join(' and ')}\n\nA question you could start with:\n\n"${starterQuestion}"`
  return text
}

export function messageSchedulingDay(days: string[]): string {
  return `When might you be free for a quick coffee conversation?\n\n${days.join('\n')}\n\nReply with one or more days.`
}

export function messageSchedulingWindow(): string {
  return `What time window works best?\n\nMorning\nAfternoon\nEvening\n\nReply with one.`
}

export function messageVenueProposed(day: string, time: string, venueName: string, neighborhood: string): string {
  return `Looks like ${day} ${time.toLowerCase()} works for both of you.\n\nHow about:\n\n${time} at ${venueName} in ${neighborhood}\n\nReply CONFIRM or CHANGE`
}

export function messageYoureAllSet(day: string, time: string, venueName: string, neighborhood: string): string {
  return `You're all set for your Fika ☕\n\n${day} — ${time}\n${venueName} (${neighborhood})\n\nYou can coordinate here if needed.`
}

export function messageDayOfReminder(time: string, venueName: string, neighborhood: string, starterQuestion?: string): string {
  let text = `Your Fika conversation is today at ${time} at ${venueName} (${neighborhood}).\n\nHope you both enjoy it.`
  if (starterQuestion) {
    text += `\n\nOne question you might enjoy exploring:\n${starterQuestion}`
  }
  return text
}

export function messageOptInConfirmation(): string {
  return `You're in for this week. We'll send your match soon.`
}

/** When user replies IN: send link to webapp availability page to finalize opt-in. */
export function messageOptInSetAvailability(availabilityUrl: string): string {
  return `Got it. To finalize your opt-in, set your availability here so we can find a time that works:\n\n${availabilityUrl}\n\nOnce you're done, we'll shoot you a text later this week with your match.`
}

export function messageSkipped(): string {
  return `No problem — we'll check in again next week.`
}

export function messagePassConfirmation(): string {
  return `Got it — we'll look for someone else for you next time.`
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
