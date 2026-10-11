-- Add unique index so upsert(onConflict:'user_id,match_id') works in sms-match-delivery.
-- Partial: only enforces uniqueness when match_id IS NOT NULL (per-match state rows).
-- Global state rows (match_id IS NULL) are handled by a separate partial index below.

CREATE UNIQUE INDEX IF NOT EXISTS sms_conversation_states_user_match_unique
  ON sms_conversation_states (user_id, match_id)
  WHERE match_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS sms_conversation_states_user_global_unique
  ON sms_conversation_states (user_id)
  WHERE match_id IS NULL;
