-- Ensure only one global state row per (user_id, batch_week) when match_id is null.
-- PostgreSQL unique (user_id, batch_week, match_id) allows multiple rows with match_id NULL,
-- so we dedupe, add a partial unique index, and then the webhook can INSERT and only send when insert succeeds (no conflict).

-- 1. Dedupe: keep one row per (user_id, batch_week) where match_id is null (keep by smallest id)
delete from public.sms_conversation_states a
using public.sms_conversation_states b
where a.user_id = b.user_id
  and a.batch_week = b.batch_week
  and a.match_id is null
  and b.match_id is null
  and a.id > b.id;

-- 2. Drop the constraint that allows duplicate nulls; add partial unique indexes so only one global row per (user_id, batch_week)
alter table public.sms_conversation_states
  drop constraint if exists sms_conversation_states_user_id_batch_week_match_id_key;

create unique index if not exists sms_conversation_states_global_unique
  on public.sms_conversation_states (user_id, batch_week)
  where match_id is null;

create unique index if not exists sms_conversation_states_match_unique
  on public.sms_conversation_states (user_id, batch_week, match_id)
  where match_id is not null;
