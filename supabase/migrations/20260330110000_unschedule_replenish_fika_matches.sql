-- Remove legacy cron job that duplicates replenish-matches.
select cron.unschedule('replenish-fika-matches');

