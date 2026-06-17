-- Add pregame_sent_at to match_candidates to prevent double-sending the at-start questions SMS.
alter table match_candidates
  add column if not exists pregame_sent_at timestamptz;
