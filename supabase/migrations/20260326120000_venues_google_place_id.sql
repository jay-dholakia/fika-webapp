-- Allow venues discovered via Google Places API (New) to dedupe and cache.
alter table public.venues
  add column if not exists google_place_id text;

create unique index if not exists venues_google_place_id_unique
  on public.venues (google_place_id)
  where google_place_id is not null;

comment on column public.venues.google_place_id is
  'Google Place resource name suffix (places/xxx) or place id for upserts from Places API fallback.';
