-- Admin-controlled SMS handoff:
-- - sms_mode: 'auto' or 'human'
-- - sms_human_until: optional expiry for human mode

alter table public.profiles
  add column if not exists sms_mode text not null default 'auto',
  add column if not exists sms_human_until timestamptz;

do $$
begin
  alter table public.profiles
    add constraint profiles_sms_mode_check
    check (sms_mode in ('auto', 'human'));
exception when duplicate_object then
  null;
end $$;

comment on column public.profiles.sms_mode is 'SMS ownership mode: auto (webhook automation) or human (manual operator).';
comment on column public.profiles.sms_human_until is 'If sms_mode=human and this is in the future (or null), webhook automation is suppressed.';
