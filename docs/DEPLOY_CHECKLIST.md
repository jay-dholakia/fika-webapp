# Release checklist (Fika Social + app)

## Important: where cron runs

**Production schedules run on Supabase** (`pg_cron` in the project database), **not** Vercel Cron. Vercel’s `vercel.json` `crons` feature only fires if the app is deployed on Vercel; it is not the source of truth for this stack.

- **pg_cron** (Supabase **Database → Cron** / `cron.job`) invokes Edge Functions via `net.http_post` — e.g. job `fika-socials-sweep` every **10 minutes** (`*/10 * * * *`) to  
  `{project_url}/functions/v1/fika-socials-sweep` with  
  `Authorization: Bearer {vault service_role_key}` (see migration `20260430253500_fix_fika_socials_sweep_edge_cron_auth.sql`). Other reminder/maintenance work uses the same pattern: **Supabase schedule → Edge Function** (see function comments under `supabase/functions/*` and related migrations).
- **Vault secrets** must exist: `project_url`, `service_role_key` (names expected by that migration) when the cron POST uses them.

The Next routes under `app/api/cron/*` mirror logic for **manual calls, curl, or local testing** (often with `CRON_SECRET`); **production cadence is pg_cron → Supabase Edge**, not a host-level cron.

The repo may still list **`vercel.json` crons** (e.g. `day-of-reminder`) for deployments that use Vercel; that is **optional and duplicate** to Edge + `pg_cron` if you have already moved the job. Prefer **one** scheduler in prod — here, **Supabase**.

---

## What runs where

| Code | Where it runs | How you ship it |
|------|----------------|-----------------|
| `supabase/functions/*` | **Supabase Edge Functions** | `supabase functions deploy <name> --project-ref <ref>` |
| Scheduled jobs (**production**) | **Supabase `pg_cron`** → calls Edge (or HTTP) | Migrations + **Supabase Dashboard → Database → Cron**; not Vercel Cron |
| `app/api/*` (e.g. **Sendblue webhook**, global-ready AI, admin API routes) | Your **Next.js** host (not Edge) | Whatever you use for the web app (Git push to host, Docker, etc.) — **not** `supabase functions deploy` |
| `app/api/cron/*` | **On-demand** when something HTTP-calls the route; optional `vercel.json` only if you use Vercel | Not the primary production scheduler — use **`pg_cron` on Supabase** for recurring work |

**Edge Functions and production crons are configured on Supabase**, not Vercel. Changes to `lib/sms-concierge-ai.ts` or `sendblue-webhook` only need a **Next app** deploy, not an Edge redeploy.

---

## After merging code that touches…

### Database (DDL)

1. `supabase db push` (or link CI) so migrations apply on **meetwithmoai** / prod project.

### Edge Functions (Supabase CLI)

Deploy any function under `supabase/functions/` that changed, e.g. **`fika-socials-sweep`** (invite blast, matcher, intro send, **6h post-event SMS teardown**):

```bash
npx supabase functions deploy fika-socials-sweep --project-ref hgllvhohhyamsbljekrd
```

Repeat for other functions you changed (`sms-match-delivery`, etc.).

### Next.js app (webhook, admin UI, optional `/api/cron/fika-socials` parity)

Deploy using **your app’s normal pipeline** (not Supabase Edge). Ensure prod env has `SUPABASE_SERVICE_ROLE_KEY`, Sendblue keys, webhook URL, optional `OPENAI_API_KEY` (global-ready + confirmed-upcoming SMS AI), `SENDBLUE_CHAT_PRESENCE_ENABLED`, `SENDBLUE_API_HOST` (see `.env.example`).

---

## Verify in Supabase Dashboard

1. **Database → Cron**: job `fika-socials-sweep` active, schedule `*/10 * * * *`.
2. **Edge Functions**: `fika-socials-sweep` latest version deployed after changes.
3. **Vault / Secrets**: `project_url`, `service_role_key` present if cron POSTs fail.

Optional SQL (same project):

```sql
select jobid, jobname, schedule, active from cron.job where jobname = 'fika-socials-sweep';
```

---

## MCP verification (meetwithmoai)

Use Supabase MCP against project ref **hgllvhohhyamsbljekrd**:

- `list_migrations` — includes `20260528120000`, `20260528120100`.
- `execute_sql` — `match_candidates` has `fika_social_user_a_confirmed_at`, `fika_social_user_b_confirmed_at`.
- Cron query above — `active = true`.
