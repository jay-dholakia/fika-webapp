-- Cron for expiration flows. Schedule overridden by 20260330120000 to:
--   Monday 20:00 UTC (~ Monday 12:30pm PT): opt-in window closed (after Monday 12pm PT deadline)
--   Wednesday 04:00 UTC (~ Tuesday 9pm PT): match/intro expiration
-- Uses Edge Functions sms-opt-in-expiration and sms-match-expiration.

-- Tuesday 07:00 UTC (~ Monday 11pm PT): opt-in window closed (legacy; see 20260330120000)
select cron.schedule(
  'sms-opt-in-expiration',
  '0 7 * * 2',
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

-- Wednesday 07:00 UTC (~ Tuesday 11pm PT): match/intro expiration
select cron.schedule(
  'sms-match-expiration',
  '0 7 * * 3',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/sms-match-expiration',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'publishable_key')
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);

