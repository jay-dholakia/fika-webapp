-- Retire week_anchor_monday: the old slot-based 1:1 match system is replaced by event-based matching.
-- Also drop confirmed_slot_id, confirmed_venue_id, confirmed_at, scheduling_status from match_candidates.

-- ── sms_conversation_states ──────────────────────────────────────────────────

-- Drop partial unique indexes that include week_anchor_monday
DROP INDEX IF EXISTS sms_conversation_states_global_unique;
DROP INDEX IF EXISTS sms_conversation_states_match_unique;
DROP INDEX IF EXISTS sms_conversation_states_week_anchor_monday;

ALTER TABLE sms_conversation_states DROP COLUMN IF EXISTS week_anchor_monday;

-- Deduplicate: keep only the most recent global state row per user
DELETE FROM sms_conversation_states a
USING sms_conversation_states b
WHERE a.match_id IS NULL
  AND b.match_id IS NULL
  AND a.user_id = b.user_id
  AND a.updated_at < b.updated_at;

-- For any remaining ties (same updated_at), keep the row with the larger id
DELETE FROM sms_conversation_states a
USING sms_conversation_states b
WHERE a.match_id IS NULL
  AND b.match_id IS NULL
  AND a.user_id = b.user_id
  AND a.updated_at = b.updated_at
  AND a.id < b.id;

-- New: one global state per user (no week anchor needed)
CREATE UNIQUE INDEX sms_conversation_states_global_unique
  ON sms_conversation_states (user_id)
  WHERE match_id IS NULL;

-- One per-match state per user (for future event-based 1:1 matches)
CREATE UNIQUE INDEX sms_conversation_states_match_unique
  ON sms_conversation_states (user_id, match_id)
  WHERE match_id IS NOT NULL;

-- ── upsert_global_sms_conversation_state RPC ─────────────────────────────────

DROP FUNCTION IF EXISTS public.upsert_global_sms_conversation_state(uuid, date, text, jsonb, text);

CREATE OR REPLACE FUNCTION public.upsert_global_sms_conversation_state(
  p_user_id uuid,
  p_state text,
  p_payload jsonb DEFAULT '{}',
  p_last_sendblue_message_handle text DEFAULT null
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.sms_conversation_states (
    user_id,
    match_id,
    state,
    payload,
    last_sendblue_message_handle,
    updated_at
  )
  VALUES (
    p_user_id,
    null,
    p_state,
    COALESCE(p_payload, '{}'),
    p_last_sendblue_message_handle,
    now()
  )
  ON CONFLICT (user_id) WHERE match_id IS NULL
  DO UPDATE SET
    state = EXCLUDED.state,
    payload = EXCLUDED.payload,
    last_sendblue_message_handle = COALESCE(EXCLUDED.last_sendblue_message_handle, sms_conversation_states.last_sendblue_message_handle),
    updated_at = now();
END;
$$;

COMMENT ON FUNCTION public.upsert_global_sms_conversation_state IS
  'Upsert one global sms_conversation_states row (match_id null). No longer keyed by week_anchor_monday.';

GRANT EXECUTE ON FUNCTION public.upsert_global_sms_conversation_state(uuid, text, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.upsert_global_sms_conversation_state(uuid, text, jsonb, text) TO authenticated;

-- ── fika_socials ─────────────────────────────────────────────────────────────

ALTER TABLE fika_socials DROP COLUMN IF EXISTS week_anchor_monday;

-- ── fika_social_opt_ins ───────────────────────────────────────────────────────

ALTER TABLE fika_social_opt_ins DROP COLUMN IF EXISTS week_anchor_monday;

-- ── match_candidates ─────────────────────────────────────────────────────────

-- Drop trigger that fires on confirmed_at / scheduling_status before dropping those columns
DROP TRIGGER IF EXISTS set_cooldown_on_confirmed_match_trigger ON match_candidates;
DROP FUNCTION IF EXISTS public.set_cooldown_on_confirmed_match();

ALTER TABLE match_candidates DROP COLUMN IF EXISTS week_anchor_monday;
ALTER TABLE match_candidates DROP COLUMN IF EXISTS confirmed_slot_id;
ALTER TABLE match_candidates DROP COLUMN IF EXISTS confirmed_venue_id;
ALTER TABLE match_candidates DROP COLUMN IF EXISTS confirmed_at;
ALTER TABLE match_candidates DROP COLUMN IF EXISTS scheduling_status;

-- ── message_ledger ────────────────────────────────────────────────────────────

ALTER TABLE message_ledger DROP COLUMN IF EXISTS week_anchor_monday;
