-- Add sms_mode to onboarding_sessions so admin can suppress the bot
-- for in-progress onboarders who don't have a profile yet.

alter table public.onboarding_sessions
  add column if not exists sms_mode text not null default 'auto'
    check (sms_mode in ('auto', 'human')),
  add column if not exists sms_human_until timestamptz;
