-- in_match_bowl was never set by any app code and is no longer used as a filter.
-- Eligibility for weekly events is now determined by is_active + phone + sms_opted_out_at.
alter table profiles drop column if exists in_match_bowl;
