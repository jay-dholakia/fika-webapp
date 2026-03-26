-- Make venues.google_place_id conflict targetable (fix Postgres 42P10).
-- Postgres requires a UNIQUE constraint/index on the conflict target column(s).
-- A standard UNIQUE index allows multiple NULLs, so partial predicate is unnecessary.

begin;

drop index if exists public.venues_google_place_id_unique;

create unique index if not exists venues_google_place_id_unique
  on public.venues (google_place_id);

commit;

