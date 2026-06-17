-- match_availability: old slot-picker table from pre-event scheduling, no code references
DROP TABLE IF EXISTS public.match_availability CASCADE;

-- sms_signup_states: created but never used in any route or lib
DROP TABLE IF EXISTS public.sms_signup_states CASCADE;

-- fika_feedback: separate from the live feedback table, no code references
DROP TABLE IF EXISTS public.fika_feedback CASCADE;
