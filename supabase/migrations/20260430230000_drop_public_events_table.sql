-- Remove curated local-events feature (admin queue + SMS keyword picks + Bookmanager ingest).
drop trigger if exists trg_events_updated_at on public.events;
drop table if exists public.events cascade;
drop function if exists public.set_events_updated_at();
