-- Admin overrides for fika socials invite pool (exclude specific profiles from a session).
-- Default behavior: all eligible profiles (market + radius + coords) are included.

create table if not exists public.fika_social_invite_exclusions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.fika_socials (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  excluded_at timestamptz not null default now(),
  unique (session_id, user_id)
);

comment on table public.fika_social_invite_exclusions is
  'Admin overrides: profiles excluded from a fika social invite pool. Used by blast/opt-in eligibility gating.';

create index if not exists fika_social_invite_exclusions_session_idx
  on public.fika_social_invite_exclusions (session_id);

create index if not exists fika_social_invite_exclusions_user_idx
  on public.fika_social_invite_exclusions (user_id);

alter table public.fika_social_invite_exclusions enable row level security;
-- No policies: service role only.

