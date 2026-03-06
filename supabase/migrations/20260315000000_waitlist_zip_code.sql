-- Add zip_code to waitlist for email + location (zip) capture.
-- Existing rows keep zip_code NULL.

alter table if exists public.waitlist
  add column if not exists zip_code text;

comment on column public.waitlist.zip_code is 'US zip code (5 or 9 digits) for waitlist location.';
