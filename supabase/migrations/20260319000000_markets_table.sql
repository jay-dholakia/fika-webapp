-- Markets table: one row per market (populated from signups). Active = Monday SMS + match run.
create table if not exists public.markets (
  slug text primary key,
  label text not null default '',
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.markets is 'City markets; rows created when profiles get a market. active = send weekly opt-in SMS and include in match run.';

-- Backfill from existing profiles
insert into public.markets (slug, label, active)
select distinct market, market, false
from public.profiles
where market is not null and market <> ''
on conflict (slug) do nothing;

-- Trigger: when a profile gets a market, ensure that market exists in markets
create or replace function public.ensure_market_on_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.market is not null and new.market <> '' then
    insert into public.markets (slug, label, updated_at)
    values (new.market, new.market, now())
    on conflict (slug) do update set updated_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists on_profile_market_set on public.profiles;
create trigger on_profile_market_set
  after insert or update of market on public.profiles
  for each row
  execute function public.ensure_market_on_profile();

-- RLS: only service role (server) can read/write; anon/authenticated cannot access
alter table public.markets enable row level security;

-- No policies for anon/authenticated = no access. Service role bypasses RLS.
