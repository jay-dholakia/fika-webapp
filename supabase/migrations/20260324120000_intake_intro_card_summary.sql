-- Precomputed scannable intro copy for match intro modal (OpenAI + fallback).
alter table public.intake_responses_v5
  add column if not exists intro_card_summary jsonb;

comment on column public.intake_responses_v5.intro_card_summary is
  'JSON: { paragraph, bullets[], source }. Generated on intake embed; no invented facts.';
