-- Feedback submissions from in-app bubble (user_id, notes, contact_ok).
create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  notes text not null,
  contact_ok boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.feedback enable row level security;

create policy "Users can insert own feedback"
  on public.feedback for insert
  to authenticated
  with check (auth.uid() = user_id);

-- Optional: allow users to read their own feedback (e.g. for a "My feedback" list later).
-- create policy "Users can select own feedback"
--   on public.feedback for select
--   to authenticated
--   using (auth.uid() = user_id);
