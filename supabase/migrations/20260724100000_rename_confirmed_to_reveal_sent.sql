-- Rename SMS conversation state 'confirmed' → 'reveal_sent'
-- 'confirmed' was misleading: it means "reveal SMS was sent 30 min before the meeting",
-- not "user confirmed attendance" (that's weekly_rsvps.day_before_confirmed_at).
UPDATE sms_conversation_states SET state = 'reveal_sent' WHERE state = 'confirmed';

-- Schedule post-event cleanup: resets reveal_sent → global_ready 2h after event ends,
-- and deletes stale per-match reveal_sent rows older than 7 days.
select cron.schedule(
  'sms-post-event-cleanup',
  '*/30 * * * *',
  $$ select net.http_post(
    url        := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/sms-post-event-cleanup',
    headers    := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'publishable_key')),
    body       := '{}'::jsonb
  ) $$
);
