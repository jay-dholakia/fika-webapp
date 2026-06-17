-- Admin controls all timing; no fixed Monday send
select cron.unschedule('sms-weekly-opt-in');
