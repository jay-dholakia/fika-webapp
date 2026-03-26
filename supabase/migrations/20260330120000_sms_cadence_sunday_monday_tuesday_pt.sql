-- Align SMS cadence crons with new plan (all times Pacific):
--   Sunday 12pm PT = weekly opt-in
--   Sunday 7pm PT   = follow-up
--   Monday 12pm PT  = opt-in/availability deadline + opt-in expiration run; 12:30pm PT = replenish-matches
--   Tuesday 9am PT  = match delivery
--   Tuesday 9pm PT  = intro accept deadline (code); Wednesday 4am UTC = match expiration

-- 1) Sunday 19:00 UTC = Sunday 12pm PT — weekly opt-in
select cron.unschedule(jobid) from cron.job where jobname = 'sms-weekly-opt-in';
select cron.schedule(
  'sms-weekly-opt-in',
  '0 19 * * 0',
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

-- 2) Monday 02:00 UTC = Sunday 7pm PT — follow-up
select cron.unschedule(jobid) from cron.job where jobname = 'sms-follow-up';
select cron.schedule(
  'sms-follow-up',
  '0 2 * * 1',
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

-- 3) Monday 19:00 UTC = Monday 12pm PT — opt-in expiration (at deadline)
select cron.unschedule(jobid) from cron.job where jobname = 'sms-opt-in-expiration';
select cron.schedule(
  'sms-opt-in-expiration',
  '0 19 * * 1',
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

-- 4) Tuesday 16:00 UTC = Tuesday 9am PT — match delivery
select cron.unschedule(jobid) from cron.job where jobname = 'sms-match-delivery';
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

-- 5) Wednesday 04:00 UTC = Tuesday 9pm PT — match/intro expiration (after accept/pass deadline)
select cron.unschedule(jobid) from cron.job where jobname = 'sms-match-expiration';
select cron.schedule(
  'sms-match-expiration',
  '0 4 * * 3',
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
