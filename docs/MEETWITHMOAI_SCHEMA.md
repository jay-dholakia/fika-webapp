# meetwithmoai Supabase schema (Fika backend)

This document summarizes the **meetwithmoai** Supabase project (`hgllvhohhyamsbljekrd`) so the Fika webapp can use it as the backend. The platform already supports in-person one-on-one matching and conversation.

---

## Project details

| Property | Value |
|----------|--------|
| **Project ID** | `hgllvhohhyamsbljekrd` |
| **Project name** | meetwithmoai |
| **API URL** | `https://hgllvhohhyamsbljekrd.supabase.co` |
| **Region** | us-west-1 |
| **Status** | ACTIVE_HEALTHY |

Use `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or anon key) in the Fika frontend; get the publishable key from the [Supabase Dashboard](https://supabase.com/dashboard/project/hgllvhohhyamsbljekrd/settings/api) if needed.

---

## Public tables

### `waitlist`

Landing-page waitlist signups (Fika webapp). Anonymous insert allowed; read via service_role.

| Column | Type | Nullable | Notes |
|--------|------|----------|--------|
| `id` | uuid | NO | PK, default gen_random_uuid() |
| `email` | text | NO | Unique (lowercase) |
| `city` | text | YES | From Google Places or free text |
| `state` | text | YES | |
| `created_at` | timestamptz | YES | default now() |

**RLS:** anon can INSERT; service_role can SELECT.

---

### `profiles`

User profile (extends `auth.users` via `id`).

| Column | Type | Nullable | Notes |
|--------|------|----------|--------|
| `id` | uuid | NO | PK, references auth.users |
| `first_name` | varchar | NO | |
| `city` | varchar | YES | |
| `lat` | numeric | YES | |
| `lng` | numeric | YES | |
| `avatar_url` | text | YES | |
| `bio_text` | text | YES | |
| `pronouns` | text | YES | |
| `relationship_status` | text | YES | |
| `languages` | array | YES | |
| `birthdate` | date | YES | |
| `in_match_bowl` | boolean | YES | In matching pool |
| `intent_confirmed_at` | timestamptz | YES | Onboarding / intent confirmed |
| `is_active` | boolean | YES | |
| `is_paused` | boolean | YES | |
| `created_at` | timestamptz | YES | |
| `updated_at` | timestamptz | YES | |
| `sms_intro_mode` | text | YES | Check: **`match_first` only** (legacy `weekly_pool` cohort and DB values removed in `20260430200000_drop_legacy_weekly_pool_tables.sql`). |

**RLS:** Users can SELECT own profile; SELECT other profiles only if they share a `match_candidates` row; INSERT/UPDATE own profile only.  
To allow the intro modal to read a matched user’s profile, apply `docs/RLS_PROFILES_MATCHED_USERS.sql` in the SQL Editor (same pattern as `docs/RLS_INTAKE_MATCHED_USERS.sql` for intake).

---

### `intake_responses_v5`

Onboarding / intake with embeddings for similarity-based matching.

| Column | Type | Nullable | Notes |
|--------|------|----------|--------|
| `user_id` | uuid | NO | FK to profiles |
| `life_stage` | array | YES | |
| `availability_times` | array | YES | |
| `responses` | jsonb | NO | Open-ended and structured answers |
| `embed_vector` | vector | YES | For similarity search |
| `completed_at` | timestamptz | YES | |
| `created_at` | timestamptz | YES | |
| `updated_at` | timestamptz | YES | |

**RLS:** Users can SELECT/INSERT/UPDATE own row; service_role has full access (e.g. for matching jobs).  
To let the Fika app show a match’s questionnaire in the intro modal, add a policy that allows SELECT on another user’s row when the two users share an active `match_candidates` row—see `docs/RLS_INTAKE_MATCHED_USERS.sql`.

---

### `match_candidates`

Pre-computed pairs of users (matches), with score and reasons (similarities/differences).

| Column | Type | Nullable | Notes |
|--------|------|----------|--------|
| `id` | uuid | NO | PK |
| `user_a` | uuid | NO | FK profiles |
| `user_b` | uuid | NO | FK profiles |
| `score` | numeric | YES | Match score |
| `reasons` | jsonb | YES | Similarities / differences / tags |
| `status` | varchar | YES | e.g. pending, accepted, expired |
| `created_at` | timestamptz | YES | |
| `expires_at` | timestamptz | YES | |
| `last_shown_to_a` | timestamptz | YES | |
| `last_shown_to_b` | timestamptz | YES | |
| `week_anchor_monday` | date | YES | Anchor week (replaces legacy `batch_week`) |
| `weekly_fika_session_id` | uuid | YES | When set, this row belongs to hybrid **weekly Fika** admin flow |
| `admin_approval_status` | text | YES | e.g. `pending`, `approved`, `rejected` (weekly lane); ad hoc rows often `approved` |
| `admin_approval_at` | timestamptz | YES | |
| `weekly_intro_sms_sent_at` | timestamptz | YES | Step-2 intro SMS for approved weekly rows |
| *(scheduling)* | various | YES | `overlapping_slot_ids`, `default_slot_id`, `confirmed_slot_id`, `scheduling_status`, venues, reminders — see live DB |

**RLS:** Users can SELECT only rows where they are `user_a` or `user_b`; “system” (e.g. service_role) can manage all rows.

---

### `opt_ins`

User decision on a match (yes/no), with optional payment fields.

| Column | Type | Nullable | Notes |
|--------|------|----------|--------|
| `id` | uuid | NO | PK |
| `match_id` | uuid | NO | FK match_candidates |
| `user_id` | uuid | NO | FK profiles |
| `decision` | varchar | NO | e.g. yes / no |
| `stripe_payment_intent_id` | varchar | YES | |
| `stripe_setup_intent_id` | varchar | YES | |
| `payment_status` | varchar | YES | |
| `payment_amount` | integer | YES | |
| `created_at` | timestamptz | YES | |
| `updated_at` | timestamptz | YES | |

**RLS:** Users can SELECT/INSERT/UPDATE own opt_ins only.

---

### `conversations`

One-on-one conversation between two users (and optional AI). Tied to a match when `conversation_type = 'match'`.

| Column | Type | Nullable | Notes |
|--------|------|----------|--------|
| `id` | uuid | NO | PK |
| `user_a` | uuid | YES | FK profiles |
| `user_b` | uuid | YES | FK profiles |
| `match_id` | uuid | YES | FK match_candidates |
| `conversation_type` | varchar | YES | `'general'` or `'match'` |
| `ai_present` | boolean | YES | |
| `ai_intro_sent` | boolean | YES | |
| `status` | varchar | YES | |
| `opened_at` | timestamptz | YES | |
| `last_activity_at` | timestamptz | YES | |
| `created_at` | timestamptz | YES | |

**RLS:** Users can SELECT conversations where they are `user_a` or `user_b`.  
**Constraint:** `conversation_type IN ('general', 'match')`.

---

### `messages`

Messages inside a conversation.

| Column | Type | Nullable | Notes |
|--------|------|----------|--------|
| `id` | uuid | NO | PK |
| `conversation_id` | uuid | YES | FK conversations |
| `sender_type` | varchar | NO | e.g. user / ai |
| `sender_id` | uuid | YES | User id when sender_type = user |
| `text` | text | NO | |
| `metadata` | jsonb | YES | |
| `created_at` | timestamptz | YES | |

**RLS:** Users can SELECT messages in conversations they’re part of; INSERT allowed for their conversations (policy wording may allow only in “their” convos).

---

### `cooldowns`

Prevents re-matching the same pair too soon.

| Column | Type | Nullable | Notes |
|--------|------|----------|--------|
| `id` | uuid | NO | PK |
| `user_a` | uuid | NO | |
| `user_b` | uuid | NO | |
| `last_matched_at` | timestamptz | YES | |
| `cooldown_until` | timestamptz | YES | |

**RLS:** Users can SELECT cooldowns where they are user_a or user_b; “system” can manage all.

---

### `weekly_fika_sessions` (replaces removed weekly pool tables)

Admin-defined **hybrid weekly** Fika for one market + venue + week. See `20260430150000_weekly_fika_sessions_schema.sql`. Full column list: use Supabase Table Editor or `information_schema` — key fields include `market_slug`, `venue_id`, `week_anchor_monday`, `radius_miles`, `iana_tz`, `fika_starts_at`, `status`, and ops timestamps (`sunday_blast_sent_at`, `opt_in_closes_at`, etc.).

### `weekly_fika_session_opt_ins`

Per-session YES opt-ins; unique `(user_id, week_anchor_monday)`. **Removed:** `weekly_match_opt_ins`, `weekly_availability` (`20260430200000_drop_legacy_weekly_pool_tables.sql`).

---

### Other tables

Core product tables (`waitlist`, `venues`, `markets`, SMS state, etc.) are listed above or in migrations. Legacy **`blocks`**, **`reports`**, **`intro_ledger`**, **`coach_invites`**, and **`ai_chat_history`** were removed in `20260430240000_drop_unused_legacy_tables.sql` (unused by this codebase).

---

## Relevant functions (public)

- **count_active_match_candidates** – Count active match candidates (e.g. for a user or batch).
- **count_active_match_chats** – Count active match-type conversations.
- **get_matched_users_intake** – Get intake data for matched users (for showing similarities/differences).
- **get_open_ended_text_for_embedding** – Build text from intake for embedding (used for similarity).
- **users_in_cooldown** – Check if two users are in cooldown.
- **calculate_age** – Likely used with `profiles.birthdate`.
- **update_updated_at_column** / **update_intake_v5_updated_at** – Triggers for `updated_at`.

Use these from the Fika app (via RPC or by wrapping in Edge Functions) for match counts, cooldowns, and intake display.

---

## Flow relevant to Fika

1. **Profiles** – User identity and location (city, lat/lng), bio, demographics.
2. **Intake (intake_responses_v5)** – Preferences and open-ended answers; `embed_vector` drives similarity.
3. **Matching** – Ad hoc: admin simulation + **`sms-match-delivery`** with explicit `match_ids`. Weekly: admin **`weekly_fika_sessions`** lifecycle + matcher writes **`match_candidates`** with `weekly_fika_session_id` and `admin_approval_status`.
4. **Weekly session opt-in** – **`weekly_fika_session_opt_ins`** (per published session), not the removed global weekly pool tables.
5. **Opt-in to a match** – User accepts/declines via **opt_ins** (and optional payment).
6. **Conversation** – When both opt in, create **conversations** with `conversation_type = 'match'` and `match_id`; **messages** for chat.
7. **Cooldowns** – **cooldowns** table used so the same pair isn’t re-matched too soon.

---

## Fika webapp integration

- **Auth:** Supabase Auth; `profiles.id` = `auth.uid()`.
- **Landing / onboarding:** Create/update `profiles`, create/update `intake_responses_v5` (and call any embedding pipeline you use).
- **Match feed:** Query `match_candidates` for current user; join `profiles` (RLS allows it for matched users) and optionally `get_matched_users_intake` to show reasons.
- **Accept/decline:** Insert/update `opt_ins` for the chosen `match_id`.
- **Chat:** List `conversations` where user is participant; for each, list `messages`; send new messages (insert into `messages`).
- **Vercel:** Use env vars `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` pointing at this project; optional server-side use with service role for admin or matching jobs.

---

## Edge functions (match opt-in flow)

The meetwithmoai backend exposes Edge Functions the Fika app uses for per-intro opt-in and pass. The app calls these via `supabase.functions.invoke()`.

| Function | Purpose | Request body | Response |
|----------|---------|--------------|----------|
| **opt-in-to-match** | User opts in to an intro. Writes to `opt_ins`; if the other user already opted in, creates a `conversations` row and returns its id. | `{ match_id: string }` | `{ conversation_id?: string }` when mutual; otherwise `{}`. |
| **pass-on-match** | User passes on an intro. Writes to `opt_ins` with `decision: 'no'`. | `{ match_id: string }` | `{}` or `{ ok: true }`. |

If your backend uses different function names, set them in `lib/edge-functions.ts`.

---

This schema already supports “in-person one-on-one connection and conversation between two people based on their similarities and differences” via `match_candidates.reasons`, intake embeddings, and match → opt-in → conversation flow.
