-- Idempotent gate: only one concurrent webhook delivers SMS intro (card + copy) after both users opt in to "see intro".
alter table public.match_candidates
  add column if not exists mutual_intro_revealed_at timestamptz null;

comment on column public.match_candidates.mutual_intro_revealed_at is
  'Set when intro card + reveal SMS was sent to both participants (mutual see_intro gate).';
