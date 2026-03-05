-- SMS agent: phone on profiles, conversation state, venues, match venue.

-- 1. profiles.phone (E.164) for Sendblue identity
alter table public.profiles
  add column if not exists phone text;

comment on column public.profiles.phone is 'E.164 phone number for SMS (Sendblue Concierge/Match).';

create unique index if not exists profiles_phone_key on public.profiles (phone) where phone is not null;

-- 2. SMS conversation state (Concierge flow per user / per match)
create table if not exists public.sms_conversation_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  batch_week date,
  match_id uuid references public.match_candidates(id) on delete set null,
  state text not null,
  payload jsonb default '{}',
  last_sendblue_message_handle text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, batch_week, match_id)
);

comment on table public.sms_conversation_states is 'Tracks where a user is in the Fika Concierge SMS flow (opt-in, match offer, scheduling, venue, etc.).';
comment on column public.sms_conversation_states.state is 'e.g. awaiting_opt_in, opted_in, match_offered, accepted_scheduling_day, scheduling_window, venue_proposed, confirmed.';
comment on column public.sms_conversation_states.payload is 'Extra data: selected_day, selected_window, etc.';

create index if not exists sms_conversation_states_user_id on public.sms_conversation_states (user_id);
create index if not exists sms_conversation_states_match_id on public.sms_conversation_states (match_id);
create index if not exists sms_conversation_states_batch_week on public.sms_conversation_states (batch_week);

alter table public.sms_conversation_states enable row level security;

create policy "Users can manage own sms_conversation_states"
  on public.sms_conversation_states for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Service role can manage all (for webhook/cron)
-- (RLS still applies; use service_role key in backend.)

-- 3. Venues (for Fika meetup suggestions)
create table if not exists public.venues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  neighborhood text,
  city text not null,
  address text,
  lat numeric,
  lng numeric,
  created_at timestamptz default now()
);

comment on table public.venues is 'Suggested meetup venues (e.g. coffee shops). Used for SMS venue step.';

alter table public.venues enable row level security;

create policy "Anyone can read venues"
  on public.venues for select
  using (true);

-- 4. match_candidates: suggested/confirmed venue
alter table public.match_candidates
  add column if not exists suggested_venue_id uuid references public.venues(id) on delete set null,
  add column if not exists confirmed_venue_id uuid references public.venues(id) on delete set null,
  add column if not exists confirmed_at timestamptz;

comment on column public.match_candidates.suggested_venue_id is 'Venue proposed in SMS (CONFIRM or CHANGE).';
comment on column public.match_candidates.confirmed_venue_id is 'Venue once both confirmed (for reminder and relay).';
comment on column public.match_candidates.confirmed_at is 'When both confirmed time + venue (for day-of reminder).';

-- Seed a few LA venues (example)
insert into public.venues (name, neighborhood, city)
select 'Maru Coffee', 'Los Feliz', 'Los Angeles' where not exists (select 1 from public.venues where name = 'Maru Coffee' and city = 'Los Angeles')
union all
select 'Café Los Feliz', 'Los Feliz', 'Los Angeles' where not exists (select 1 from public.venues where name = 'Café Los Feliz' and city = 'Los Angeles')
union all
select 'Alfred Coffee', 'Silver Lake', 'Los Angeles' where not exists (select 1 from public.venues where name = 'Alfred Coffee' and city = 'Los Angeles');
