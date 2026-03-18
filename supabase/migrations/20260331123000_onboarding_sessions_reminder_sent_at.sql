-- SMS reminder for onboarding sessions that haven't been merged into a user yet.
-- Used to send exactly one reminder and avoid re-sending.

alter table public.onboarding_sessions
  add column if not exists reminder_sent_at timestamptz;

comment on column public.onboarding_sessions.reminder_sent_at is
  'When we last sent the onboarding reminder SMS (null = not sent yet).';

