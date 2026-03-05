-- Run replenish-matches 1 hour after opt-in deadline (Tuesday 11:59pm PT = Wed 07:59 UTC → Wed 08:59 UTC).
-- Gives ~7 hours to review match_candidates before sms-match-delivery sends intros at Wed 16:00 UTC (8am PT).
-- Requires vault secrets: project_url, publishable_key (same as other SMS crons).

select cron.schedule(
  'replenish-matches',
  '59 8 * * 3',
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
