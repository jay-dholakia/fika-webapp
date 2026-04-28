-- Ensure pg_cron calls fika-socials-sweep Edge Function with a JWT.
-- Supabase Functions require Authorization: Bearer <jwt>; prod Vault `publishable_key` is a Sendblue key.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

do $$ begin
  perform cron.unschedule('fika-socials-sweep');
exception when others then
  null;
end $$;

select cron.schedule(
  'fika-socials-sweep',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/fika-socials-sweep',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);

