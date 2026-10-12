alter table public.profiles
  add column if not exists jay_followup_sent_at timestamptz;
