-- Match cycle cadence: Monday 9am PT opt-in → Tuesday 11:59pm PT deadline → Wednesday 8am PT intros → Wed–Sun meet.
-- Update cron to match (times in UTC: 9am PT ≈ 17:00, 2pm PT ≈ 22:00, 8am PT ≈ 16:00).

select cron.unschedule('sms-weekly-opt-in');
select cron.unschedule('sms-follow-up');
select cron.unschedule('sms-match-delivery');

-- Monday 9am PT (17:00 UTC) — send weekly opt-in
select cron.schedule(
  'sms-weekly-opt-in',
  '0 17 * * 1',
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

-- Tuesday 2pm PT (22:00 UTC) — follow-up for those who haven't replied (deadline Tuesday 11:59pm PT)
select cron.schedule(
  'sms-follow-up',
  '0 22 * * 2',
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

-- Wednesday 8am PT (16:00 UTC) — send intros (after Tuesday 11:59pm PT deadline)
select cron.schedule(
  'sms-match-delivery',
  '0 16 * * 3',
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

-- Day-of reminder unchanged: daily 16:00 UTC (9am PT)
