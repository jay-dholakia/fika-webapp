-- Remove legacy cron job that duplicates replenish-matches.
select cron.unschedule(jobid) from cron.job where jobname = 'replenish-fika-matches';

