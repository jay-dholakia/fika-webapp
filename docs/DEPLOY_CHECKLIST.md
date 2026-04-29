# Release checklist (Fika Social + app)

## Important: where cron runs

**Fika Social automation runs on Supabase**, not Vercel:

- **pg_cron** job name `fika-socials-sweep` posts every **10 minutes** (`*/10 * * * *`) to  
  `{project_url}/functions/v1/fika-socials-sweep` with  
  `Authorization: Bearer {vault service_role_key}` (see migration `20260430253500_fix_fika_socials_sweep_edge_cron_auth.sql`).
- **Vault secrets** must exist: `project_url`, `service_role_key` (names expected by that migration).

The Next route `GET /api/cron/fika-socials` duplicates sweep logic for optional manual/testing use with `CRON_SECRET`; **production cadence for socials is the Edge Function + pg_cron**.

**Vercel crons** (`vercel.json`): only `day-of-reminder` at 9am UTC daily — not the Fika Social sweep.

---

## After merging code that touches…

### Database (DDL)

1. `supabase db push` (or link CI) so migrations apply on **meetwithmoai** / prod project.

### Edge Function `fika-socials-sweep`

Deploy whenever `supabase/functions/fika-socials-sweep/` changes (invite blast, matcher, intro send, **6h post-event SMS teardown**):

```bash
npx supabase functions deploy fika-socials-sweep --project-ref hgllvhohhyamsbljekrd
```

### Next.js app (admin UI, sendblue-webhook, cron route parity)

Deploy via **Vercel** (Git integration or CLI):

```bash
npx vercel deploy --prod   # requires vercel login or VERCEL_TOKEN
```

Ensure env vars match prod (e.g. `SUPABASE_SERVICE_ROLE_KEY`, Sendblue, webhooks).

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
