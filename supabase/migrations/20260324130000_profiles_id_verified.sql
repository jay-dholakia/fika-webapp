-- Persona ID verification: profile badge and trust signals.
alter table public.profiles
  add column if not exists id_verified_at timestamptz,
  add column if not exists persona_inquiry_id text;

comment on column public.profiles.id_verified_at is 'When Persona government-ID verification completed successfully.';
comment on column public.profiles.persona_inquiry_id is 'Latest Persona inquiry id (audit / support).';
