-- Cache Google Places business status to avoid permanently closed venues.
alter table public.venues
  add column if not exists google_business_status text,
  add column if not exists google_permanently_closed boolean not null default false;

comment on column public.venues.google_business_status is
  'Google Places businessStatus (e.g. PERMANENTLY_CLOSED) from the latest venue discovery.';

comment on column public.venues.google_permanently_closed is
  'True when Google Places says this venue is permanently closed.';

create index if not exists venues_google_permanently_closed_idx
  on public.venues (google_permanently_closed);

