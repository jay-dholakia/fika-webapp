-- Disable automatic weekly opt-in and automatic match-delivery SMS.
-- Match delivery is now manual-only from the admin portal.

do $$
begin
  -- Historical names used across prior migrations.
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
  perform cron.unschedule('sms-match-delivery');
exception when others then
  null;
end $$;
