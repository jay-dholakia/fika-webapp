-- Remove the fika_socials event system entirely. All events now run through weekly_fika_events.

-- Drop fika_social_id and related tracking columns from match_candidates first (FK dependency)
ALTER TABLE match_candidates
  DROP COLUMN IF EXISTS fika_social_id,
  DROP COLUMN IF EXISTS fika_social_intro_sms_sent_at,
  DROP COLUMN IF EXISTS fika_social_user_a_confirmed_at,
  DROP COLUMN IF EXISTS fika_social_user_b_confirmed_at;

-- Drop opt-in and exclusion tables before the parent
DROP TABLE IF EXISTS fika_social_invite_exclusions;
DROP TABLE IF EXISTS fika_social_opt_ins;
DROP TABLE IF EXISTS fika_socials;
