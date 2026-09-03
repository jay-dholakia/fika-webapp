-- Reddit Growth Agent crons.
-- Uses vault service_role_key (JWT) for Authorization — not publishable_key.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- ── Part A: weekly subreddit discovery (Monday 7am PT = 14:00 UTC) ───────────────────────────
do $$ begin
  perform cron.unschedule('reddit-discover-subreddits');
exception when others then
  null;
end $$;

select cron.schedule(
  'reddit-discover-subreddits',
  '0 14 * * 1',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/reddit-discover-subreddits',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);

-- ── Part B: 3×/day thread scan (7am, 1pm, 7pm PT = 14:00, 20:00, 02:00 UTC) ─────────────────
do $$ begin
  perform cron.unschedule('reddit-scan-threads');
exception when others then
  null;
end $$;

select cron.schedule(
  'reddit-scan-threads',
  '0 14,20,2 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/reddit-scan-threads',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);
