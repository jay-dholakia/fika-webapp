-- Retire Camber-only ingestion; events will be sourced elsewhere (manual admin + future multi-site ingest).
-- Safe if job name does not exist.

create extension if not exists pg_cron with schema extensions;

do $$ begin perform cron.unschedule('camber-events-ingest'); exception when others then null; end $$;
