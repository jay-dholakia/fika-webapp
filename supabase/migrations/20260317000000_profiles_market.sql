-- Add market (city group) to profiles for per-city progress and opt-in.
-- e.g. 'la' for Los Angeles metro (Santa Monica, Culver City, etc.), 'sf', 'nyc'.

alter table if exists public.profiles
  add column if not exists market text;

comment on column public.profiles.market is 'City market slug for progress/opt-in (la, sf, nyc). Derived from city; Santa Monica etc. count as LA.';
