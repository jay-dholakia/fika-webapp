-- Intro SMS offer window tracking + mutual match opt-in deadline + session opt-in withdraw timestamp.

alter table public.sms_conversation_states
  add column if not exists intro_offer_sent_at timestamptz;

comment on column public.sms_conversation_states.intro_offer_sent_at is
  'First time intro SMS entered match_offered for this row; feeds 24h blocking + expiry (fallback before backfill).';

update public.sms_conversation_states
set intro_offer_sent_at = updated_at
where state = 'match_offered'
  and match_id is not null
  and intro_offer_sent_at is null;

alter table public.match_candidates
  add column if not exists match_opt_in_deadline_at timestamptz;

comment on column public.match_candidates.match_opt_in_deadline_at is
  'Deadline for mutual per-match SMS opt-in (opt_ins); null when not enforced (e.g. legacy rows).';

create index if not exists match_candidates_match_opt_in_deadline_active_idx
  on public.match_candidates (match_opt_in_deadline_at)
  where status = 'active';

alter table public.fika_social_opt_ins
  add column if not exists withdrawn_at timestamptz;

comment on column public.fika_social_opt_ins.withdrawn_at is
  'When user withdrew their session opt-in before close (null = still opted in).';
