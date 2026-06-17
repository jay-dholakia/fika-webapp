-- week_ymd is no longer the primary key for RSVPs (event_id is).
-- Make it nullable so the webhook can upsert RSVPs without deriving the Monday date.
alter table weekly_rsvps
  alter column week_ymd drop not null;
