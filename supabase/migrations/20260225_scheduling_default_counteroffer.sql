-- Scheduling: "Default + One Counteroffer Round"
-- Add columns to match_candidates and opt_ins; allow participants to update scheduling state.

-- match_candidates: scheduling columns (nullable for existing rows)
alter table public.match_candidates
  add column if not exists overlapping_slot_ids text[] default '{}',
  add column if not exists default_slot_id text,
  add column if not exists counter_slot_id text,
  add column if not exists final_slot_id text,
  add column if not exists counter_proposed_by_user_id uuid references auth.users(id),
  add column if not exists confirmed_slot_id text,
  add column if not exists scheduling_status text;

comment on column public.match_candidates.overlapping_slot_ids is
  'All overlapping 30-min slot IDs at match creation (e.g. mon_09_00, tue_14_30).';
comment on column public.match_candidates.default_slot_id is
  'Best-ranked slot proposed first (proposed_default).';
comment on column public.match_candidates.counter_slot_id is
  'Slot chosen by first user who clicked "Change time" (counter_proposed).';
comment on column public.match_candidates.final_slot_id is
  'Slot chosen by other user who clicked "Choose another time" (final_proposed).';
comment on column public.match_candidates.counter_proposed_by_user_id is
  'User who first requested a different time (the requester in final round).';
comment on column public.match_candidates.confirmed_slot_id is
  'Slot once both have confirmed (scheduling_status = confirmed).';
comment on column public.match_candidates.scheduling_status is
  'proposed_default | counter_proposed | final_proposed | confirmed | expired. Null = legacy (opt-in only).';

-- opt_ins: record which slot the user confirmed (when they click Confirm on default)
alter table public.opt_ins
  add column if not exists confirmed_slot_id text;

comment on column public.opt_ins.confirmed_slot_id is
  'Slot this user confirmed (e.g. default_slot_id when they click Confirm on the default).';

-- RLS: allow participants to update match_candidates (scheduling columns only in practice)
-- If no update policy exists, create one; if table used service_role only, this enables user-driven scheduling.
do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'match_candidates' and policyname = 'Users can update own match_candidates for scheduling'
  ) then
    create policy "Users can update own match_candidates for scheduling"
      on public.match_candidates for update
      using (auth.uid() = user_a or auth.uid() = user_b)
      with check (auth.uid() = user_a or auth.uid() = user_b);
  end if;
end $$;

-- Allow participants to create a conversation when match is confirmed (for scheduling flow)
do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'conversations' and policyname = 'Users can insert conversation when match participant'
  ) then
    create policy "Users can insert conversation when match participant"
      on public.conversations for insert
      with check (
        (auth.uid() = user_a or auth.uid() = user_b)
        and conversation_type = 'match'
        and match_id is not null
      );
  end if;
end $$;
