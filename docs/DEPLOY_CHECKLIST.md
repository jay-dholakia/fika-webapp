# Release checklist (Fika Social + app)

## Important: where cron runs

**Fika Social automation runs on Supabase**, not Vercel:

- **pg_cron** job name `fika-socials-sweep` posts every **10 minutes** (`*/10 * * * *`) to  
  `{project_url}/functions/v1/fika-socials-sweep` with  
  `Authorization: Bearer {vault service_role_key}` (see migration `20260430253500_fix_fika_socials_sweep_edge_cron_auth.sql`).
- **Vault secrets** must exist: `project_url`, `service_role_key` (names expected by that migration).

The Next route `GET /api/cron/fika-socials` duplicates sweep logic for optional manual/testing use with `CRON_SECRET`; **production cadence for socials is the Edge Function + pg_cron**.

If the repo has **`vercel.json` crons**, those run only on **Vercel** — e.g. `day-of-reminder` — not the Fika Social sweep.

---

## What runs where

| Code | Where it runs | How you ship it |
|------|----------------|-----------------|
| `supabase/functions/*` | **Supabase Edge Functions** | `supabase functions deploy <name> --project-ref <ref>` |
| `app/api/*` (e.g. **Sendblue webhook**, global-ready AI, admin API routes) | Your **Next.js** host (not Edge) | Whatever you use for the web app (Git push to host, Docker, etc.) — **not** `supabase functions deploy` |

**Edge Functions are deployed through Supabase**, not Vercel. Changes to `lib/sms-concierge-ai.ts` or `sendblue-webhook` only need a **Next app** deploy, not an Edge redeploy.

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
