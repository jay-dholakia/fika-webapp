# Weekly Fika — relative cadence (reimplementation plan)

## Goal

Stop assuming a **fixed weekday** (e.g. “Tuesdays at 6pm” or “Sunday blast / Monday close / Tuesday intro”). Treat **`fika_starts_at`** (plus `iana_tz`, venue, radius) as the **source of truth** and drive SMS + admin milestones from **offsets measured backward from that instant**.

Example (configurable per market, overridable per session):

| Milestone | Offset from `fika_starts_at` | Purpose |
|-----------|------------------------------|---------|
| Invite / opt-in ask | −48h | Ask users to opt in for *this* session |
| Opt-in **closes** | −24h | Lock pool for matcher |
| **Match / intro** SMS (approved matches) | −6h | Name + plan + 👍/SKIP |
| **Fika** | 0 | In-person meetup |

Offsets should be defined in **policy** (defaults on `markets`, optional overrides on `fika_socials`), not hard-coded in UI copy.

---

## Current state (this repo)

| Area | Status |
|------|--------|
| `fika_socials`, `fika_social_opt_ins`, matcher, admin UI | Shipped |
| Milestones | Admin sets `opt_in_closes_at` manually on publish; `opt_in_invite_sent_at` is an idempotent invite marker; automation sends on relative cadence |
| Matcher | Maps `fika_starts_at` → **Mon–Sun 30m slot id** (`availabilitySlotIdFromUtcInTimezone` in `lib/availability-slots.ts`) for `match_candidates.default_slot_id` — **interim** until timestamp-first Phase 4 |
| Webhook | No dedicated `fika_socials` SMS routing yet; no opt-in writes to `fika_social_opt_ins` from SMS |

---

## Phase 1 — Schema & policy

1. **Cadence policy** (pick one representation):
   - **A.** Store explicit timestamptz columns on `fika_socials`: `opt_in_opens_at`, `opt_in_closes_at` (already exists), `intro_sms_not_before_at` / `intro_sms_due_at`, etc., computed on publish/update.
   - **B.** Store integer offsets (days or hours) + `fika_starts_at`, compute at runtime (less query-friendly for cron).

   Recommendation: **A** for cron and debugging; defaults from market JSON or columns `weekly_opt_in_blast_days_before` (numeric).

2. Rename complete: `opt_in_invite_sent_at` is the invite idempotency marker (formerly `sunday_blast_sent_at`).

3. **Constraints:** `opt_in_opens_at < opt_in_closes_at < fika_starts_at`; reject publish if total lead time is too short for policy (v1: ≥48h).

---

## Phase 2 — Publish pipeline

On **`publish`** (and when `fika_starts_at` or TZ changes while draft):

1. Load market defaults + session overrides.
2. Compute milestone instants in **`iana_tz`** (document whether v1 uses **UTC−day subtraction** from `lib/weekly-fika-cadence.ts` or full IANA calendar math; upgrade to `Temporal` / `date-fns-tz` if needed).
3. Write computed columns; transition `status` → `open_opt_in` when blast is ready to fire (or split “scheduled” vs “open” if product wants).

---

## Phase 3 — Automation (pick scheduler)

- **Option A:** Vercel cron routes (hourly) that select sessions where `now()` ∈ window and idempotency via `*_sent_at` columns.
- **Option B:** Supabase `pg_cron` + thin Edge or HTTP to existing Next secured routes (reuse `CRON_SECRET` pattern).
- **Option C:** Queue (Inngest, etc.) if volume grows.

Jobs:

1. **Opt-in blast** — users in geo; sets blast sent timestamp; SMS copy uses **real local date/time** of Fika.
2. **Close opt-in** — auto `close_opt_in` when `opt_in_closes_at` passes (or keep manual + auto).
3. **Intro send** — only `match_candidates.admin_approval_status = 'approved'` and `fika_social_intro_sms_sent_at` null; call narrow `sms-match-delivery` with `match_ids`.

---

## Phase 4 — Matcher & scheduling (decouple Wed–Sat grid)

1. **Remove hard requirement** that `fika_starts_at` maps to a 9am–6:30pm-local 30m slot (`FIKA_SLOT_INVALID`).
2. **Preferred:** store **wall time** in `match_candidates` via `fika_starts_at` join on session (or denormalize `scheduled_starts_at` on row); keep `confirmed_slot_id` only for ad hoc slot-grid flows, or use a single synthetic sentinel for “weekly_timestamp” if UI still expects a slot string.
3. Update **day-of / 3h reminders** to key off **timestamp**, not slot id, for weekly rows (`sms-three-hour-reminder` shared helpers).

---

## Phase 5 — `sendblue-webhook`

1. Routing order: **`match_id`** lane → **weekly session** payload (session id or week marker in SMS deep link) → global concierge.
2. **YES** (when wired) → insert `fika_social_opt_ins` (respect unique `(user_id, week_anchor_monday)`).
3. **SKIP** vs **PASS** per product spec; no withdraw path for weekly lane.

---

## Phase 6 — Admin UI

- Replace day-of-week copy with **computed preview**: “Blast due {date}, closes {date}, intro {date}, Fika {date}” from cadence helper.
- Show policy source: “Using market defaults” vs “Session override.”

---

## Testing checklist

- Publish across **DST boundary** in `America/Los_Angeles`.
- Fika **48h** out → expect clamp or validation error.
- Matcher with **Monday evening** Fika after slot decoupling.
- Webhook double-tap idempotency on opt-in insert.

---

## References

- `lib/weekly-fika-cadence.ts` — v1 offset math (UTC day subtraction); extend for strict local-calendar days later.
- `lib/fika-social-matcher.ts`, `lib/availability-slots.ts` (`availabilitySlotIdFromUtcInTimezone`) — interim slot coupling until Phase 4.
