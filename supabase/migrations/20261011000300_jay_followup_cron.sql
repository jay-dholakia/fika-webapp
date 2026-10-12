-- Sends Jay's personal follow-up SMS ~1 hour after a user completes signup.
-- Runs every 10 minutes; the edge function uses a 55–75 minute window to avoid double-sends.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

do $$ begin
  perform cron.unschedule('sms-jay-followup');
exception when others then
  null;
end $$;

select cron.schedule(
  'sms-jay-followup',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/sms-jay-followup',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);
