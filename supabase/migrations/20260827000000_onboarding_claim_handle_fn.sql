-- Atomic message-handle claim for onboarding deduplication.
-- Returns true if the handle was newly claimed, false if it was already set (duplicate).
CREATE OR REPLACE FUNCTION try_claim_onboarding_handle(p_phone text, p_handle text)
RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  UPDATE onboarding_sessions
  SET payload    = payload || jsonb_build_object('last_message_handle', p_handle),
      updated_at = now()
  WHERE phone               = p_phone
    AND merged_into_user_id IS NULL
    AND (payload->>'last_message_handle' IS NULL
         OR payload->>'last_message_handle' != p_handle);
  RETURN FOUND;
END;
$$;
