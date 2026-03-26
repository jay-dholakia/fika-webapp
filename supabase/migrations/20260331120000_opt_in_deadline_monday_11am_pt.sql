-- Opt-in window ends Monday 11am PT (was 12pm PT). Reschedule sms-opt-in-expiration to 18:00 UTC (11am PDT).
select cron.unschedule(jobid) from cron.job where jobname = 'sms-opt-in-expiration';
select cron.schedule(
  'sms-opt-in-expiration',
  '0 18 * * 1',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/sms-opt-in-expiration',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'publishable_key')
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);
