# Replacing scheduled crons with the new Fika protocol

> **Intent:** The **event-driven** flow in [`FIKA_MATCH_PROTOCOL.md`](./FIKA_MATCH_PROTOCOL.md) + [`FIKA_YOUR_FIKA_WEB_SMS_FLOW.md`](./FIKA_YOUR_FIKA_WEB_SMS_FLOW.md) should **replace the old weekly batch cadence** driven by `pg_cron`. This doc inventories current jobs and what replaces them **conceptually**. Implementation = new migration to `cron.unschedule` + webhook/queue work.

> **Current engineering plan:** **Admin-only** Phase 0/1 — **`match_candidates`** and intro SMS via **admin match simulation** + **Trigger SMS** (`sms-match-delivery` with `match_ids`). No automated **`T_nudge`** list, no **`replenish-matches`** cron. Optional **weekend scoring** in the table below is **out of scope** until automation ships; see [`FIKA_PRE_IMPLEMENTATION_REVIEW.md`](./FIKA_PRE_IMPLEMENTATION_REVIEW.md) §1.

---

## What “replace all crons” means in practice

- **Replace:** Time-based **bulk** steps that assumed **Sunday → Monday → Tuesday** weekly pool logic (opt-in blast, follow-up, expiration, scheduled replenish, scheduled intro delivery, scheduled match expiration).
- **Honest caveat:** Some behaviors are **inherently time-based** (e.g. “morning of Fika,” “~90 minutes before,” “post-Fika next day”). Those can become:
  - **Per-match scheduled jobs** (queue/worker), **or**
  - **A single thin sweep cron** (e.g. hourly) that only runs **new** protocol logic — not the old weekly pipeline.

So: **zero** `pg_cron` is possible only if you use **another scheduler** (Inngest, Supabase queued functions, etc.). **Zero weekly batch crons** is the realistic product goal.

---

## Weekly pool pipeline — `pg_cron` jobs to sunset

Defined in e.g. `supabase/migrations/20260425180000_reenable_weekly_pool_sms_crons.sql`:

| Job name | Edge Function | Role today | Replacement (new protocol) |
|----------|---------------|------------|----------------------------|
| `sms-weekly-opt-in` | `sms-weekly-opt-in` | Sun: blast “FIKA” nudge to weekly_pool | **Phase 0 + Phase 1:** Admin/simulation + **simultaneous** “strong intro” offer when ready — **not** a standing Sunday blast to a cohort. Optional **weekend scoring job** (not necessarily `pg_cron`) to know who clears **T_nudge**. |
| `sms-follow-up` | `sms-follow-up` | Mon: reminder for awaiting opt-in | **In-app + SMS** nudges driven by **state + SLA** (24h / 48h), not a fixed Monday cron. |
| `sms-opt-in-expiration` | `sms-opt-in-expiration` | Mon: window closed copy | **Event:** deadline passed → transition state (or thin sweep), not weekly fixed time only. |
| `replenish-matches` | `replenish-matches` | Mon: build `match_candidates` from weekly opt-ins | **Phase 0 internal lock** + scoring pass; **after** both YES and availability, **internal scheduling** — **not** one weekly batch on everyone who opted in the old way. |
| `sms-match-delivery` | `sms-match-delivery` | Tue: send intro SMS | **Phase 1** simultaneous offer (and later phases) — **triggered** when a match is **ready to offer**, not Tuesday batch. Manual/admin path can still call delivery with `match_ids`. |
| `sms-match-expiration` | `sms-match-expiration` | Wed: expire stuck intros | **Protocol:** kill on PASS, 24h/48h rules — **state-driven** + optional **sweep** for stuck rows. |

---

## Other `pg_cron` jobs (not weekly pool, but “scheduled”)

| Job / pattern | Edge Function | Role today | Replacement options |
|---------------|---------------|------------|---------------------|
| `sms-onboarding-reminder` | `sms-onboarding-reminder` | Every 30m: nudge incomplete onboarding | **Outside** core match protocol. Keep, replace with **event** (signup + idle), or **one** daily sweep. |
| `sms-three-hour-reminder` | `sms-three-hour-reminder` | Hourly: ~90m-before Fika | **Phase 6-ish** — can stay as **thin sweep** or **per-match** scheduled send. |
| `sms-day-reminder` | `sms-day-reminder` | Day-of | Same — **time-triggered**; protocol copy should match Phase 6. |
| `sms-post-fika` | `sms-post-fika` | Post-Fika loop | **Phase 7** — **after** Fika time + offset; event or sweep. |

These are **not** “weekly pool” crons but they **are** schedulers. If the goal is literally **no** `pg_cron` rows, you’ll need **another** mechanism for “send at 8am on Fika day” and “send ~90m before.”

---

## Summary table

| Category | Action |
|----------|--------|
| **Weekly batch SMS + replenish + Tue delivery + Wed expiration** | **Remove** from `pg_cron` when the new protocol ships; behavior **replaced** by admin Phase 0, scoring, webhook state machine, and **on-demand** delivery. |
| **Reminder / post-Fika / onboarding** | **Redesign** to match protocol phases; may still use **hourly or daily sweep** unless you introduce a job queue. |

---

## Implementation checklist (when you build)

- [ ] New migration: `cron.unschedule(...)` for each job you’re retiring (safe `do $$ … exception` pattern per existing migrations).
- [ ] Document **Vault** secrets still needed for any **remaining** Edge invocations.
- [ ] Align **message ledger** + **`match_candidates.created_at`** with Phase 1 send for sliding availability (see `FIKA_YOUR_FIKA_WEB_SMS_FLOW.md`).
- [ ] Decide **T_nudge** job schedule (weekend **batch** vs **continuous** recompute) — may still be **one** cron if you keep a single “score candidates” function; that’s **not** the old weekly *user* cadence.

---

## One sentence for stakeholders

**We’re moving from “the database wakes up six times a week and blasts SMS” to “we only message when a match clears internal gates and users move through YES → teaser → availability → plan,” with optional minimal sweeps for reminders and housekeeping.**
