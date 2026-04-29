-- Persist Fika Social 👍/confirm times on the match row so admin (and history) still work
-- after sms_conversation_states rows are removed post-event (6h after fika_starts_at).

alter table public.match_candidates
  add column if not exists fika_social_user_a_confirmed_at timestamptz,
  add column if not exists fika_social_user_b_confirmed_at timestamptz;

comment on column public.match_candidates.fika_social_user_a_confirmed_at is
  'When user_a confirmed via SMS for a Fika Social pair (survives sms_conversation_states teardown).';
comment on column public.match_candidates.fika_social_user_b_confirmed_at is
  'When user_b confirmed via SMS for a Fika Social pair (survives sms_conversation_states teardown).';
