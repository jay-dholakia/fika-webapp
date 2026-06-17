-- Send morning Fika questions 8 hours before each event
select cron.schedule(
  'sms-fika-morning',
  '*/30 * * * *',
  $$ select net.http_post(
    url        := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/sms-fika-morning',
    headers    := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'publishable_key')),
    body       := '{}'::jsonb
  ) $$
);
