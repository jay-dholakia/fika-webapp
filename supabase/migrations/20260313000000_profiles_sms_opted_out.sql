-- When user texts STOP we set this; they can opt back in by texting the Concierge again.
alter table public.profiles
  add column if not exists sms_opted_out_at timestamptz;

comment on column public.profiles.sms_opted_out_at is
  'When the user opted out of SMS (texted STOP). Null = receives SMS. Text Concierge again to clear and opt back in.';
