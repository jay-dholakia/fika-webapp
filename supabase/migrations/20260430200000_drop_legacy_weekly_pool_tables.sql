-- Remove legacy Sunday–Monday–Tuesday weekly *pool* tables and policies.
-- New weekly product uses weekly_fika_sessions / weekly_fika_session_opt_ins (separate migration).
-- Crons targeting removed Edge functions should already be unscheduled (20260426130000); re-check Dashboard if needed.

-- sms_intro_mode: retire weekly_pool label (no longer a DB-backed cohort).
update public.profiles
set sms_intro_mode = 'match_first'
where sms_intro_mode = 'weekly_pool';

alter table public.profiles drop constraint if exists profiles_sms_intro_mode_check;

alter table public.profiles
  add constraint profiles_sms_intro_mode_check check (sms_intro_mode in ('match_first'));

comment on column public.profiles.sms_intro_mode is
  'SMS intro lane: match_first = per-match / admin-triggered flow. Legacy weekly_pool cohort removed.';

drop table if exists public.weekly_availability cascade;
drop table if exists public.weekly_match_opt_ins cascade;
