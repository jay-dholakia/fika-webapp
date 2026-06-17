# Fika Webapp — Session Memory

Running log of architectural learnings, decisions, and gotchas discovered across sessions. Stable rules graduate to `CLAUDE.md`. Entries are dated.

---

## 2026-06-08

- **All crons belong on Supabase.** Confirmed via live pg_cron query — 7 active jobs all pointing to Edge Functions. Removed the last remaining Vercel cron (`day-of-reminder` at wrong time, 9 AM UTC = 2 AM PT). Supabase version runs correctly at 16:00 UTC = 9 AM PT.
- **`sms-match-delivery` is intentionally not on a cron.** It's admin/manually triggered. Do not schedule it.
- **RLS is disabled on `onboarding_sessions` and `sms_signup_states`.** Supabase flagged as critical — both tables exposed to anon key. Needs RLS policies before enabling. Not yet addressed.
- **Two-file context strategy adopted.** `CLAUDE.md` = stable orientation, `memory.md` (this file) = dynamic session learnings. Significant entries get promoted to `CLAUDE.md`.
