-- Match-first / manual intro mode: stop automatic weekly replenishment of match_candidates.
-- Replenish can still be invoked manually (e.g. scripts / Edge Function invoke) if needed.

do $$
begin
  perform cron.unschedule('replenish-matches');
exception when others then
  null;
end $$;

-- Safety: auto match-delivery SMS should also stay off (manual admin trigger only).
do $$
begin
  perform cron.unschedule('sms-match-delivery');
exception when others then
  null;
end $$;
