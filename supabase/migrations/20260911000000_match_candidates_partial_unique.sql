-- Replace the broad unique constraint on (user_a, user_b) with a partial unique
-- index that only enforces uniqueness for active matches. This allows re-introducing
-- the same pair after a previous match was cancelled or completed.

ALTER TABLE match_candidates
  DROP CONSTRAINT IF EXISTS matcha_match_candidates_user_a_user_b_key;

CREATE UNIQUE INDEX match_candidates_active_pair
  ON match_candidates (user_a, user_b)
  WHERE status = 'active';
