-- Seed markets table with all code-defined markets and current boundaries.
-- Boundary is stored as GeoJSON Polygon (lng/lat order).
-- If a market already has a boundary (e.g. edited in admin), we keep the existing boundary.

with seed(slug, label, boundary) as (
  values
    -- Markets with current bbox boundaries (seed as rectangles)
    ('la', 'Los Angeles', '{"type":"Polygon","coordinates":[[[-118.95,33.7],[-117.75,33.7],[-117.75,34.45],[-118.95,34.45],[-118.95,33.7]]]}'::jsonb),
    ('orange-county', 'Orange County', '{"type":"Polygon","coordinates":[[[-118.25,33.4],[-117.5,33.4],[-117.5,33.95],[-118.25,33.95],[-118.25,33.4]]]}'::jsonb),
    ('ie', 'Inland Empire', '{"type":"Polygon","coordinates":[[[-117.8,33.8],[-116.9,33.8],[-116.9,34.3],[-117.8,34.3],[-117.8,33.8]]]}'::jsonb),
    ('san-diego', 'San Diego', '{"type":"Polygon","coordinates":[[[-117.3,32.5],[-116.9,32.5],[-116.9,33.2],[-117.3,33.2],[-117.3,32.5]]]}'::jsonb),
    ('sf', 'San Francisco', '{"type":"Polygon","coordinates":[[[-122.6,37.2],[-121.5,37.2],[-121.5,38.0],[-122.6,38.0],[-122.6,37.2]]]}'::jsonb),
    ('nyc', 'New York City', '{"type":"Polygon","coordinates":[[[-74.3,40.5],[-73.7,40.5],[-73.7,40.95],[-74.3,40.95],[-74.3,40.5]]]}'::jsonb),
    ('chicago', 'Chicago', '{"type":"Polygon","coordinates":[[[-88.0,41.6],[-87.5,41.6],[-87.5,42.2],[-88.0,42.2],[-88.0,41.6]]]}'::jsonb),
    ('houston', 'Houston', '{"type":"Polygon","coordinates":[[[-95.8,29.5],[-95.0,29.5],[-95.0,30.2],[-95.8,30.2],[-95.8,29.5]]]}'::jsonb),
    ('phoenix', 'Phoenix', '{"type":"Polygon","coordinates":[[[-112.2,33.2],[-111.6,33.2],[-111.6,33.7],[-112.2,33.7],[-112.2,33.2]]]}'::jsonb),
    ('dallas', 'Dallas–Fort Worth', '{"type":"Polygon","coordinates":[[[-97.2,32.6],[-96.6,32.6],[-96.6,33.3],[-97.2,33.3],[-97.2,32.6]]]}'::jsonb),
    ('austin', 'Austin', '{"type":"Polygon","coordinates":[[[-97.95,30.1],[-97.5,30.1],[-97.5,30.6],[-97.95,30.6],[-97.95,30.1]]]}'::jsonb),
    ('seattle', 'Seattle', '{"type":"Polygon","coordinates":[[[-122.45,47.5],[-122.2,47.5],[-122.2,47.75],[-122.45,47.75],[-122.45,47.5]]]}'::jsonb),
    ('denver', 'Denver', '{"type":"Polygon","coordinates":[[[-105.2,39.6],[-104.6,39.6],[-104.6,40.0],[-105.2,40.0],[-105.2,39.6]]]}'::jsonb),
    ('boston', 'Boston', '{"type":"Polygon","coordinates":[[[-71.2,42.2],[-70.95,42.2],[-70.95,42.45],[-71.2,42.45],[-71.2,42.2]]]}'::jsonb),
    ('atlanta', 'Atlanta', '{"type":"Polygon","coordinates":[[[-84.5,33.6],[-84.2,33.6],[-84.2,34.0],[-84.5,34.0],[-84.5,33.6]]]}'::jsonb),
    ('miami', 'Miami', '{"type":"Polygon","coordinates":[[[-80.4,25.7],[-80.1,25.7],[-80.1,26.2],[-80.4,26.2],[-80.4,25.7]]]}'::jsonb),
    ('las-vegas', 'Las Vegas', '{"type":"Polygon","coordinates":[[[-115.4,35.9],[-114.9,35.9],[-114.9,36.4],[-115.4,36.4],[-115.4,35.9]]]}'::jsonb),

    -- Markets without a current boundary in code (boundary left NULL for now)
    ('philadelphia', 'Philadelphia', null::jsonb),
    ('san-antonio', 'San Antonio', null::jsonb),
    ('jacksonville', 'Jacksonville', null::jsonb),
    ('columbus', 'Columbus', null::jsonb),
    ('charlotte', 'Charlotte', null::jsonb),
    ('indianapolis', 'Indianapolis', null::jsonb),
    ('nashville', 'Nashville', null::jsonb),
    ('detroit', 'Detroit', null::jsonb),
    ('portland', 'Portland', null::jsonb),
    ('baltimore', 'Baltimore', null::jsonb),
    ('milwaukee', 'Milwaukee', null::jsonb),
    ('albuquerque', 'Albuquerque', null::jsonb),
    ('sacramento', 'Sacramento', null::jsonb),
    ('kansas-city', 'Kansas City', null::jsonb),
    ('raleigh', 'Raleigh–Durham', null::jsonb),
    ('minneapolis', 'Minneapolis–Saint Paul', null::jsonb),
    ('cleveland', 'Cleveland', null::jsonb),
    ('tampa', 'Tampa Bay', null::jsonb),
    ('st-louis', 'St. Louis', null::jsonb),
    ('pittsburgh', 'Pittsburgh', null::jsonb),
    ('cincinnati', 'Cincinnati', null::jsonb),
    ('orlando', 'Orlando', null::jsonb)
)
insert into public.markets (slug, label, active, boundary, created_at, updated_at)
select
  s.slug,
  s.label,
  false,
  s.boundary,
  now(),
  now()
from seed s
on conflict (slug) do update
set
  label = excluded.label,
  updated_at = now(),
  boundary = coalesce(public.markets.boundary, excluded.boundary);

