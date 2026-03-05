-- Track when each user replied YES/PASS so we can order "first YES" vs "second YES" for proposal flow.
alter table public.opt_ins
  add column if not exists answered_at timestamptz default now();

comment on column public.opt_ins.answered_at is
  'When the user replied YES or PASS to the match offer; used to send proposal to second YES-er first.';
