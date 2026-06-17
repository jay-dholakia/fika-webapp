-- pg_cron: send weekly opt-in SMS every Monday at 2pm UTC (6am PT / 9am ET).
-- Admin must create weekly_fika_events row before this fires.

select cron.schedule(
  'sms-weekly-opt-in',
  '0 14 * * 1',
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
