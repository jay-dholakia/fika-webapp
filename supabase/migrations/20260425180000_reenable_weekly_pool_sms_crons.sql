-- Dual mode: weekly pool cadence (Sun opt-in → Mon lock → Mon replenish → Tue intros)
-- PLUS manual admin-triggered match delivery (sms-match-delivery with match_ids).
-- Safe unschedule: jobs may already be absent (e.g. after prior unschedule migrations).

do $$ begin perform cron.unschedule('sms-weekly-opt-in'); exception when others then null; end $$;
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

do $$ begin perform cron.unschedule('sms-follow-up'); exception when others then null; end $$;
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

do $$ begin perform cron.unschedule('sms-opt-in-expiration'); exception when others then null; end $$;
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

do $$ begin perform cron.unschedule('replenish-matches'); exception when others then null; end $$;
select cron.schedule(
  'replenish-matches',
  '30 19 * * 1',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/replenish-matches',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'publishable_key')
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);

do $$ begin perform cron.unschedule('sms-match-delivery'); exception when others then null; end $$;
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

do $$ begin perform cron.unschedule('sms-match-expiration'); exception when others then null; end $$;
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
