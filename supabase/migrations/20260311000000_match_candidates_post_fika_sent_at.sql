-- Track when we sent the post-Fika feedback message (~2h after Fika) so we only send once per match.
alter table public.match_candidates
  add column if not exists post_fika_sent_at timestamptz;

comment on column public.match_candidates.post_fika_sent_at is
  'When we sent the "how did your Fika go?" feedback message (~2h after Fika start).';
