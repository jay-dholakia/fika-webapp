-- One-time backfill: copy social_confirmed_at from sms_conversation_states.payload onto match_candidates
-- for Fika Social pairs (before rows were deleted by teardown or for historical sessions).

update public.match_candidates mc
set fika_social_user_a_confirmed_at = x.confirmed_at
from (
  select distinct on (s.match_id, s.user_id)
    s.match_id,
    s.user_id,
    (s.payload->>'social_confirmed_at')::timestamptz as confirmed_at
  from public.sms_conversation_states s
  inner join public.match_candidates mc2 on mc2.id = s.match_id and mc2.fika_social_id is not null
  where s.match_id is not null
    and s.payload->>'protocol_version' = 'social_v1'
    and coalesce(trim(s.payload->>'social_confirmed_at'), '') <> ''
    and (s.payload->>'social_confirmed_at') ~ '^\d{4}-\d{2}-\d{2}'
  order by s.match_id, s.user_id, s.updated_at desc nulls last
) x
where mc.id = x.match_id
  and mc.user_a = x.user_id
  and mc.fika_social_id is not null
  and mc.fika_social_user_a_confirmed_at is null;

update public.match_candidates mc
set fika_social_user_b_confirmed_at = x.confirmed_at
from (
  select distinct on (s.match_id, s.user_id)
    s.match_id,
    s.user_id,
    (s.payload->>'social_confirmed_at')::timestamptz as confirmed_at
  from public.sms_conversation_states s
  inner join public.match_candidates mc2 on mc2.id = s.match_id and mc2.fika_social_id is not null
  where s.match_id is not null
    and s.payload->>'protocol_version' = 'social_v1'
    and coalesce(trim(s.payload->>'social_confirmed_at'), '') <> ''
    and (s.payload->>'social_confirmed_at') ~ '^\d{4}-\d{2}-\d{2}'
  order by s.match_id, s.user_id, s.updated_at desc nulls last
) x
where mc.id = x.match_id
  and mc.user_b = x.user_id
  and mc.fika_social_id is not null
  and mc.fika_social_user_b_confirmed_at is null;
