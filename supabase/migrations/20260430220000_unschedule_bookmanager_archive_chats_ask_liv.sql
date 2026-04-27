-- Retire Edge Functions removed from repo: Bookmanager ingest, archive inactive chats, ask-liv.
-- Idempotent unschedule by job name and by URL pattern (catches renames).

do $$ begin perform cron.unschedule('bookmanager-events-ingest'); exception when others then null; end $$;
do $$ begin perform cron.unschedule('archive-inactive-chats-daily'); exception when others then null; end $$;
do $$ begin perform cron.unschedule('archive-inactive-chats'); exception when others then null; end $$;
do $$ begin perform cron.unschedule('ask-liv'); exception when others then null; end $$;

select cron.unschedule(j.jobid)
from cron.job j
where j.command ~* '/functions/v1/(bookmanager-events-ingest|archive-inactive-chats|ask-liv)';
