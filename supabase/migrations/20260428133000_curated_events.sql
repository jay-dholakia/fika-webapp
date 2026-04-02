create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  source_post_url text,
  source_post_title text,
  raw_event_text text,
  title text,
  description_short text,
  starts_at timestamptz,
  ends_at timestamptz,
  venue_name text,
  neighborhood text,
  event_url text,
  category text,
  tags jsonb not null default '[]'::jsonb,
  parsed_payload jsonb not null default '{}'::jsonb,
  confidence numeric(4,3),
  status text not null default 'draft',
  review_notes text,
  approved_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  rejected_at timestamptz,
  rejected_by uuid references auth.users(id) on delete set null,
  expired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint events_status_check check (status in ('draft', 'approved', 'rejected', 'expired'))
);

create index if not exists events_status_starts_at_idx
  on public.events (status, starts_at desc nulls last);

create index if not exists events_source_created_at_idx
  on public.events (source, created_at desc);

create unique index if not exists events_source_event_url_unique
  on public.events (source, event_url)
  where event_url is not null;

create unique index if not exists events_source_post_title_venue_unique
  on public.events (source, source_post_url, title, coalesce(venue_name, ''))
  where source_post_url is not null and title is not null;

create or replace function public.set_events_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_events_updated_at on public.events;
create trigger trg_events_updated_at
before update on public.events
for each row execute function public.set_events_updated_at();
