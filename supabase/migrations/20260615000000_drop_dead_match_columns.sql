-- Drop scheduling-era columns from match_candidates that are no longer written or read.
-- cancel_retry_flow, expires_at, fika_social_* columns are kept (still active).

ALTER TABLE match_candidates
  DROP COLUMN IF EXISTS overlapping_slot_ids,
  DROP COLUMN IF EXISTS default_slot_id,
  DROP COLUMN IF EXISTS counter_slot_id,
  DROP COLUMN IF EXISTS final_slot_id,
  DROP COLUMN IF EXISTS counter_proposed_by_user_id,
  DROP COLUMN IF EXISTS match_opt_in_deadline_at,
  DROP COLUMN IF EXISTS last_shown_to_a,
  DROP COLUMN IF EXISTS last_shown_to_b;
