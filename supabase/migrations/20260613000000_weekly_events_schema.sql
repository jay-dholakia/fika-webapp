-- Flexible event dates: replace week_ymd + slot_id with a real timestamp
alter table weekly_fika_events
  add column if not exists event_starts_at      timestamptz null,
  add column if not exists reveals_sent_at      timestamptz null,
  add column if not exists max_invites          integer     null,
  add column if not exists max_capacity         integer     null,
  add column if not exists opt_in_deadline_hours integer not null default 24;

-- Allow multiple events per market on the same day (sub-areas)
alter table weekly_fika_events
  drop constraint if exists weekly_fika_events_market_slug_week_ymd_key;

-- Tie each RSVP to a specific event
alter table weekly_rsvps
  add column if not exists event_id uuid references weekly_fika_events(id);

-- Rekey: one RSVP per user per event (not per week)
alter table weekly_rsvps
  drop constraint if exists weekly_rsvps_user_id_week_ymd_key;

alter table weekly_rsvps
  add constraint weekly_rsvps_user_id_event_id_key
  unique (user_id, event_id);

-- Add 'cancelled' as valid decision
alter table weekly_rsvps
  drop constraint if exists weekly_rsvps_decision_check;
alter table weekly_rsvps
  add constraint weekly_rsvps_decision_check
  check (decision in ('yes', 'no', 'no_response', 'cancelled'));
