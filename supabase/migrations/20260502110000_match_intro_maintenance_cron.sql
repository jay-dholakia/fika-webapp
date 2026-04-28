-- Hourly intro maintenance: stale match_offered SMS rows + missed mutual opt_ins on match_candidates.
-- pg_cron → Edge Function match-intro-maintenance (same vault pattern as sms-cancel-retry-timeout).
-- Requires: pg_cron, pg_net, vault secrets project_url + publishable_key.
-- Run after 20260502100000_intro_offer_match_deadlines.sql (columns intro_offer_sent_at, match_opt_in_deadline_at).

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

do $$ begin perform cron.unschedule('match-intro-maintenance'); exception when others then null; end $$;

select cron.schedule(
  'match-intro-maintenance',
  '30 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/match-intro-maintenance',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'publishable_key')
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);
