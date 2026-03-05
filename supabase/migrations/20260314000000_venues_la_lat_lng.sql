-- Greater LA area coffee shops with seating: add/update with address and lat/lng for midpoint-based venue selection.
-- Coordinates from Google Maps / Places (approximate). All have indoor and/or outdoor seating.

-- Ensure lat/lng columns exist (they do in 20260302000000_sms_agent; this is defensive)
alter table public.venues
  add column if not exists lat numeric,
  add column if not exists lng numeric,
  add column if not exists address text;

comment on column public.venues.lat is 'Latitude for distance/midpoint selection.';
comment on column public.venues.lng is 'Longitude for distance/midpoint selection.';

-- Update existing seeds with address + lat/lng where missing
update public.venues set
  address = '1936 Hillhurst Ave, Los Angeles, CA 90027',
  lat = 34.1058,
  lng = -118.2874
where name = 'Maru Coffee' and city = 'Los Angeles' and lat is null;
update public.venues set
  address = '4634 Hollywood Blvd, Los Angeles, CA 90027',
  lat = 34.1050,
  lng = -118.2920
where name = 'Café Los Feliz' and city = 'Los Angeles' and lat is null;
update public.venues set
  address = '3827 W Sunset Blvd, Los Angeles, CA 90026',
  lat = 34.0835,
  lng = -118.2762
where name = 'Alfred Coffee' and city = 'Los Angeles' and lat is null;

-- Insert additional greater LA coffee shops (coffee shops with seating; coordinates from public maps)
insert into public.venues (name, neighborhood, city, address, lat, lng)
select v.name, v.neighborhood, v.city, v.address, v.lat, v.lng from (values
  ('Intelligentsia Coffee', 'Silver Lake', 'Los Angeles', '3922 W Sunset Blvd, Los Angeles, CA 90029', 34.091989::numeric, -118.280289::numeric),
  ('Intelligentsia Coffee', 'Hollywood', 'Los Angeles', '6401 Hollywood Blvd, Los Angeles, CA 90028', 34.1016::numeric, -118.3267::numeric),
  ('Eightfold Coffee', 'Echo Park', 'Los Angeles', '1294 W Sunset Blvd, Los Angeles, CA 90026', 34.071194::numeric, -118.250739::numeric),
  ('Groundwork Coffee', 'Venice', 'Los Angeles', '671 Rose Ave, Venice, CA 90291', 33.9850::numeric, -118.4695::numeric),
  ('Groundwork Coffee', 'Arts District', 'Los Angeles', '811 Traction Ave, Los Angeles, CA 90013', 34.0440::numeric, -118.2380::numeric),
  ('Groundwork Coffee', 'Larchmont', 'Los Angeles', '150 N Larchmont Blvd, Los Angeles, CA 90004', 34.0720::numeric, -118.3230::numeric),
  ('Groundwork Coffee', 'North Hollywood', 'Los Angeles', '11275 Chandler Blvd, North Hollywood, CA 91601', 34.1860::numeric, -118.3810::numeric),
  ('La Colombe Coffee', 'Beverly Hills', 'Beverly Hills', '9606 S Santa Monica Blvd, Beverly Hills, CA 90210', 34.0670::numeric, -118.4060::numeric),
  ('La Colombe Coffee', 'Silver Lake', 'Los Angeles', '3900 W Sunset Blvd, Los Angeles, CA 90029', 34.0915::numeric, -118.2795::numeric),
  ('LAMILL Coffee', 'Silver Lake', 'Los Angeles', '1636 Silver Lake Blvd, Los Angeles, CA 90026', 34.0785::numeric, -118.2650::numeric),
  ('Verve Coffee Roasters', 'Downtown', 'Los Angeles', '500 S Spring St, Los Angeles, CA 90013', 34.0450::numeric, -118.2485::numeric),
  ('Blue Bottle Coffee', 'Arts District', 'Los Angeles', '582 Mateo St, Los Angeles, CA 90013', 34.0405::numeric, -118.2340::numeric),
  ('Copa Vida', 'Pasadena', 'Pasadena', '70 S Raymond Ave, Pasadena, CA 91105', 34.1445::numeric, -118.1492::numeric),
  ('Jameson Brown Coffee Roasters', 'Pasadena', 'Pasadena', '260 N Allen Ave, Pasadena, CA 91106', 34.1520::numeric, -118.1265::numeric),
  ('Philz Coffee', 'Santa Monica', 'Santa Monica', '525 Santa Monica Blvd, Santa Monica, CA 90401', 34.0195::numeric, -118.4912::numeric),
  ('Café Luxxe', 'Santa Monica', 'Santa Monica', '925 Montana Ave, Santa Monica, CA 90403', 34.0280::numeric, -118.4960::numeric),
  ('Menotti''s Coffee Stop', 'Venice', 'Los Angeles', '56 Windward Ave, Venice, CA 90291', 33.9855::numeric, -118.4730::numeric),
  ('G&B Coffee', 'Downtown', 'Los Angeles', '324 S Hill St, Los Angeles, CA 90013', 34.0505::numeric, -118.2510::numeric),
  ('Maru Coffee', 'Arts District', 'Los Angeles', '1019 S Santa Fe Ave, Los Angeles, CA 90021', 34.0325::numeric, -118.2330::numeric),
  -- More greater LA (batch 2)
  ('Alfred Coffee', 'West Hollywood', 'West Hollywood', '8428 Melrose Ave, West Hollywood, CA 90069', 34.0838::numeric, -118.3710::numeric),
  ('Alfred Coffee', 'Brentwood', 'Los Angeles', '11948 San Vicente Blvd, Los Angeles, CA 90049', 34.0515::numeric, -118.4720::numeric),
  ('Café Gratitude', 'Venice', 'Los Angeles', '512 Rose Ave, Venice, CA 90291', 33.9870::numeric, -118.4680::numeric),
  ('Copa Vida', 'Downtown', 'Los Angeles', '624 S Spring St, Los Angeles, CA 90014', 34.0445::numeric, -118.2510::numeric),
  ('Republique', 'Mid-Wilshire', 'Los Angeles', '624 S La Brea Ave, Los Angeles, CA 90036', 34.0625::numeric, -118.3445::numeric),
  ('Go Get Em Tiger', 'Larchmont', 'Los Angeles', '230 N Larchmont Blvd, Los Angeles, CA 90004', 34.0745::numeric, -118.3235::numeric),
  ('Go Get Em Tiger', 'Silver Lake', 'Los Angeles', '3200 Sunset Blvd, Los Angeles, CA 90026', 34.0780::numeric, -118.2730::numeric),
  ('Document Coffee Bar', 'Koreatown', 'Los Angeles', '3850 Wilshire Blvd, Los Angeles, CA 90010', 34.0618::numeric, -118.3055::numeric),
  ('Balconi Coffee Company', 'Sawtelle', 'Los Angeles', '11301 W Olympic Blvd, Los Angeles, CA 90064', 34.0310::numeric, -118.4410::numeric),
  ('Copa Vida', 'South Pasadena', 'South Pasadena', '1006 Mission St, South Pasadena, CA 91030', 34.1155::numeric, -118.1510::numeric),
  ('Zinc Cafe', 'Downtown', 'Los Angeles', '580 Mateo St, Los Angeles, CA 90013', 34.0400::numeric, -118.2335::numeric),
  ('Urth Caffé', 'Santa Monica', 'Santa Monica', '2327 Main St, Santa Monica, CA 90405', 34.0155::numeric, -118.4915::numeric),
  ('Urth Caffé', 'Beverly Hills', 'Beverly Hills', '267 S Beverly Dr, Beverly Hills, CA 90212', 34.0675::numeric, -118.4005::numeric),
  ('Urth Caffé', 'Downtown', 'Los Angeles', '451 S Hewitt St, Los Angeles, CA 90013', 34.0435::numeric, -118.2395::numeric),
  ('Café de Leche', 'Highland Park', 'Los Angeles', '5000 York Blvd, Los Angeles, CA 90042', 34.1205::numeric, -118.2035::numeric),
  ('Kumquat Coffee', 'Highland Park', 'Los Angeles', '5144 Figueroa St, Los Angeles, CA 90042', 34.1170::numeric, -118.2020::numeric),
  ('Civil Coffee', 'Highland Park', 'Los Angeles', '5629 N Figueroa St, Los Angeles, CA 90042', 34.1095::numeric, -118.1925::numeric),
  ('Bourbon Room', 'Glendale', 'Glendale', '114 E Broadway, Glendale, CA 91205', 34.1425::numeric, -118.2550::numeric),
  ('Porto''s Bakery & Café', 'Glendale', 'Glendale', '315 N Brand Blvd, Glendale, CA 91203', 34.1510::numeric, -118.2555::numeric),
  ('Republic of Pie', 'North Hollywood', 'Los Angeles', '11118 Magnolia Blvd, North Hollywood, CA 91601', 34.1680::numeric, -118.3705::numeric),
  ('M Street Coffee', 'Sherman Oaks', 'Los Angeles', '13450 Ventura Blvd, Sherman Oaks, CA 91423', 34.1505::numeric, -118.4340::numeric),
  ('Café Tropical', 'Silver Lake', 'Los Angeles', '2900 Sunset Blvd, Los Angeles, CA 90026', 34.0795::numeric, -118.2765::numeric),
  ('Spoke Bicycle Café', 'Frogtown', 'Los Angeles', '3050 N Coolidge Ave, Los Angeles, CA 90039', 34.0910::numeric, -118.2585::numeric),
  ('Stories Books & Café', 'Echo Park', 'Los Angeles', '1716 W Sunset Blvd, Los Angeles, CA 90026', 34.0775::numeric, -118.2635::numeric),
  ('Cognoscenti Coffee', 'Culver City', 'Culver City', '6114 Washington Blvd, Culver City, CA 90232', 34.0305::numeric, -118.3845::numeric),
  ('Bar Nine', 'Culver City', 'Culver City', '3515 Helms Ave, Culver City, CA 90232', 34.0285::numeric, -118.3820::numeric),
  ('Copa Vida', 'Pasadena', 'Pasadena', '146 S Lake Ave, Pasadena, CA 91101', 34.1420::numeric, -118.1320::numeric),
  ('Jones Coffee Roasters', 'Pasadena', 'Pasadena', '693 S Raymond Ave, Pasadena, CA 91105', 34.1350::numeric, -118.1495::numeric),
  ('Rosebud Coffee', 'Pasadena', 'Pasadena', '36 E Colorado Blvd, Pasadena, CA 91105', 34.1455::numeric, -118.1490::numeric),
  ('Philz Coffee', 'Downtown', 'Los Angeles', '725 W 1st St, Los Angeles, CA 90012', 34.0545::numeric, -118.2520::numeric),
  ('The Boy & The Bear', 'South Pasadena', 'South Pasadena', '1026 Mission St, South Pasadena, CA 91030', 34.1158::numeric, -118.1512::numeric),
  ('Copa Vida', 'San Marino', 'San Marino', '2400 Huntington Dr, San Marino, CA 91108', 34.1220::numeric, -118.1125::numeric),
  ('Two Guns Espresso', 'Manhattan Beach', 'Manhattan Beach', '3500 N Sepulveda Blvd, Manhattan Beach, CA 90266', 33.8895::numeric, -118.3960::numeric),
  ('Copa Vida', 'Santa Monica', 'Santa Monica', '2901 Ocean Park Blvd, Santa Monica, CA 90405', 34.0220::numeric, -118.4780::numeric),
  ('Café Bolivar', 'Long Beach', 'Long Beach', '3650 E Broadway, Long Beach, CA 90803', 33.8095::numeric, -118.1610::numeric),
  ('Portola Coffee Lab', 'Long Beach', 'Long Beach', '3960 E Broadway, Long Beach, CA 90803', 33.8100::numeric, -118.1595::numeric),
  ('Lord Windsor Coffee', 'Long Beach', 'Long Beach', '110 2nd St, Long Beach, CA 90802', 33.7695::numeric, -118.1935::numeric),
  ('Kean Coffee', 'Newport Beach', 'Newport Beach', '4560 Campus Dr, Newport Beach, CA 92660', 33.6520::numeric, -117.8320::numeric),
  ('Alta Coffee Warehouse', 'Newport Beach', 'Newport Beach', '506 31st St, Newport Beach, CA 92663', 33.6185::numeric, -117.9295::numeric)
) as v(name, neighborhood, city, address, lat, lng)
where not exists (
  select 1 from public.venues uv
  where uv.name = v.name and uv.city = v.city
);
