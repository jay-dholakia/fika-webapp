-- Tables not referenced by the Fika webapp (no .from() / RPC usage in app, APIs, or Edge in repo).
-- Order: reports references conversations; others are independent.
drop table if exists public.reports cascade;
drop table if exists public.blocks cascade;
drop table if exists public.intro_ledger cascade;
drop table if exists public.coach_invites cascade;
drop table if exists public.ai_chat_history cascade;
