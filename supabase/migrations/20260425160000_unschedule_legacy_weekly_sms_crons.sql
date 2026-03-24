-- Legacy weekly pool SMS crons (match-first / manual mode).
-- Safe to run if jobs were already removed (e.g. migration 20260425120000).

do $$
begin
  perform cron.unschedule('sms-weekly-opt-in');
exception when others then
  null;
end $$;

do $$
begin
  perform cron.unschedule('sms-weekly-optin');
exception when others then
  null;
end $$;

do $$
begin
  perform cron.unschedule('sms-weekly-opt-in-reminder');
exception when others then
  null;
end $$;

do $$
begin
  perform cron.unschedule('sms-follow-up');
exception when others then
  null;
end $$;

do $$
begin
  perform cron.unschedule('sms-opt-in-expiration');
exception when others then
  null;
end $$;
