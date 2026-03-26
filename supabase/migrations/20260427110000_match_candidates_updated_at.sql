-- Add updated_at to match_candidates and keep it current on every update.

alter table public.match_candidates
  add column if not exists updated_at timestamptz not null default now();

comment on column public.match_candidates.updated_at is
  'Last update timestamp for match lifecycle changes (status, scheduling, venue, reminders).';

create index if not exists match_candidates_updated_at_idx
  on public.match_candidates (updated_at desc);

create or replace function public.set_match_candidates_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_match_candidates_updated_at_trigger on public.match_candidates;
create trigger set_match_candidates_updated_at_trigger
before update on public.match_candidates
for each row
execute function public.set_match_candidates_updated_at();

