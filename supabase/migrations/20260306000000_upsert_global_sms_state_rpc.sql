-- PostgREST cannot use partial unique indexes for upsert (error 42P10).
-- Provide an RPC that does INSERT ... ON CONFLICT on the partial index for global state.

create or replace function public.upsert_global_sms_conversation_state(
  p_user_id uuid,
  p_batch_week date,
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
    batch_week,
    match_id,
    state,
    payload,
    last_sendblue_message_handle,
    updated_at
  )
  values (
    p_user_id,
    p_batch_week,
    null,
    p_state,
    coalesce(p_payload, '{}'),
    p_last_sendblue_message_handle,
    now()
  )
  on conflict (user_id, batch_week) where match_id is null
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
