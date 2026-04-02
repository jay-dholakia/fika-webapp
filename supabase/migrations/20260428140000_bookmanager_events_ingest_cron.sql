-- Bookmanager shop events (e.g. Village Well): daily via pg_cron → Edge Function bookmanager-events-ingest.
-- Requires: pg_cron, pg_net, vault secrets project_url + publishable_key (same as other Edge crons).
-- Optional Edge secrets:
--   BOOKMANAGER_SHOPS — JSON array of shops (multi-shop). Each: source, webstore_san, shop_origin;
--     optional: timezone, store_id, venue_name, neighborhood, listing_path.
--   If unset, legacy single-shop env vars apply (defaults = Village Well).
--   BOOKMANAGER_SHOP_ORIGIN, BOOKMANAGER_WEBSTORE_SAN, BOOKMANAGER_EVENTS_SOURCE, BOOKMANAGER_TIMEZONE,
--   BOOKMANAGER_STORE_ID, BOOKMANAGER_VENUE_NAME, BOOKMANAGER_NEIGHBORHOOD, BOOKMANAGER_LISTING_PATH.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

do $$ begin perform cron.unschedule('bookmanager-events-ingest'); exception when others then null; end $$;

select cron.schedule(
  'bookmanager-events-ingest',
  '5 18 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/bookmanager-events-ingest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'publishable_key')
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);
