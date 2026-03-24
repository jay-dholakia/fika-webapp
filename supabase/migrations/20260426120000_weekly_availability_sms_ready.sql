-- After saving availability in the app, user texts READY to confirm; webhook clears pending and records time.

alter table public.weekly_availability
  add column if not exists pending_sms_ready_confirmation boolean not null default false;

alter table public.weekly_availability
  add column if not exists sms_ready_confirmed_at timestamptz;

comment on column public.weekly_availability.pending_sms_ready_confirmation is
  'Set true when user saves slots in app; cleared when they text READY or clear slots.';
comment on column public.weekly_availability.sms_ready_confirmed_at is
  'When concierge received READY and availability was confirmed for this batch_week.';
