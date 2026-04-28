// Minimal types for Supabase tables used by onboarding and portal.
// Align with your actual schema (profiles, intake_responses_v5, fika_socials, etc.).

import type { FikaSocialSessionStatus } from '@/lib/fika-social-session'

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
  /** SMS intro lane; DB allows match_first only. */
  sms_intro_mode?: 'match_first' | null
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
  week_anchor_monday: string | null // YYYY-MM-DD Monday
  match_id: string | null
  state: string
  payload: Record<string, unknown>
  last_sendblue_message_handle: string | null
  updated_at: string
  created_at: string
}

/** Admin fika social session (opt-in → close → matcher → approvals → intro SMS). */
export type FikaSocialSessionRow = {
  id: string
  market_slug: string
  venue_id: string
  week_anchor_monday: string
  radius_miles: number
  iana_tz: string
  fika_starts_at: string
  status: FikaSocialSessionStatus
  sunday_blast_sent_at: string | null
  opt_in_closes_at: string | null
  opt_in_closed_at: string | null
  match_run_at: string | null
  intro_sms_sent_at: string | null
  created_at: string
  updated_at: string
}

export type FikaSocialOptInRow = {
  id: string
  session_id: string
  user_id: string
  week_anchor_monday: string
  opted_in_at: string
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
