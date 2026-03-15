-- Message ledger: append-only log of inbound and outbound SMS per user/phone.
-- Use for audit, support, and "messages sent to every account" views.

create table if not exists public.message_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid null references auth.users(id) on delete set null,
  direction text not null check (direction in ('inbound', 'outbound')),
  peer_phone text not null,
  content_snippet text not null,
  context text null,
  message_handle text null,
  batch_week text null,
  match_id uuid null,
  created_at timestamptz not null default now()
);

comment on table public.message_ledger is 'Append-only log of every inbound and outbound SMS; keyed by user_id and peer_phone for ledger views.';
create index if not exists message_ledger_user_id_created_at on public.message_ledger (user_id, created_at desc);
create index if not exists message_ledger_peer_phone_created_at on public.message_ledger (peer_phone, created_at desc);

-- RLS: only service role (server) can read/write; anon/authenticated cannot access
alter table public.message_ledger enable row level security;
-- No policies = no access for anon/authenticated. Service role bypasses RLS.
