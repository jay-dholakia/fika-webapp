-- Hybrid weekly Fika: admin-scoped sessions, session opt-ins, match row approval + session link.
-- Ops: legacy weekly pool pg_cron jobs are unscheduled in 20260426130000; re-check Dashboard → Database → Cron
-- before enabling any new weekly jobs so Sun/Mon/Tue sends do not duplicate ad hoc triggers.

-- ---------------------------------------------------------------------------
-- markets: feature flags + default radius (session row can override radius)
-- ---------------------------------------------------------------------------
alter table public.markets
  add column if not exists weekly_hybrid_enabled boolean not null default false;

comment on column public.markets.weekly_hybrid_enabled is
  'When true, market may participate in weekly session SMS + matcher (still requires an active weekly_fika_sessions row for a given week).';

alter table public.markets
  add column if not exists weekly_default_radius_miles numeric not null default 4
  check (weekly_default_radius_miles > 0 and weekly_default_radius_miles <= 100);

comment on column public.markets.weekly_default_radius_miles is
  'Default geo radius (miles) for weekly session eligibility; weekly_fika_sessions.radius_miles overrides per session.';

-- ---------------------------------------------------------------------------
-- weekly_fika_sessions
-- ---------------------------------------------------------------------------
create table if not exists public.weekly_fika_sessions (
  id uuid primary key default gen_random_uuid(),
  market_slug text not null references public.markets (slug) on update cascade on delete restrict,
  venue_id uuid not null references public.venues (id) on delete restrict,
  week_anchor_monday date not null,
  radius_miles numeric not null default 4
    check (radius_miles > 0 and radius_miles <= 100),
  iana_tz text not null default 'America/Los_Angeles',
  fika_starts_at timestamptz not null,
  status text not null default 'draft'
    check (status in (
      'draft',
      'open_opt_in',
      'opt_in_closed',
      'matching_pending_review',
      'intro_send_ready',
      'intro_sms_sent',
      'completed',
      'cancelled'
    )),
  sunday_blast_sent_at timestamptz,
  opt_in_closes_at timestamptz,
  opt_in_closed_at timestamptz,
  match_run_at timestamptz,
  intro_sms_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.weekly_fika_sessions is
  'One admin-defined weekly Fika for a market + venue + week; drives Sun opt-in blast, Mon close, matcher, admin approval, Tue intro SMS.';

create index if not exists weekly_fika_sessions_market_week_idx
  on public.weekly_fika_sessions (market_slug, week_anchor_monday desc);

create index if not exists weekly_fika_sessions_status_idx
  on public.weekly_fika_sessions (status)
  where status not in ('completed', 'cancelled', 'draft');

-- Keep updated_at fresh (same pattern as match_candidates).
create or replace function public.set_weekly_fika_sessions_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists set_weekly_fika_sessions_updated_at_trigger on public.weekly_fika_sessions;
create trigger set_weekly_fika_sessions_updated_at_trigger
  before update on public.weekly_fika_sessions
  for each row
  execute function public.set_weekly_fika_sessions_updated_at();

alter table public.weekly_fika_sessions enable row level security;

-- ---------------------------------------------------------------------------
-- weekly_fika_session_opt_ins — one row per user per session; at most one session opt-in per user per week (enforced below)
-- ---------------------------------------------------------------------------
create table if not exists public.weekly_fika_session_opt_ins (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.weekly_fika_sessions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  week_anchor_monday date not null,
  opted_in_at timestamptz not null default now(),
  unique (session_id, user_id)
);

comment on table public.weekly_fika_session_opt_ins is
  'Users who replied YES to the weekly session Sun blast; week_anchor_monday denormalized for one-opt-in-per-user-per-week constraint.';

create index if not exists weekly_fika_session_opt_ins_session_idx
  on public.weekly_fika_session_opt_ins (session_id);

create index if not exists weekly_fika_session_opt_ins_user_idx
  on public.weekly_fika_session_opt_ins (user_id);

create unique index if not exists weekly_fika_session_opt_ins_one_per_user_week
  on public.weekly_fika_session_opt_ins (user_id, week_anchor_monday);

-- Denormalize week_anchor_monday from session on write.
create or replace function public.sync_weekly_session_opt_in_week()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  w date;
begin
  select s.week_anchor_monday into w
  from public.weekly_fika_sessions s
  where s.id = new.session_id;

  if w is null then
    raise exception 'weekly_fika_session not found for session_id %', new.session_id;
  end if;

  new.week_anchor_monday := w;
  return new;
end;
$$;

drop trigger if exists sync_weekly_session_opt_in_week_trigger on public.weekly_fika_session_opt_ins;
create trigger sync_weekly_session_opt_in_week_trigger
  before insert or update of session_id on public.weekly_fika_session_opt_ins
  for each row
  execute function public.sync_weekly_session_opt_in_week();

alter table public.weekly_fika_session_opt_ins enable row level security;

create policy "Users can read own weekly session opt-ins"
  on public.weekly_fika_session_opt_ins
  for select
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- match_candidates: weekly session link + admin gate before Tue intro SMS
-- ---------------------------------------------------------------------------
alter table public.match_candidates
  add column if not exists weekly_fika_session_id uuid references public.weekly_fika_sessions (id) on delete set null;

comment on column public.match_candidates.weekly_fika_session_id is
  'Non-null = row produced by weekly session matcher; null = ad hoc / legacy weekly batch rows.';

alter table public.match_candidates
  add column if not exists admin_approval_status text not null default 'approved'
    check (admin_approval_status in ('pending', 'approved', 'rejected'));

comment on column public.match_candidates.admin_approval_status is
  'Weekly rows start pending until admin approves; ad hoc rows default approved. Tue intro send must skip non-approved.';

alter table public.match_candidates
  add column if not exists admin_approval_at timestamptz;

comment on column public.match_candidates.admin_approval_at is
  'When admin last set approval to approved or rejected.';

alter table public.match_candidates
  add column if not exists weekly_intro_sms_sent_at timestamptz;

comment on column public.match_candidates.weekly_intro_sms_sent_at is
  'Step 2 intro SMS (name + plan + thumb/skip) for weekly-approved rows; distinct from first-offer / ad hoc paths if needed.';

create index if not exists match_candidates_weekly_session_idx
  on public.match_candidates (weekly_fika_session_id)
  where weekly_fika_session_id is not null;

create index if not exists match_candidates_weekly_pending_admin_idx
  on public.match_candidates (weekly_fika_session_id)
  where admin_approval_status = 'pending';
