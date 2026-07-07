-- ============================================================================
-- Per-hall battle radius: 10-mile radius (20-mi diameter) by default,
-- 5-mile radius (10-mi diameter) for dense metro clusters where halls are
-- packed close together.
-- ============================================================================

ALTER TABLE gyms ADD COLUMN IF NOT EXISTS radius_miles NUMERIC DEFAULT 10;
UPDATE gyms SET radius_miles = 10 WHERE radius_miles IS NULL;

-- Dense metros → 5-mile radius
UPDATE gyms SET radius_miles = 5
WHERE
  (state = 'NY' AND city_name IN (
    'Manhattan', 'Brooklyn', 'Queens', 'The Bronx', 'Staten Island'
  ))
  OR (state = 'NJ' AND city_name IN (
    'Newark', 'Jersey City', 'Paterson', 'Elizabeth', 'Edison'
  ))
  OR (state = 'CA' AND city_name IN (
    -- LA metro
    'Los Angeles', 'Long Beach', 'Anaheim', 'Santa Ana', 'Irvine',
    'Santa Clarita', 'Huntington Beach', 'Glendale', 'Pomona', 'Torrance',
    'Pasadena', 'Downey', 'El Monte', 'Inglewood', 'Burbank', 'Compton',
    'Santa Monica',
    -- SF Bay Area
    'San Francisco', 'San Jose', 'Oakland', 'Fremont', 'Hayward',
    'Sunnyvale', 'Santa Clara', 'Vallejo', 'Concord', 'Berkeley',
    'Richmond', 'San Mateo', 'Daly City', 'Palo Alto'
  ));
