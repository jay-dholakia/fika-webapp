-- Renews the Google Calendar push notification channel twice a week.
-- Google caps watch channels at 7 days; running Mon + Thu keeps it alive indefinitely.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

do $$ begin
  perform cron.unschedule('gcal-channel-renew');
exception when others then
  null;
end $$;

select cron.schedule(
  'gcal-channel-renew',
  '0 17 * * 1,4',  -- Monday and Thursday at 17:00 UTC (9am PT)
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/gcal-channel-renew',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);
