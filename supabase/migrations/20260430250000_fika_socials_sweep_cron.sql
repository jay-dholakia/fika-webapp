-- Fika Socials sweep (every 10 minutes): invite T-48h, close opt-in, run matcher, send matches T-6h.
-- Runs via pg_cron → HTTP POST to the Next route `/api/cron/fika-socials`.
--
-- Requires:
-- - extensions: pg_cron, pg_net
-- - vault secrets:
--   - project_url: your app base URL (e.g. https://letsfika.vercel.app) OR your Supabase project URL if proxying
--   - cron_secret: shared secret to authorize the route (Authorization: Bearer ...)
--
-- NOTE: this is intentionally not an Edge Function invoke, because the implementation lives in Next.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

do $$ begin perform cron.unschedule('fika-socials-sweep'); exception when others then null; end $$;

select cron.schedule(
  'fika-socials-sweep',
  '*/10 * * * *',
  $$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/api/cron/fika-socials',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    )
  ) as request_id;
  $$
);

