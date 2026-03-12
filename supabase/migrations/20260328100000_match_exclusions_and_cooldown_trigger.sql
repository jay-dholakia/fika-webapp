-- Permanent exclusion when either user passed on the intro (never match again)
create table if not exists public.match_exclusions (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references public.profiles(id) on delete cascade,
  user_b uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz default now(),
  constraint match_exclusions_user_a_user_b_key unique (user_a, user_b),
  constraint match_exclusions_ordered check (user_a < user_b)
);

comment on table public.match_exclusions is 'Pairs that must never be matched again (e.g. either passed on the intro).';

alter table public.match_exclusions enable row level security;

-- No policies: only service role (bypasses RLS) can read/write; used by backend only.

-- Index for replenish lookups
create index if not exists match_exclusions_user_a_user_b_idx
  on public.match_exclusions (user_a, user_b);

-- When a match is confirmed (Fika scheduled), set 6-month cooldown so they can be re-matched later
create or replace function public.set_cooldown_on_confirmed_match()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ordered_a uuid;
  ordered_b uuid;
begin
  if NEW.scheduling_status is distinct from 'confirmed'
     or NEW.confirmed_at is null
     or (TG_OP = 'UPDATE' and OLD.scheduling_status = 'confirmed' and OLD.confirmed_at is not null) then
    return NEW;
  end if;

  if NEW.user_a < NEW.user_b then
    ordered_a := NEW.user_a;
    ordered_b := NEW.user_b;
  else
    ordered_a := NEW.user_b;
    ordered_b := NEW.user_a;
  end if;

  insert into cooldowns (user_a, user_b, last_matched_at, cooldown_until)
  values (ordered_a, ordered_b, now(), now() + interval '6 months')
  on conflict (user_a, user_b) do update set
    last_matched_at = excluded.last_matched_at,
    cooldown_until = excluded.cooldown_until;

  return NEW;
end;
$$;

comment on function public.set_cooldown_on_confirmed_match() is 'Trigger: when match_candidates becomes confirmed, upsert cooldowns for 6 months.';

drop trigger if exists set_cooldown_on_confirmed_match_trigger on public.match_candidates;
create trigger set_cooldown_on_confirmed_match_trigger
  after insert or update of scheduling_status, confirmed_at
  on public.match_candidates
  for each row
  execute function public.set_cooldown_on_confirmed_match();
