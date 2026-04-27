-- Remove any pg_cron rows that still POST to Edge Functions deleted from the repo
-- (weekly pool pipeline: opt-in blast, follow-up, opt-in expiration, replenish).
-- Idempotent: prod meetwithmoai was already clean; this catches renamed jobs or stale dashboards.

select cron.unschedule(j.jobid)
from cron.job j
where j.command ~* '/functions/v1/(sms-weekly-opt-in|sms-follow-up|sms-opt-in-expiration|replenish-matches)';
