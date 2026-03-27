-- Cancel + optional mutual "retry intro later" (no rescheduling). State in JSONB.
alter table public.match_candidates
  add column if not exists cancel_retry_flow jsonb;

comment on column public.match_candidates.cancel_retry_flow is
  'Cancel/retry flow: phase, initiator_user_id, user_a_retry, user_b_retry, started_at, nudge_after_at, deadline_at, nudge_sent_at, snapshot, resolution. scheduling_status cancelled_pending_retry while collecting YES/NO.';
