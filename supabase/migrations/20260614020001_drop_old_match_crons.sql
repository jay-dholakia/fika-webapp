-- Remove pg_cron jobs for retired old 1:1 match system functions.

SELECT cron.unschedule('expire-fika-matches');
SELECT cron.unschedule('fika-socials-sweep');
SELECT cron.unschedule('match-intro-maintenance');
SELECT cron.unschedule('sms-cancel-retry-timeout');
SELECT cron.unschedule('sms-day-reminder');
SELECT cron.unschedule('sms-fika-start-questions');
SELECT cron.unschedule('sms-fika-start-questions-late');
SELECT cron.unschedule('sms-post-fika');
SELECT cron.unschedule('sms-three-hour-reminder');
