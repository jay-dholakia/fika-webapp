-- Store post-Fika feedback when users reply to the "How did your Fika go?" SMS.
-- One row per message; multiple replies from the same user for the same match are allowed.

create table if not exists public.fika_feedback (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.match_candidates(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists fika_feedback_match_id on public.fika_feedback (match_id);
create index if not exists fika_feedback_user_id on public.fika_feedback (user_id);
create index if not exists fika_feedback_created_at on public.fika_feedback (created_at desc);

comment on table public.fika_feedback is
  'Feedback messages from users after a Fika (reply to post-Fika SMS). Tagged to match and user.';
comment on column public.fika_feedback.match_id is 'The Fika (match) this feedback is about.';
comment on column public.fika_feedback.user_id is 'Who sent the feedback (join to profiles for name).';
comment on column public.fika_feedback.content is 'The message they sent.';

-- RLS: service role only for now (webhook/cron); no direct user access.
alter table public.fika_feedback enable row level security;

create policy "Service role can do anything on fika_feedback"
  on public.fika_feedback
  for all
  to service_role
  using (true)
  with check (true);
