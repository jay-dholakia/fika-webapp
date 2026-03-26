-- Availability tied to a specific match (match-first protocol).
-- One row per user per match; used when a match is in AWAITING_AVAILABILITY.

create table if not exists public.match_availability (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.match_candidates(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  availability_slots text[] default null,
  updated_at timestamptz default now(),
  pending_sms_ready_confirmation boolean default false,
  sms_ready_confirmed_at timestamptz default null,
  unique (user_id, match_id)
);

comment on table public.match_availability is
  'When a user is free for a specific match. Replaces weekly_availability for match-first scheduling.';
comment on column public.match_availability.availability_slots is
  'Slot ids e.g. mon_09_00, tue_14_30 (30-min from 9am–7pm). Window is computed per match; slot ids are day-of-week + time.';
comment on column public.match_availability.pending_sms_ready_confirmation is
  'True after app save with slots; cleared when user texts READY for this match.';
comment on column public.match_availability.sms_ready_confirmed_at is
  'Set when inbound READY confirmed for this match.';

alter table public.match_availability enable row level security;

-- Select: user can read their own rows (only when they are a participant in the match)
create policy "Users can select own match_availability"
  on public.match_availability for select to authenticated
  using (
    auth.uid() = user_id
    and exists (
      select 1 from public.match_candidates m
      where m.id = match_id and (m.user_a = auth.uid() or m.user_b = auth.uid())
    )
  );

create policy "Users can insert own match_availability"
  on public.match_availability for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.match_candidates m
      where m.id = match_id and (m.user_a = auth.uid() or m.user_b = auth.uid())
    )
  );

create policy "Users can update own match_availability"
  on public.match_availability for update to authenticated
  using (
    auth.uid() = user_id
    and exists (
      select 1 from public.match_candidates m
      where m.id = match_id and (m.user_a = auth.uid() or m.user_b = auth.uid())
    )
  )
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.match_candidates m
      where m.id = match_id and (m.user_a = auth.uid() or m.user_b = auth.uid())
    )
  );

create policy "Users can delete own match_availability"
  on public.match_availability for delete to authenticated
  using (
    auth.uid() = user_id
    and exists (
      select 1 from public.match_candidates m
      where m.id = match_id and (m.user_a = auth.uid() or m.user_b = auth.uid())
    )
  );

