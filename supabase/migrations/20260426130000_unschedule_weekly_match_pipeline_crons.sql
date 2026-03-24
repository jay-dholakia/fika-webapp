-- New protocol: no weekly batch opt-in / replenish / scheduled intro delivery / weekly expirations.
-- Match offers use admin or explicit invokes; Edge Functions remain deployable.
-- Safe unschedule: jobs may already be absent.

do $$ begin perform cron.unschedule('sms-weekly-opt-in'); exception when others then null; end $$;
do $$ begin perform cron.unschedule('sms-weekly-optin'); exception when others then null; end $$;
do $$ begin perform cron.unschedule('sms-weekly-opt-in-reminder'); exception when others then null; end $$;

do $$ begin perform cron.unschedule('sms-follow-up'); exception when others then null; end $$;

do $$ begin perform cron.unschedule('sms-opt-in-expiration'); exception when others then null; end $$;

do $$ begin perform cron.unschedule('replenish-matches'); exception when others then null; end $$;

do $$ begin perform cron.unschedule('sms-match-delivery'); exception when others then null; end $$;

do $$ begin perform cron.unschedule('sms-match-expiration'); exception when others then null; end $$;
