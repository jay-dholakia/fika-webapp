-- pg_cron: fire sms-fika-start-questions every 15 min during the Wed 6pm window across US timezones.
-- ET/CT markets hit 6pm between 22:00–00:00 UTC; MT/PT markets between 00:00–02:15 UTC Thu.
-- The edge function checks Date.now() - meetingUtcMs in [0, 10 min] + pregame_sent_at IS NULL.

select cron.schedule(
  'sms-fika-start-questions',
  '0,15,30,45 22-23 * * 3',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/sms-fika-start-questions',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'publishable_key')
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);

select cron.schedule(
  'sms-fika-start-questions-late',
  '0,15,30,45 0-2 * * 4',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/sms-fika-start-questions',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'publishable_key')
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);
