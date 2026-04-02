-- Camber events ingestion: daily via pg_cron -> Edge Function camber-events-ingest.
-- Requires: pg_cron, pg_net, vault secrets project_url + publishable_key.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

do $$ begin perform cron.unschedule('camber-events-ingest'); exception when others then null; end $$;

select cron.schedule(
  'camber-events-ingest',
  '0 18 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/camber-events-ingest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'publishable_key')
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);
