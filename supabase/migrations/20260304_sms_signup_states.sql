-- Phone-first auth: track SMS signup progress by phone (before we have a user_id).
-- When an unknown number texts Concierge, we run this flow; at the end we create auth user + profile and set profiles.phone.

create table if not exists public.sms_signup_states (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique,
  step text not null,
  payload jsonb default '{}',
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.sms_signup_states is 'Phone-first signup: progress by phone (collect name, email, then create account + send magic link).';
comment on column public.sms_signup_states.step is 'e.g. collect_name, collect_email, done.';
comment on column public.sms_signup_states.payload is 'Collected data: first_name, email.';

create index if not exists sms_signup_states_phone on public.sms_signup_states (phone);
create index if not exists sms_signup_states_step on public.sms_signup_states (step);

-- No RLS: only service role (webhook) reads/writes this table.
