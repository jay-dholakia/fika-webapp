-- Fika Socials sweep (every 10 minutes) via pg_cron → Edge Function fika-socials-sweep.
-- Requires: pg_cron, pg_net, vault secrets project_url + publishable_key.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- Unschedule the old Next-route job if present.
do $$ begin perform cron.unschedule('fika-socials-sweep'); exception when others then null; end $$;

select cron.schedule(
  'fika-socials-sweep',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/fika-socials-sweep',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'publishable_key')
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);

