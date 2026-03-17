# Fika Weekly Flow — Implementation Summary

What needs to change to go from the **current** flow to the **new** flow in [FIKA_WEEKLY_FLOW.md](./FIKA_WEEKLY_FLOW.md). No code here — checklist and scope only.

---

## Current vs New (high level)

| Aspect | Current | New |
|--------|---------|-----|
| **How users enter the week** | We **push** Sunday 12pm PT: "Want a Fika? Reply Yes or Skip" (capped 200/day). | User **pulls**: they text **FIKA**. We reply with commitment line + availability link. No push. |
| **After they “opt in”** | Reply YES/IN → we send availability link, state OPTED_IN. They set availability by Monday 12pm PT. | They already got the link when they texted FIKA. They set availability by **Monday 11am PT**. No separate “Yes or Skip” step. |
| **Sunday evening** | Sunday 7pm PT: follow-up to everyone still in AWAITING_OPT_IN (reminder to reply Yes or Skip). | Sunday **8pm PT**: reminder only to people who **texted FIKA** but **haven’t submitted availability** yet. |
| **Monday** | Monday **12pm PT**: opt-in expiration (message “window closed” to non-responders). 12:30pm PT: replenish-matches. | Monday **11am PT**: **availability lock**. Message “all set” to those who submitted, “not in time” to those who didn’t. Then replenish runs (after 11am). |
| **Tuesday intro** | “I found someone… Reply YES or PASS.” No venue/time. When both YES we propose venue+time (multi-step). | Intro includes **full plan**: “You’ve been matched with [Name]… Fika plan: [Day] [Time] [Venue]. Reply YES to confirm by 9 PM tonight.” Single confirmation. |
| **After YES** | YES → propose time/venue → AWAITING_SECOND_CONFIRM / AWAITING_FIRST_CONFIRM → they confirm → CONFIRMED. Reschedule/decline flows. | Both reply YES → CONFIRMED. No multi-step proposal, no reschedule/decline before Fika day (later phase). |
| **No match** | (Not clearly messaged.) | Explicit: “No match this week — text FIKA next Sunday to try again.” |
| **Deadline** | Tuesday 9pm PT: match expiration (unconfirmed intros expire). | Same: Tuesday 9pm PT confirm or expire. |

---

## 1. Webhook + “first contact” (reply-only entry)

**Where:** `app/api/sendblue-webhook/route.ts`, `lib/sms-agent.ts` (and any shared message helpers).

**Current:**  
If user has no global state for this `batch_week`, we send the **entry prompt** (“Want in this week? Reply Yes or Skip…”) and create state `AWAITING_OPT_IN`. So either they were already pushed by cron, or they texted first and get that prompt.

**New:**  
- **Remove** any logic that sends “Want in this week? Reply Yes or Skip” (or similar) when there’s no state.
- When user texts **FIKA** (and has completed onboarding, active market, etc.):
  - Send **commitment line**: “You’re in for this week’s Fika.”
  - Send **second message** (copy from spec): “Great — let’s set up your Fika for this week. Please share when you’re free between Wednesday and Saturday:” then **availability link as standalone message** (existing URL rule). Include: “You can update your availability until Monday at 11 AM PT.”
  - Create/update **global state** for this `batch_week` to mean “user texted FIKA this week; we sent the link” (e.g. keep `AWAITING_OPT_IN` with new semantics, or introduce something like `AWAITING_AVAILABILITY`).
- **Do not** create state or send the old entry prompt for other keywords (e.g. HI) for this batch_week; only FIKA triggers the link. Optionally: for other keywords when they have no state, send a short “Text FIKA to get your link for this week” (product decision).

**Copy:**  
Add/use messages from [FIKA_WEEKLY_FLOW.md](./FIKA_WEEKLY_FLOW.md) (Sunday — User opt-in). Keep URL as standalone second message.

---

## 2. Remove “Reply Yes or Skip” / OPTED_IN from webhook

**Where:** `app/api/sendblue-webhook/route.ts`, `lib/sms-agent.ts`.

**Current:**  
In state `AWAITING_OPT_IN` we handle:
- YES/IN → write `weekly_match_opt_ins`, set state `OPTED_IN`, send availability link.
- SKIP → stay `AWAITING_OPT_IN`, send “skipped.”
- FIKA/HI → send “reminder” (reply Yes or Skip).

**New:**  
- **Remove** the flow that treats “Reply Yes or Skip” as the way to get the availability link. In the new flow, the link is sent only when they text FIKA (above).
- **Repurpose or remove** `OPTED_IN`:
  - Option A: Drop `OPTED_IN`. “In for the week” = they texted FIKA and we have state. “Eligible for matching” = they have `weekly_availability` for this `batch_week` (see below).
  - Option B: Set `OPTED_IN` when they text FIKA (so “opted in” = “asked for the week”), and use `weekly_availability` for “submitted availability.” Then replenish uses “has availability” not “has opted_in_at.”
- **Remove** sending the availability link from this block (no “Reply IN to get link”).
- **Remove** or simplify SKIP and FIKA/HI reminder that says “Reply Yes or Skip.” If you keep a reminder for “texted FIKA but no state yet,” it should only say “Text FIKA to get your link” (or nothing).

**Data:**  
Decide how replenish and Monday 11am job determine “submitted availability”: use `weekly_availability` for this `batch_week` (and optionally a “submitted by Monday 11am” rule, e.g. by `updated_at` or a lock time). No need to rely on `weekly_match_opt_ins.opted_in_at` for matching pool if you use `weekly_availability` as source of truth.

---

## 3. Weekly opt-in cron (Sunday push) — remove or repurpose

**Where:** `lib/sms-cron.ts` (`runWeeklyOptIn`), `app/api/cron/weekly-opt-in/route.ts`, Supabase Edge Function `sms-weekly-opt-in`.

**Current:**  
Sunday 12pm PT: send “Would you like a Fika introduction this week? Reply Yes or Skip.” to everyone with phone in active market who hasn’t opted in yet (and no state yet), capped 200/day. Creates state `AWAITING_OPT_IN`.

**New:**  
- **Do not** send that push. The new flow is reply-only: users text FIKA to get the link.
- **Options:**
  - **A:** Disable/delete the Sunday “weekly opt-in” cron (and the Edge function equivalent). No Sunday push.
  - **B:** Repurpose to a single nudge: “Fika week — text FIKA to set your availability by Monday 11am PT.” (Still a push; product call.)
- **Vercel:** If you keep a cron route, it should either do nothing or run the repurposed nudge; update `runWeeklyOptIn` accordingly.
- **Supabase:** Unschedule or change `sms-weekly-opt-in` to match (e.g. 8pm PT is only the reminder below).

---

## 4. Sunday 8pm PT — availability reminder (new)

**Where:** New cron + new (or repurposed) Edge Function or Vercel cron.

**Current:**  
Sunday 7pm PT: `sms-follow-up` sends a reminder to everyone in `AWAITING_OPT_IN` who hasn’t opted in (reply Yes or Skip).

**New:**  
- **When:** Sunday **8pm PT** (cron: e.g. Monday 03:00 UTC or 04:00 UTC depending on DST).
- **Who:** Users who **texted FIKA** this week (have global state for this `batch_week`) but have **not** submitted availability. “Submitted” = have a `weekly_availability` row for this `batch_week` with non-empty `availability_slots` (or whatever you use).
- **Message:** From spec: “Quick reminder to set your availability for this week’s Fika. Please submit it by 11 AM PT tomorrow.” Then **availability link as standalone message**.
- **Implementation:** New Edge Function (e.g. `sms-availability-reminder`) or repurpose `sms-follow-up`: change query to “state for batch_week exists (they texted FIKA) AND no weekly_availability (or empty) for batch_week.” Send only to those. Update pg_cron to 8pm PT Sunday.

---

## 5. Monday 11am PT — availability lock (new) + cron changes

**Where:** New cron + new Edge Function (or repurpose `sms-opt-in-expiration`).

**Current:**  
Monday **12pm** PT: `sms-opt-in-expiration` sends “This week’s opt-in window has closed…” to everyone still in `awaiting_opt_in`.

**New:**  
- **When:** Monday **11am PT** (e.g. 18:00 UTC or 19:00 UTC depending on DST).
- **Logic:**
  - For every user who has **global state** for this `batch_week` (they texted FIKA):
    - If they have **submitted availability** for this `batch_week` (e.g. `weekly_availability` with slots):  
      Send: “You’re all set for this week’s Fika. We’ll send your introduction tomorrow morning.”
    - Else:  
      Send: “Looks like availability wasn’t submitted in time for this week. You can opt in again next Sunday.”
  - Optionally mark them so you don’t send again (e.g. payload or separate table); next week they can text FIKA again.
- **Replenish:** Run **after** this lock (e.g. Monday 11:30am or 12pm PT). Pool for matching = users who have `weekly_availability` for this `batch_week` with non-empty slots (and any other filters). So replenish-matches should use **weekly_availability** as the source of “in the run,” not (or not only) `weekly_match_opt_ins.opted_in_at`. Adjust replenish and any expiration logic that assumes “opted_in_at.”
- **Cron:** New function (e.g. `sms-availability-lock`) or repurpose `sms-opt-in-expiration`: change schedule to Monday 11am PT and implement the two messages above. Update replenish cron to run after 11am PT if it’s currently 12:30pm PT (or keep 12:30pm and ensure lock runs at 11am).

---

## 6. Tuesday — match delivery: full plan in one message

**Where:** `supabase/functions/sms-match-delivery/index.ts`, `lib/sms-cron.ts` (`runMatchDelivery` if used), and any shared message builder.

**Current:**  
Intro is “I found someone you might enjoy meeting. [Name], [age]. Shared interests: … Would you like the introduction? Reply YES or PASS.” No venue or time. When both reply YES, **then** we pick venue + slot and send a separate proposal (AWAITING_SECOND_CONFIRM, etc.).

**New:**  
- **Before sending the intro:** For each match, **pick one slot and one venue** (using existing `pickVenueForMatch` and overlapping slots from `match_candidates`). Set `suggested_venue_id` and `default_slot_id` on the match (or ensure replenish does this) so the intro can include the full plan.
- **Intro message:** Use spec: “You’ve been matched with [Name]. You both live near [area] and are free [day] [time]. Fika plan: [Day] — [Time], [Venue]. Reply YES to confirm by 9 PM tonight.”
- **State:** After sending, set state to `MATCH_OFFERED` (or equivalent). **No** YES_WAITING, AWAITING_SECOND_CONFIRM, AWAITING_FIRST_CONFIRM for the new flow: only “Reply YES to confirm by 9 PM.”
- **Implementation:** Change the Edge Function (and Vercel `runMatchDelivery` if used) to:
  - Load match + overlapping slots + profiles/intake for venue selection.
  - Pick one slot and one venue per match.
  - Update `match_candidates` with `suggested_venue_id` and `default_slot_id`.
  - Build and send the single intro message with plan.
  - Set state to match_offered (no multi-step proposal).

---

## 7. Tuesday — no-match message (new)

**Where:** New Edge Function or extend match-delivery / a post-replenish job.

**Current:**  
No explicit “no match” SMS.

**New:**  
- **Who:** Users who have **submitted availability** for this `batch_week` (e.g. `weekly_availability` with slots) but do **not** have any `match_candidates` row for this `batch_week` (or no active match).
- **When:** Tuesday, after match delivery (or in the same run: after sending intros, find “has availability, no match” and send).
- **Message:** “No match this week — text FIKA next Sunday to try again.”

---

## 8. Webhook: MATCH_OFFERED → single YES → CONFIRMED

**Where:** `app/api/sendblue-webhook/route.ts`, `lib/sms-agent.ts`.

**Current:**  
- MATCH_OFFERED: they reply YES or PASS. If YES, we check other; if both YES we pick venue+slot and send proposal, move to AWAITING_SECOND_CONFIRM / AWAITING_FIRST_CONFIRM. They can decline proposal and get one re-proposal.
- Multiple states: YES_WAITING, AWAITING_SECOND_CONFIRM, AWAITING_FIRST_CONFIRM, then CONFIRMED.

**New:**  
- **MATCH_OFFERED:** Intro already had the plan. Reply **YES** → record in `opt_ins`. If **both** YES → confirm immediately: update `match_candidates` (confirmed_venue_id, confirmed_slot_id, scheduling_status = confirmed), send “Your Fika is confirmed. [Day] — [Time], [Venue]. Enjoy the conversation.” to both. Set state **CONFIRMED**.
- **PASS** → same as now (opt_ins no, match_exclusions, notify other if they had said yes, delete match state).
- **Remove** (for this flow): YES_WAITING, AWAITING_SECOND_CONFIRM, AWAITING_FIRST_CONFIRM, and all proposal/decline/re-proposal logic. No “we’ll propose a time” after YES — the proposal was in the intro. Reschedule/cancel before Fika day = later phase; day-of only for now.

---

## 9. Tuesday 9pm PT — expiration (unchanged concept, maybe rename)

**Where:** `supabase/functions/sms-match-expiration/index.ts`.

**Current:**  
Wednesday 4am UTC (Tuesday 9pm PT): expire matches where both haven’t confirmed (e.g. set scheduling_status to expired, clean up state). Same idea in new flow.

**New:**  
Keep the same deadline and behavior. Ensure expiration only considers matches that are still in “match_offered” (or not yet CONFIRMED). No change if it already does that.

---

## 10. Day-of reminder (unchanged)

**Where:** `sms-day-reminder`, `lib/sms-cron.ts` (`runDayOfReminder`).

**Current:**  
Day-of Fika: send reminder with venue/time. HERE / RUNNING LATE / CAN’T MAKE IT relay.

**New:**  
Keep. Optionally align copy with spec: “Reminder: Your Fika with [Name] is today. [Day] — [Time], [Venue].” Reschedule/cancel on day-of = later phase.

---

## 11. State machine and data semantics

**Where:** `lib/sms-agent.ts` (SMS_STATES), webhook, crons.

**Current states (global):** AWAITING_OPT_IN, OPTED_IN.  
**Current states (per-match):** MATCH_OFFERED, YES_WAITING, AWAITING_SECOND_CONFIRM, AWAITING_FIRST_CONFIRM, CONFIRMED (and scheduling-day/window/venue states).

**New:**  
- **Global:** One state for “texted FIKA this week; we sent the link” (e.g. keep `AWAITING_OPT_IN` or rename to `AWAITING_AVAILABILITY`). Remove or repurpose `OPTED_IN` (no “Reply Yes to get link”).
- **Per-match:** Keep `MATCH_OFFERED` and `CONFIRMED`. Remove or bypass `YES_WAITING`, `AWAITING_SECOND_CONFIRM`, `AWAITING_FIRST_CONFIRM` (and any scheduling-day/window/venue states) for the new single-step confirm flow. Fallbacks and HELP can be updated to the smaller state set.
- **Eligibility for matching:** Define as “has `weekly_availability` for this batch_week” (and any market/onboarding checks). Replenish and “no match” job use this.

---

## 12. Replenish-matches

**Where:** `supabase/functions/replenish-matches/index.ts`.

**Current:**  
Uses `weekly_match_opt_ins` (opted in) and `weekly_availability` for overlap.

**New:**  
- Pool of users to match = those with **weekly_availability** for this `batch_week` (non-empty slots), not (or not only) `weekly_match_opt_ins.opted_in_at`.
- Run **after** Monday 11am PT availability lock so “submitted by 11am” is well-defined (e.g. run at 11:30am or 12pm PT).
- Optionally: when creating matches, set `suggested_venue_id` and `default_slot_id` so match-delivery can send the full plan without a second pass (or match-delivery computes them before sending; either way, one slot + one venue per intro).

---

## 13. Copy and message helpers

**Where:** `lib/sms-agent.ts`, `lib/sms-signup.ts` (if any signup flow stays).

**New copy (from spec):**  
- Commitment: “You’re in for this week’s Fika.”  
- Link message: “Great — let’s set up your Fika for this week. Please share when you’re free between Wednesday and Saturday:” + “You can update your availability until Monday at 11 AM PT.”  
- Sunday 8pm reminder + link.  
- Monday 11am: “all set” and “not in time.”  
- Tuesday intro with full plan + “Reply YES to confirm by 9 PM tonight.”  
- Confirm: “Your Fika is confirmed. [Day] — [Time], [Venue]. Enjoy the conversation.”  
- No match: “No match this week — text FIKA next Sunday to try again.”  
- Day-of: “Reminder: Your Fika with [Name] is today. [Day] — [Time], [Venue].”

Add or replace message helpers and use them in webhook and Edge Functions. Keep URLs as standalone messages where applicable.

---

## 14. Cron schedule summary (target)

| When (PT)     | Job                     | Action |
|---------------|-------------------------|--------|
| Sunday        | (no push)               | Users text FIKA → webhook sends commitment + link. |
| Sunday 8pm    | Availability reminder   | New: only who texted FIKA and haven’t submitted. |
| Monday 11am   | Availability lock       | New: “all set” / “not in time” to everyone who texted FIKA. |
| Monday 11:30am or 12pm | Replenish-matches | After lock; pool = weekly_availability for batch_week. |
| Tuesday 9am   | Match delivery          | Intros with full plan; “Reply YES by 9 PM.” |
| Tuesday       | No-match                | New: “No match this week…” to users with availability but no match. |
| Tuesday 9pm   | Match expiration        | Unconfirmed intros expire (existing). |
| Day-of Fika   | Day-of reminder         | Existing. |

Remove or repurpose: Sunday 12pm “weekly opt-in” push, Sunday 7pm “follow-up” (replaced by 8pm availability reminder), Monday 12pm “opt-in expiration” (replaced by 11am availability lock).

---

## 15. Edge Functions and migrations

- **New:** `sms-availability-reminder` (Sunday 8pm PT), `sms-availability-lock` (Monday 11am PT), and/or repurpose `sms-follow-up` and `sms-opt-in-expiration`.
- **Change:** `sms-weekly-opt-in` → disable or repurpose; `sms-match-delivery` → full-plan intro, one-step confirm; add no-match send (new or inside existing).
- **Migrations:** Update pg_cron: unschedule/reschedule jobs per table above. No strict need for new tables if you use `weekly_availability` + existing state; optional “availability_locked_at” or similar if you want to record lock time.

---

## 16. Testing and rollout

- Test: user texts FIKA → gets commitment + link; sets availability; Monday 11am gets “all set” or “not in time”; Tuesday gets intro with plan or “no match”; YES by 9pm → confirmed; day-of reminder.
- Test: no availability by Monday 11am → “not in time”; no match Tuesday → “no match” message.
- Consider feature flag or env (e.g. `FIKA_WEEKLY_FLOW_V2=true`) to switch between old and new flow during rollout.

---

This summary is the single checklist for implementing the new Fika Weekly Flow from the current behavior.
