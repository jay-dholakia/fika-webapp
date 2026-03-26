-- Rename batch_week → week_anchor_monday (Monday YYYY-MM-DD): week anchor for slot resolution and SMS partitioning.

drop function if exists public.upsert_global_sms_conversation_state(uuid, date, text, jsonb, text);

alter table public.sms_conversation_states rename column batch_week to week_anchor_monday;
alter table public.weekly_availability rename column batch_week to week_anchor_monday;
alter table public.weekly_match_opt_ins rename column batch_week to week_anchor_monday;
alter table public.message_ledger rename column batch_week to week_anchor_monday;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'match_candidates' and column_name = 'batch_week'
  ) then
    alter table public.match_candidates rename column batch_week to week_anchor_monday;
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'i' and c.relname = 'sms_conversation_states_batch_week'
  ) then
    execute 'alter index public.sms_conversation_states_batch_week rename to sms_conversation_states_week_anchor_monday';
  end if;
end $$;

create or replace function public.upsert_global_sms_conversation_state(
  p_user_id uuid,
  p_week_anchor_monday date,
  p_state text,
  p_payload jsonb default '{}',
  p_last_sendblue_message_handle text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.sms_conversation_states (
    user_id,
    week_anchor_monday,
    match_id,
    state,
    payload,
    last_sendblue_message_handle,
    updated_at
  )
  values (
    p_user_id,
    p_week_anchor_monday,
    null,
    p_state,
    coalesce(p_payload, '{}'),
    p_last_sendblue_message_handle,
    now()
  )
  on conflict (user_id, week_anchor_monday) where match_id is null
  do update set
    state = excluded.state,
    payload = excluded.payload,
    last_sendblue_message_handle = coalesce(excluded.last_sendblue_message_handle, sms_conversation_states.last_sendblue_message_handle),
    updated_at = now();
end;
$$;

comment on function public.upsert_global_sms_conversation_state is 'Upsert one global sms_conversation_states row (match_id null). Use from app/edge when PostgREST upsert fails due to partial unique index.';

grant execute on function public.upsert_global_sms_conversation_state(uuid, date, text, jsonb, text) to service_role;
grant execute on function public.upsert_global_sms_conversation_state(uuid, date, text, jsonb, text) to authenticated;
