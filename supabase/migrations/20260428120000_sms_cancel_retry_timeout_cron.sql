-- Cancel/retry nudge + deadline: hourly via pg_cron → Edge Function sms-cancel-retry-timeout.
-- Requires: pg_cron, pg_net, vault secrets project_url + publishable_key (same as other SMS crons).
-- Edge secrets: SENDBLUE_API_KEY_ID, SENDBLUE_API_SECRET_KEY (Dashboard → Edge Functions).

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

do $$ begin perform cron.unschedule('sms-cancel-retry-timeout'); exception when others then null; end $$;

select cron.schedule(
  'sms-cancel-retry-timeout',
  '0 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/sms-cancel-retry-timeout',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'publishable_key')
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);
