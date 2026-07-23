alter table weekly_fika_events
  add column if not exists day_before_sms_sent_at timestamptz;

alter table weekly_rsvps
  add column if not exists day_before_confirmed_at timestamptz;

-- Cron: day-before confirm SMS (every 30 min)
select cron.schedule(
  'sms-fika-day-before',
  '*/30 * * * *',
  $$ select net.http_post(
    url        := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/sms-fika-day-before',
    headers    := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'publishable_key')),
    body       := '{}'::jsonb
  ) $$
);

-- Cron: cancel unconfirmed RSVPs 10-14h before event (every 30 min)
select cron.schedule(
  'sms-fika-unconfirmed-cancel',
  '*/30 * * * *',
  $$ select net.http_post(
    url        := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/sms-fika-unconfirmed-cancel',
    headers    := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'publishable_key')),
    body       := '{}'::jsonb
  ) $$
);
