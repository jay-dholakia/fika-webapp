-- Add age_preference to profiles (e.g. "Open to any age/life stage" | "Prefer around my age").
-- Used by onboarding and matching (replenish-matches: ±3 years when "Prefer around my age").

alter table if exists public.profiles
  add column if not exists age_preference text;

comment on column public.profiles.age_preference is 'Age/life-stage preference: Open to any age/life stage | Prefer around my age. Used in matching.';
