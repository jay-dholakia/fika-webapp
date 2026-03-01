-- Add Doodle-style availability for the week after batch_week (optional).
alter table public.weekly_match_opt_ins
  add column if not exists availability_slots text[] default null;

comment on column public.weekly_match_opt_ins.availability_slots is
  'Slot ids for next week, e.g. mon_09_12, tue_14_18 (day_timeblock).';

-- Allow users to update their own row (e.g. to save availability_slots).
create policy "Users can update own weekly_match_opt_ins"
  on public.weekly_match_opt_ins for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
