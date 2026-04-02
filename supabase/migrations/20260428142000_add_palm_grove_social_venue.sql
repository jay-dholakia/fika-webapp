-- Palm Grove Social (café / coffee) — Mid-City LA. Coords from Google Maps place link.
insert into public.venues (name, neighborhood, city, address, lat, lng)
select
  'Palm Grove Social',
  'Mid-City',
  'Los Angeles',
  '1902 S Palm Grove Ave, Los Angeles, CA 90016',
  34.0396374::numeric,
  -118.341312::numeric
where not exists (
  select 1 from public.venues uv
  where uv.name = 'Palm Grove Social' and uv.city = 'Los Angeles'
);
