-- opt_ins.decision: allow see_intro (SMS teaser — user agreed to see intro before mutual reveal).
-- Without this, upsert from sendblue-webhook fails with 23514 (check_violation).

do $$
declare
  rec record;
begin
  for rec in
    select c.conname::text as conname
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_class t on t.oid = c.conrelid
    join pg_catalog.pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'opt_ins'
      and c.contype = 'c'
      and pg_catalog.pg_get_constraintdef(c.oid) ilike '%decision%'
  loop
    execute format('alter table public.opt_ins drop constraint %I', rec.conname);
  end loop;
end
$$;

alter table public.opt_ins
  add constraint opt_ins_decision_check
  check (
    decision is null
    or decision in ('opt_in', 'yes', 'pass', 'no', 'see_intro')
  );

comment on constraint opt_ins_decision_check on public.opt_ins is
  'Match SMS decisions: opt_in/yes = meet; pass/no = decline; see_intro = yes to teaser before mutual intro.';
