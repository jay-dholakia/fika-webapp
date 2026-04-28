-- Rename hybrid "weekly Fika" schema to neutral fika_socials naming (product moving off fixed weekly cadence).

-- ---------------------------------------------------------------------------
-- markets
-- ---------------------------------------------------------------------------
alter table public.markets rename column weekly_hybrid_enabled to fika_socials_enabled;
alter table public.markets rename column weekly_default_radius_miles to fika_socials_default_radius_miles;

comment on column public.markets.fika_socials_enabled is
  'When true, market may participate in fika socials (SMS + matcher); still requires an active fika_socials row for that week when used.';
comment on column public.markets.fika_socials_default_radius_miles is
  'Default geo radius (miles) for fika social eligibility; fika_socials.radius_miles overrides per session.';

-- ---------------------------------------------------------------------------
-- Triggers / functions (before table renames)
-- ---------------------------------------------------------------------------
drop trigger if exists sync_weekly_session_opt_in_week_trigger on public.weekly_fika_session_opt_ins;
drop trigger if exists set_weekly_fika_sessions_updated_at_trigger on public.weekly_fika_sessions;

drop function if exists public.sync_weekly_session_opt_in_week();
drop function if exists public.set_weekly_fika_sessions_updated_at();

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
alter table public.weekly_fika_sessions rename to fika_socials;
alter table public.weekly_fika_session_opt_ins rename to fika_social_opt_ins;

comment on table public.fika_socials is
  'Admin-defined in-person fika social: market, venue, week anchor, fika_starts_at, lifecycle status and ops timestamps.';
comment on table public.fika_social_opt_ins is
  'Users opted in to a fika social session; week_anchor_monday denormalized for at most one opt-in per user per week.';

-- ---------------------------------------------------------------------------
-- updated_at on fika_socials
-- ---------------------------------------------------------------------------
create or replace function public.set_fika_socials_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger set_fika_socials_updated_at_trigger
  before update on public.fika_socials
  for each row
  execute function public.set_fika_socials_updated_at();

-- ---------------------------------------------------------------------------
-- Opt-in week sync
-- ---------------------------------------------------------------------------
create or replace function public.sync_fika_social_opt_in_week()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  w date;
begin
  select s.week_anchor_monday into w
  from public.fika_socials s
  where s.id = new.session_id;

  if w is null then
    raise exception 'fika_social not found for session_id %', new.session_id;
  end if;

  new.week_anchor_monday := w;
  return new;
end;
$$;

create trigger sync_fika_social_opt_in_week_trigger
  before insert or update of session_id on public.fika_social_opt_ins
  for each row
  execute function public.sync_fika_social_opt_in_week();

-- ---------------------------------------------------------------------------
-- RLS (opt_ins policy name + table)
-- ---------------------------------------------------------------------------
drop policy if exists "Users can read own weekly session opt-ins" on public.fika_social_opt_ins;

create policy "Users can read own fika social opt-ins"
  on public.fika_social_opt_ins
  for select
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Indexes (names only)
-- ---------------------------------------------------------------------------
alter index if exists weekly_fika_sessions_market_week_idx rename to fika_socials_market_week_idx;
alter index if exists weekly_fika_sessions_status_idx rename to fika_socials_status_idx;
alter index if exists weekly_fika_session_opt_ins_session_idx rename to fika_social_opt_ins_session_idx;
alter index if exists weekly_fika_session_opt_ins_user_idx rename to fika_social_opt_ins_user_idx;
alter index if exists weekly_fika_session_opt_ins_one_per_user_week rename to fika_social_opt_ins_one_per_user_week;

-- ---------------------------------------------------------------------------
-- match_candidates FK column + intro SMS column
-- ---------------------------------------------------------------------------
alter table public.match_candidates rename column weekly_fika_session_id to fika_social_id;
alter table public.match_candidates rename column weekly_intro_sms_sent_at to fika_social_intro_sms_sent_at;

comment on column public.match_candidates.fika_social_id is
  'Non-null = row produced by fika socials matcher; null = ad hoc or non–fika-social flow.';
comment on column public.match_candidates.fika_social_intro_sms_sent_at is
  'Step-2 intro SMS timestamp for approved fika-social match rows.';

alter index if exists match_candidates_weekly_session_idx rename to match_candidates_fika_social_idx;
alter index if exists match_candidates_weekly_pending_admin_idx rename to match_candidates_fika_social_pending_admin_idx;

-- Rename FK constraint if it exists with default Postgres name
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.match_candidates'::regclass
      and conname = 'match_candidates_weekly_fika_session_id_fkey'
  ) then
    alter table public.match_candidates
      rename constraint match_candidates_weekly_fika_session_id_fkey to match_candidates_fika_social_id_fkey;
  end if;
end $$;
