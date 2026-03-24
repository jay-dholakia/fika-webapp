-- Per-user SMS intro cadence: weekly pool (FIKA / availability / crons) vs match-first (we reach out when we have an intro).
-- Both can run in the same deployment for different users.

alter table public.profiles
  add column if not exists sms_intro_mode text;

update public.profiles set sms_intro_mode = 'match_first' where sms_intro_mode is null;

alter table public.profiles
  alter column sms_intro_mode set default 'match_first';

alter table public.profiles
  alter column sms_intro_mode set not null;

alter table public.profiles drop constraint if exists profiles_sms_intro_mode_check;

alter table public.profiles
  add constraint profiles_sms_intro_mode_check check (sms_intro_mode in ('weekly_pool', 'match_first'));

comment on column public.profiles.sms_intro_mode is
  'weekly_pool: text FIKA / weekly_match_opt_ins / availability / scheduled crons. match_first: generic first-contact copy; manual intros.';
