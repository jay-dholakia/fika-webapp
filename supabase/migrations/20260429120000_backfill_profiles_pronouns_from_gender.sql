-- One-time backfill: profiles with blank pronouns but legacy gender set.
-- Capitalization matches app onboarding / merge-sms-signup (She/her, He/him, They/them).
-- Non-binary uses they/them, consistent with lib/match/fika-matcher inferredPronounsFromGender.

update public.profiles
set
  pronouns = 'She/her',
  updated_at = now()
where (pronouns is null or btrim(pronouns) = '')
  and gender is not null
  and lower(btrim(gender)) in ('female', 'woman', 'women');

update public.profiles
set
  pronouns = 'He/him',
  updated_at = now()
where (pronouns is null or btrim(pronouns) = '')
  and gender is not null
  and lower(btrim(gender)) in ('male', 'man', 'men');

update public.profiles
set
  pronouns = 'They/them',
  updated_at = now()
where (pronouns is null or btrim(pronouns) = '')
  and gender is not null
  and lower(btrim(gender)) in ('non-binary', 'nonbinary');
