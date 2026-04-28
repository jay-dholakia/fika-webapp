-- Rename misleading sunday_blast_sent_at → opt_in_invite_sent_at for relative-cadence socials.
-- This timestamp is used as an idempotency marker for the T-48h invite message.

alter table public.fika_socials
  rename column sunday_blast_sent_at to opt_in_invite_sent_at;

comment on column public.fika_socials.opt_in_invite_sent_at is
  'When the T−48h invite/opt-in ask was last sent (idempotency marker; not tied to a weekday).';

