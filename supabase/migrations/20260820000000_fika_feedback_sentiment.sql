-- Add sentiment classification column to fika_feedback.
-- Populated by GPT-4o-mini after user replies to "How was your Fika?" SMS.

alter table public.fika_feedback
  add column if not exists sentiment text
    check (sentiment in ('positive', 'neutral', 'negative'));

comment on column public.fika_feedback.sentiment is
  'GPT-classified sentiment of the feedback reply: positive, neutral, or negative.';
