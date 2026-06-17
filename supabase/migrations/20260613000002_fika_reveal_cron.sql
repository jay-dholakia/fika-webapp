-- Auto-send match reveals 30 min before each event
select cron.schedule(
  'sms-fika-reveals',
  '*/5 * * * *',
  $$ select net.http_post(
    url        := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/sms-fika-reveals',
    headers    := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'publishable_key')),
    body       := '{}'::jsonb
  ) $$
);
