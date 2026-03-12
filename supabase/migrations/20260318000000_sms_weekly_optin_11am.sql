-- Send weekly opt-in at Monday 11am PT instead of 9am PT (may improve opt-in rate).
-- Deadline and rest of logic unchanged (Monday 11:59pm lock, Tuesday morning intros).

select cron.unschedule('sms-weekly-opt-in');

select cron.schedule(
  'sms-weekly-opt-in',
  '0 19 * * 1',
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
