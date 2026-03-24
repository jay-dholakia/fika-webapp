// Minimal types for Supabase tables used by onboarding and portal.
// Align with your actual schema (profiles, intake_responses_v5, weekly_match_opt_ins).

export type ProfileRow = {
  id: string
  first_name: string | null
  birthdate: string | null // YYYY-MM-DD
  gender: string | null
  gender_preference: string | null
  age_preference: string | null
  pronouns: string | null
  relationship_status: string | null
  city: string | null
  lat: number | null
  lng: number | null
  market: string | null // City market slug for progress/opt-in (la, sf, nyc)
  /** weekly_pool = legacy DB value; inbound weekly FIKA path removed (admin-only). match_first = generic first contact */
  sms_intro_mode?: 'weekly_pool' | 'match_first' | null
  phone: string | null // E.164 for SMS (Sendblue)
  sms_opted_out_at?: string | null // ISO; when set, we don't send SMS until they text back
  languages?: string[] | null
  avatar_url?: string | null
  /** ISO timestamp when Persona government-ID verification succeeded */
  id_verified_at?: string | null
  persona_inquiry_id?: string | null
  intent_confirmed_at: string | null // ISO
  in_match_bowl?: boolean
  intro_balance?: number
  role?: string | null // 'user' | 'admin'; admin can access /admin
  updated_at?: string
  created_at?: string
}

export type IntakeResponseItem = {
  question_id: string
  question_text: string
  answer: string | number | string[]
  type: string
  answered_at: string // ISO
}

export type IntakeResponsesV5Row = {
  user_id: string
  responses: IntakeResponseItem[]
  availability_times?: string[] | null
  completed_at: string | null // ISO
  embed_vector?: string | number[] | null
  /** See `IntroCardSummary` in intro-card-summary.ts */
  intro_card_summary?: { paragraph: string; bullets: string[]; source?: string } | null
  updated_at?: string
  created_at?: string
}

export type WeeklyMatchOptInRow = {
  id?: string
  user_id: string
  batch_week: string // Monday date YYYY-MM-DD
  opted_in_at: string // ISO timestamp; row exists only when opted in
}

/** When a user is free for the week; independent of opt-in. */
export type WeeklyAvailabilityRow = {
  id?: string
  user_id: string
  batch_week: string // Monday date YYYY-MM-DD
  availability_slots?: string[] | null
  /** True after app save with slots; cleared when user texts READY */
  pending_sms_ready_confirmation?: boolean
  /** Set when inbound READY confirmed for this week */
  sms_ready_confirmed_at?: string | null
  updated_at?: string
}

export type ConversationRow = {
  id: string
  user_a: string | null
  user_b: string | null
  match_id: string | null
  conversation_type: string | null
  status: string | null
  last_activity_at: string | null // ISO
  created_at: string | null // ISO
}

export type MessageRow = {
  id: string
  conversation_id: string
  sender_type: string
  sender_id: string | null
  text: string
  created_at: string | null // ISO
}

/** SMS Concierge flow state per user (and optionally per match). */
export type SmsConversationStateRow = {
  id: string
  user_id: string
  batch_week: string | null // YYYY-MM-DD Monday
  match_id: string | null
  state: string
  payload: Record<string, unknown>
  last_sendblue_message_handle: string | null
  updated_at: string
  created_at: string
}

/** Suggested meetup venue (e.g. coffee shop). */
export type VenueRow = {
  id: string
  name: string
  neighborhood: string | null
  city: string
  address: string | null
  lat: number | null
  lng: number | null
  created_at: string | null
}

/** Post-Fika feedback: reply to "How did your Fika go?" SMS. One row per message. */
export type FikaFeedbackRow = {
  id: string
  match_id: string
  user_id: string
  content: string
  created_at: string // ISO
}
