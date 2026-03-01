-- Allow setting availability without opting in. opted_in_at null = not in this week's run.
alter table public.weekly_match_opt_ins
  alter column opted_in_at drop not null;

comment on column public.weekly_match_opt_ins.opted_in_at is
  'When set, user is opted in for this week''s run. Null = row exists for availability only.';
