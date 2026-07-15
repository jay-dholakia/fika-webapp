-- intake_question_config: DB-driven intake questionnaire questions.
-- Only INTAKE_STEPS are managed here; PROFILE_STEPS and confirm_intent stay hardcoded.

CREATE TABLE IF NOT EXISTS intake_question_config (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  question_id text NOT NULL UNIQUE,
  label text NOT NULL,
  body text,
  type text NOT NULL,
  options jsonb,
  required boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT true,
  display_order int NOT NULL DEFAULT 0,
  max_selections int,
  placeholder text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE intake_question_config ENABLE ROW LEVEL SECURITY;
-- No user-facing RLS policies; service_role bypasses RLS for admin use.

-- Seed with current INTAKE_STEPS (from lib/onboarding-data.ts)
INSERT INTO intake_question_config (question_id, label, body, type, options, required, enabled, display_order, max_selections, placeholder) VALUES
(
  'q_market_tenure',
  'How long have you lived in this area?',
  'Use the slider to pick what best describes your time here. Default is "Just moved" until you change it.',
  'slider_snap',
  '["Just moved","Less than 6 months","6 months – under 1 year","1–2 years","3–5 years","6–10 years","11–20 years","20+ years","I grew up here"]',
  true, true, 0, null, null
),
(
  'q_ethnicity',
  'What''s your ethnicity?',
  null,
  'select',
  '["American Indian or Alaska Native","Asian","Black or African American","Hispanic or Latino","Middle Eastern or North African","Native Hawaiian or Pacific Islander","White","Multiracial","Other","Prefer not to say"]',
  false, true, 1, null, null
),
(
  'q_relationship_status',
  'What''s your relationship status?',
  null,
  'select',
  '["Single","In a relationship","Married","Divorced","Widowed","It''s complicated","Prefer not to say"]',
  false, true, 2, null, null
),
(
  'q_work',
  'What do you do for work?',
  'Optional — be as specific or general as you like. If you''re between roles or on a break, feel free to say so.',
  'text',
  null,
  false, true, 3, null, 'e.g. Software Engineer at a Startup'
),
(
  'q_interests',
  'What are some of your interests?',
  'Select all that apply.',
  'multi_select',
  '["Reading","Music","Film & TV","Podcasts","Cooking","Travel","Fitness","Dance","Basketball","Football","Soccer","Baseball","Running","Hiking","Outdoors","Yoga / Pilates","Weightlifting","Cycling","Swimming","Tennis","Pickleball","Photography","Art & design","Writing","Gaming","Entrepreneurship & startups","Investing & finance","History","Science","Philosophy","Politics & current events"]',
  true, true, 4, null, null
),
(
  'q_like_talking_about',
  'What are some things you''d like to talk about?',
  'Choose up to 7 — we use this to suggest people you may click with.',
  'multi_select',
  '["Something fun I did recently","A hobby I just took up","A recent win (big or small)","Something I''m working on right now","Something that made me laugh lately","A show I''m currently watching","What I''ve been listening to lately (music/podcasts)","How my fave sports team is doing this season","Modern dating (the good, bad, ugly)","My social life these days","Something in the news I have thoughts on","Something trending online right now","What a meaningful life looks like to me","A recent trip I took or am taking","Local spots I''ve been loving lately (food, bars, activities)","Random theories & \"what if\" ideas","What my routine looks like lately (gym, habits, etc.)"]',
  true, true, 5, 7, null
);
