-- Rename all SMS conversation states to flow-prefixed names for clean separation.
-- Social flow states (global rows, match_id IS NULL) get social_ prefix.
-- 1v1 flow states (per-match rows, match_id NOT NULL) get 1v1_ prefix.

-- Social flow
UPDATE sms_conversation_states SET state = 'social_invited'          WHERE state = 'event_invite_sent';
UPDATE sms_conversation_states SET state = 'social_rsvp_accepted'    WHERE state = 'rsvp_accepted';
UPDATE sms_conversation_states SET state = 'social_reveal_sent'      WHERE state = 'reveal_sent' AND match_id IS NULL;

-- 1v1 flow
UPDATE sms_conversation_states SET state = '1v1_offered'             WHERE state = 'match_offered';
UPDATE sms_conversation_states SET state = '1v1_accepted'            WHERE state = 'match_accepted';
UPDATE sms_conversation_states SET state = '1v1_awaiting_availability' WHERE state = 'awaiting_availability';
UPDATE sms_conversation_states SET state = '1v1_proposed'            WHERE state = 'schedule_proposed';
UPDATE sms_conversation_states SET state = '1v1_confirmed'           WHERE state = 'confirmed';
UPDATE sms_conversation_states SET state = '1v1_morning_reminder'    WHERE state = 'pre_event_sent';
UPDATE sms_conversation_states SET state = '1v1_reminder_sent'       WHERE state = 'reveal_sent' AND match_id IS NOT NULL;
