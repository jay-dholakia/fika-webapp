-- Optional GeoJSON Polygon per market for zone boundary. When set, used for point-in-polygon
-- market resolution and admin map; editable on admin map.
alter table public.markets
  add column if not exists boundary jsonb;

comment on column public.markets.boundary is 'GeoJSON Polygon: { "type": "Polygon", "coordinates": [ [ [lng, lat], ... ] ] }. Optional; when set overrides code bbox for resolution and map.';
