-- Rename misleading sunday_blast_sent_at → opt_in_invite_sent_at for relative-cadence socials.
-- This timestamp is used as an idempotency marker for the T-48h invite message.

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'fika_socials'
      and column_name = 'sunday_blast_sent_at'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'fika_socials'
      and column_name = 'opt_in_invite_sent_at'
  ) then
    alter table public.fika_socials
      rename column sunday_blast_sent_at to opt_in_invite_sent_at;
  end if;
end $$;

comment on column public.fika_socials.opt_in_invite_sent_at is
  'When the T−48h invite/opt-in ask was last sent (idempotency marker; not tied to a weekday).';

