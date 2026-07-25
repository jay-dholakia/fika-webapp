// Minimal types for Supabase tables used by onboarding and portal.


export type ProfileRow = {
  id: string
  first_name: string | null
  birthdate: string | null // YYYY-MM-DD
  gender: string | null
  gender_preference: string | null
  age_preference: string | null
  pronouns: string | null
  relationship_status: string | null
  neighborhood: string | null
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

/** SMS Concierge flow state per user (and optionally per match). */
export type SmsConversationStateRow = {
  id: string
  user_id: string
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
