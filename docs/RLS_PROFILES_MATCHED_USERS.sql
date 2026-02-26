-- Run this in the meetwithmoai Supabase project (Dashboard → SQL Editor)
-- so the Fika app intro modal can read a matched user's profile (bio, pronouns, etc.).

-- Enable RLS on profiles if not already enabled (no-op if already on).
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to SELECT another user's profile row
-- only when the two users share an active match_candidates row.
-- Keep any existing policy for "SELECT own profile" (id = auth.uid()).

CREATE POLICY "allow_read_matched_user_profile"
ON profiles
FOR SELECT
TO authenticated
USING (
  id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM match_candidates mc
    WHERE (
      (mc.user_a = auth.uid() AND mc.user_b = profiles.id)
      OR (mc.user_b = auth.uid() AND mc.user_a = profiles.id)
    )
    AND mc.status = 'active'
  )
);

-- If you already have a separate "SELECT own row" policy, you can drop it
-- and rely on this combined policy, or keep both (this one adds matched-user read).
