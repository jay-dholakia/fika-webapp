-- Add neighborhood to profiles (stores the user's selected neighborhood chip)
alter table profiles add column if not exists neighborhood text;

-- Track when 1v1 photo reveals were sent (parallel to weekly_fika_events.reveals_sent_at)
alter table match_candidates add column if not exists reveals_sent_at timestamptz null;

-- Register new intake/profile questions in config table
insert into intake_question_config (question_id, question, body, display_order)
values
  ('q_neighborhood',
   'Which neighborhood are you in?',
   'Type to search.',
   0),
  ('q_current_interest',
   'What''s something you''re genuinely into right now?',
   'A project, obsession, phase — whatever it is.',
   7),
  ('q_friend_description',
   'How would a close friend describe you?',
   'One sentence, in their words.',
   8)
on conflict (question_id) do nothing;
