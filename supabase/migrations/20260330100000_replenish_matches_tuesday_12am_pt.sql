-- Replenish matches at Monday 12:30pm PT (~19:30 UTC) so match_candidates exist shortly after the opt-in/availability deadline and before Tuesday 9am PT match delivery.
select cron.unschedule('replenish-matches');

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
