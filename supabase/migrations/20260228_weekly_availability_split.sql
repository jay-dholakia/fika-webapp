-- Split availability into its own table. Opt-ins = who's in the run; availability = when they're free.

-- 1. Create weekly_availability (one row per user per batch_week)
create table if not exists public.weekly_availability (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  batch_week date not null,
  availability_slots text[] default null,
  updated_at timestamptz default now(),
  unique (user_id, batch_week)
);

comment on table public.weekly_availability is
  'When a user is free for the week (batch_week). Used for matching; independent of opt-in.';
comment on column public.weekly_availability.batch_week is
  'Monday of the week this availability applies to (same as run week).';
comment on column public.weekly_availability.availability_slots is
  'Slot ids e.g. mon_09_00, tue_14_30 (30-min from 9am–7pm).';

alter table public.weekly_availability enable row level security;

create policy "Users can select own weekly_availability"
  on public.weekly_availability for select to authenticated
  using (auth.uid() = user_id);

create policy "Users can insert own weekly_availability"
  on public.weekly_availability for insert to authenticated
  with check (auth.uid() = user_id);

create policy "Users can update own weekly_availability"
  on public.weekly_availability for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own weekly_availability"
  on public.weekly_availability for delete to authenticated
  using (auth.uid() = user_id);

-- 2. Migrate existing availability_slots from weekly_match_opt_ins into weekly_availability
insert into public.weekly_availability (user_id, batch_week, availability_slots)
  select user_id, batch_week, availability_slots
  from public.weekly_match_opt_ins
  where availability_slots is not null
    and array_length(availability_slots, 1) > 0
on conflict (user_id, batch_week) do update set
  availability_slots = excluded.availability_slots,
  updated_at = now();

-- 3. Remove availability-only rows from opt_ins (they have no opted_in_at; data is now in weekly_availability)
delete from public.weekly_match_opt_ins
where opted_in_at is null;

-- 4. Drop availability_slots from weekly_match_opt_ins and make opted_in_at NOT NULL again
alter table public.weekly_match_opt_ins
  drop column if exists availability_slots;

alter table public.weekly_match_opt_ins
  alter column opted_in_at set not null;

comment on column public.weekly_match_opt_ins.opted_in_at is
  'When the user opted in for this week''s run. Row exists only when opted in.';
