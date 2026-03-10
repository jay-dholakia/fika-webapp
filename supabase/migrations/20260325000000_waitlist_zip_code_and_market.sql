-- Add zip_code and market to waitlist for signup-by-market.
-- zip_code: from form; we geocode it to get city and derive market (same as onboarding).
ALTER TABLE public.waitlist
  ADD COLUMN IF NOT EXISTS zip_code text;
ALTER TABLE public.waitlist
  ADD COLUMN IF NOT EXISTS market text;
COMMENT ON COLUMN public.waitlist.zip_code IS 'US zip code (5 or 9 digits) from signup form.';
COMMENT ON COLUMN public.waitlist.market IS 'Market slug derived from geocoded city (e.g. la, sf, nyc). Same logic as profiles.market.';
