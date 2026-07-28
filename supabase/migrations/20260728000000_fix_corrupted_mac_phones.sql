-- Fix records corrupted by the Mac iMessage / Apple ID bug.
-- When from_number was an Apple ID email, normalizeIncomingPhone mangled it to "+".
-- This nulls out the garbage "+" values so they don't pollute profiles or block new signups.

-- Unmerged onboarding sessions with mangled phone can't be used — null them out
UPDATE onboarding_sessions SET phone = NULL WHERE phone = '+' AND merged_into_user_id IS NULL;

-- Profiles where phone was written as "+" can't receive SMS — null them out
UPDATE profiles SET phone = NULL WHERE phone = '+';
