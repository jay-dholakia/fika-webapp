-- Weekly event admin sets before Monday opt-in fires: one row per market per week.
create table if not exists weekly_fika_events (
  id           uuid        primary key default gen_random_uuid(),
  market_slug  text        not null,
  week_ymd     date        not null,  -- the Wednesday date
  venue_id     uuid        references venues(id),
  slot_id      text        not null default 'wed_18_00',
  created_at   timestamptz default now(),
  unique (market_slug, week_ymd)
);

-- User RSVP to this week's event (replaces the never-implemented weekly opt-in).
create table if not exists weekly_rsvps (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references profiles(id),
  market_slug  text        not null,
  week_ymd     date        not null,
  decision     text        not null check (decision in ('yes', 'no', 'no_response')),
  decided_at   timestamptz default now(),
  unique (user_id, week_ymd)
);

create index if not exists weekly_rsvps_week_decision on weekly_rsvps (week_ymd, decision);
