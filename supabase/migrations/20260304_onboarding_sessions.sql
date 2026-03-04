-- Onboarding by token: when user comes from SMS link, we save progress here until they "Sign in with Google to finalize".
-- token = single-use link param; payload = profile + intake answers; phone = set on merge.

create table if not exists public.onboarding_sessions (
  id uuid primary key default gen_random_uuid(),
  token uuid not null unique default gen_random_uuid(),
  phone text,
  payload jsonb default '{}',
  merged_into_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.onboarding_sessions is 'Phone-first signup: progress keyed by token (from SMS link) until user finalizes with Google.';
comment on column public.onboarding_sessions.payload is 'Profile + intake answers to merge into profile and intake_responses_v5.';

create index if not exists onboarding_sessions_token on public.onboarding_sessions (token);
create index if not exists onboarding_sessions_phone on public.onboarding_sessions (phone);
