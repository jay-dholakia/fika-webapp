alter table weekly_fika_events
  add column if not exists radius_miles  numeric  null,
  add column if not exists gender_filter text[]   null,
  add column if not exists min_age       integer  null,
  add column if not exists max_age       integer  null;
