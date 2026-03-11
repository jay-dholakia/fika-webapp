-- Ensure Orange County market exists (slug from lib/markets.ts).
insert into public.markets (slug, label, active)
values ('orange-county', 'Orange County', false)
on conflict (slug) do update set label = 'Orange County', updated_at = now();
