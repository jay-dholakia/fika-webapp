-- Run 3-hour-before reminder every hour so we catch Fikas that are 2.5–3.5 hours out.
-- Uses same vault secrets as other SMS crons: project_url, publishable_key.

select cron.schedule(
  'sms-three-hour-reminder',
  '0 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/sms-three-hour-reminder',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'publishable_key')
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);
