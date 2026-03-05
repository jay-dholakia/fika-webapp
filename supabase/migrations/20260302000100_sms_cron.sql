-- SMS agent: schedule Edge Functions via pg_cron + pg_net.
-- Prerequisites: Enable pg_cron and pg_net in Dashboard (Database → Extensions).
-- Create vault secrets (Dashboard → Database → Vault) before running:
--   vault.create_secret('https://YOUR_PROJECT_REF.supabase.co', 'project_url');
--   vault.create_secret('YOUR_ANON_KEY', 'publishable_key');

-- Enable extensions (no-op if already enabled)
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- Weekly opt-in: Monday 02:00 UTC (Sunday 6pm Pacific)
select cron.schedule(
  'sms-weekly-opt-in',
  '0 2 * * 1',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/sms-weekly-opt-in',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'publishable_key')
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);

-- Follow-up: Monday 12:00 UTC (no reply to weekly opt-in)
select cron.schedule(
  'sms-follow-up',
  '0 12 * * 1',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/sms-follow-up',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'publishable_key')
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);

-- Match delivery: Tuesday 16:00 UTC (after replenish-matches)
select cron.schedule(
  'sms-match-delivery',
  '0 16 * * 2',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/sms-match-delivery',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'publishable_key')
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);

-- Day-of reminder: daily at 16:00 UTC (9am Pacific)
select cron.schedule(
  'sms-day-reminder',
  '0 16 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/sms-day-reminder',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'publishable_key')
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);
