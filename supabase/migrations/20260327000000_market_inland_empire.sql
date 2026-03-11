-- Ensure Inland Empire market exists (slug from lib/markets.ts).
insert into public.markets (slug, label, active)
values ('ie', 'Inland Empire', false)
on conflict (slug) do update set label = 'Inland Empire', updated_at = now();
