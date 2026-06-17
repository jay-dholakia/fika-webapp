-- opt_ins was the old SMS opt-in gate ("Want to see your intro?"). Replaced by event RSVPs.
-- No code writes to this table in the event-based flow.
DROP TABLE IF EXISTS public.opt_ins CASCADE;
