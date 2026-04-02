-- Recurring Bookmanager (and similar) events reuse the same listing URL, venue, and title
-- but have distinct event_url values. Dedupe is already enforced by events_source_event_url_unique.
drop index if exists public.events_source_post_title_venue_unique;
