-- Run this in the meetwithmoai Supabase project (Dashboard → SQL Editor)
-- so the Fika app can read a matched user's intake when viewing their intro modal.

-- Allow authenticated users to SELECT another user's intake_responses_v5 row
-- only when the two users share a match_candidates row (i.e. they are matched).
-- Existing policies for own-row SELECT/INSERT/UPDATE are unchanged.

CREATE POLICY "allow_read_matched_user_intake"
ON intake_responses_v5
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM match_candidates mc
    WHERE (
      (mc.user_a = auth.uid() AND mc.user_b = intake_responses_v5.user_id)
      OR (mc.user_b = auth.uid() AND mc.user_a = intake_responses_v5.user_id)
    )
    AND mc.status = 'active'
  )
);

-- If your existing RLS on intake_responses_v5 already has a policy that allows
-- "SELECT own row" (e.g. user_id = auth.uid()), keep it. This policy adds
-- read access for the *other* user's row when you share an active match.
