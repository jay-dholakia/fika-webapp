# Fika Webapp

## What this is

Fika is an SMS-first social meetup platform that matches people for in-person coffee meetings. The web app handles onboarding and admin tooling. Day-to-day user interaction happens via iMessage/SMS through SendBlue and an OpenAI-powered concierge.

## Tech stack

- **Next.js 14** (App Router, TypeScript) — hosted on Vercel
- **Supabase** — Postgres, Auth (PKCE), Storage (avatars), Edge Functions (Deno), pg_cron
- **SendBlue** — iMessage/SMS API; two numbers: Concierge (all user comms) and Match relay (user↔user during meeting window)
- **OpenAI** — SMS AI concierge
- **Google Maps/Places** — venue discovery and address autocomplete
- **Persona** — government ID verification
- **Notion** — blog backend (`/thoughts`)
- **MediaPipe Vision** — selfie face check on avatar upload

## Supabase project

- **Project:** `meetwithmoai` — ID `hgllvhohhyamsbljekrd`, us-west-1
- All scheduled jobs run on Supabase (pg_cron → Edge Functions). No Vercel crons.

## Dev commands

```bash
npm run dev       # local dev server
npm run build     # production build
npm run lint      # ESLint
```

## Key files

| Path | Purpose |
|---|---|
| `lib/sendblue.ts` | SendBlue API wrapper (send, typing indicator, read receipt, contact card) |
| `app/api/sendblue-webhook/route.ts` | Inbound SMS orchestrator (~3100 lines) — main state machine |
| `lib/sms-agent.ts` | SMS state machine + OpenAI integration |
| `lib/markets.ts` | Market definitions and timezone logic |
| `lib/db-types.ts` | Supabase row types |
| `supabase/functions/` | All Edge Functions (crons + event-driven triggers) |
| `supabase/migrations/` | 87+ Postgres migrations |
| `docs/` | Protocol and schema docs (see below) |

## Architecture rules

- **All crons belong on Supabase.** Never add entries to `vercel.json` crons. Use pg_cron → Edge Functions.
- **`sms-match-delivery` is admin/manually triggered** — not on a schedule. Don't add a cron for it.
- **Match lifecycle is a strict state machine** in `match_candidates`. State transitions happen inside the webhook handler or edge functions — don't update status columns directly without following the protocol in `docs/FIKA_MATCH_PROTOCOL.md`.
- **Admin approval gate** must fire before any intro SMS is sent to users. Never bypass it.
- **Don't alter the `embedding` column** in `intake_responses_v5` — it backs the similarity-based matching.

## Docs

- `docs/FIKA_MATCH_PROTOCOL.md` — full match lifecycle and state transitions
- `docs/FIKA_YOUR_FIKA_WEB_SMS_FLOW.md` — web + SMS flow end to end
- `docs/MEETWITHMOAI_SCHEMA.md` — database schema reference
- `docs/DEPLOY_CHECKLIST.md` — deploy steps
- `docs/FIKA_CRON_REPLACEMENT.md` — cron migration history (why crons moved to Supabase)
