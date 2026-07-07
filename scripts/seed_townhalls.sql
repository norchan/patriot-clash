-- ============================================================================
-- Town Hall seeding: specific cities + NYC boroughs + LA metro + SF Bay Area
-- + top-5 most populated cities in every other state.
-- Skips any city_name+state that already exists, so it's safe to re-run.
-- ============================================================================

INSERT INTO gyms (city_name, county, state, population, latitude, longitude, defense_points)
SELECT v.city_name, v.county, v.state, v.population, v.latitude, v.longitude, v.defense_points
FROM (VALUES
  -- ── Requested specific cities ─────────────────────────────────────────────
  ('St. Cloud', 'Stearns', 'MN', 68881, 45.5579, -94.1632, 0),
  ('Duluth', 'St. Louis', 'MN', 86697, 46.7867, -92.1005, 0),
  ('Madison', 'Dane', 'WI', 269840, 43.0731, -89.4012, 0),
  ('Chicago', 'Cook', 'IL', 2746388, 41.8781, -87.6298, 0),
  ('Washington', 'District of Columbia', 'DC', 689545, 38.9072, -77.0369, 0),

  -- ── All five NYC boroughs ─────────────────────────────────────────────────
  ('Manhattan', 'New York', 'NY', 1694251, 40.7831, -73.9712, 0),
  ('Brooklyn', 'Kings', 'NY', 2736074, 40.6782, -73.9442, 0),
  ('Queens', 'Queens', 'NY', 2405464, 40.7282, -73.7949, 0),
  ('The Bronx', 'Bronx', 'NY', 1472654, 40.8448, -73.8648, 0),
  ('Staten Island', 'Richmond', 'NY', 495747, 40.5795, -74.1502, 0),

  -- ── Los Angeles metro ─────────────────────────────────────────────────────
  ('Los Angeles', 'Los Angeles', 'CA', 3898747, 34.0522, -118.2437, 0),
  ('Long Beach', 'Los Angeles', 'CA', 466742, 33.7701, -118.1937, 0),
  ('Anaheim', 'Orange', 'CA', 346824, 33.8366, -117.9143, 0),
  ('Santa Ana', 'Orange', 'CA', 310227, 33.7455, -117.8677, 0),
  ('Irvine', 'Orange', 'CA', 307670, 33.6846, -117.8265, 0),
  ('Santa Clarita', 'Los Angeles', 'CA', 228673, 34.3917, -118.5426, 0),
  ('Huntington Beach', 'Orange', 'CA', 198711, 33.6595, -117.9988, 0),
  ('Glendale', 'Los Angeles', 'CA', 196543, 34.1425, -118.2551, 0),
  ('Pomona', 'Los Angeles', 'CA', 151348, 34.0551, -117.7500, 0),
  ('Torrance', 'Los Angeles', 'CA', 147067, 33.8358, -118.3406, 0),
  ('Pasadena', 'Los Angeles', 'CA', 138699, 34.1478, -118.1445, 0),
  ('Downey', 'Los Angeles', 'CA', 114355, 33.9401, -118.1332, 0),
  ('El Monte', 'Los Angeles', 'CA', 109450, 34.0686, -118.0276, 0),
  ('Inglewood', 'Los Angeles', 'CA', 107762, 33.9617, -118.3531, 0),
  ('Burbank', 'Los Angeles', 'CA', 107337, 34.1808, -118.3090, 0),
  ('Compton', 'Los Angeles', 'CA', 95605, 33.8958, -118.2201, 0),
  ('Santa Monica', 'Los Angeles', 'CA', 93076, 34.0195, -118.4912, 0),

  -- ── San Francisco Bay Area ────────────────────────────────────────────────
  ('San Francisco', 'San Francisco', 'CA', 873965, 37.7749, -122.4194, 0),
  ('San Jose', 'Santa Clara', 'CA', 1013240, 37.3382, -121.8863, 0),
  ('Oakland', 'Alameda', 'CA', 440646, 37.8044, -122.2712, 0),
  ('Fremont', 'Alameda', 'CA', 230504, 37.5485, -121.9886, 0),
  ('Hayward', 'Alameda', 'CA', 162954, 37.6688, -122.0808, 0),
  ('Sunnyvale', 'Santa Clara', 'CA', 155805, 37.3688, -122.0363, 0),
  ('Santa Clara', 'Santa Clara', 'CA', 127647, 37.3541, -121.9552, 0),
  ('Vallejo', 'Solano', 'CA', 126090, 38.1041, -122.2566, 0),
  ('Concord', 'Contra Costa', 'CA', 125410, 37.9780, -122.0311, 0),
  ('Berkeley', 'Alameda', 'CA', 124321, 37.8715, -122.2730, 0),
  ('Richmond', 'Contra Costa', 'CA', 116448, 37.9358, -122.3477, 0),
  ('San Mateo', 'San Mateo', 'CA', 105661, 37.5630, -122.3255, 0),
  ('Daly City', 'San Mateo', 'CA', 104901, 37.6879, -122.4702, 0),
  ('Palo Alto', 'Santa Clara', 'CA', 68572, 37.4419, -122.1430, 0),

  -- ── Alabama ───────────────────────────────────────────────────────────────
  ('Huntsville', 'Madison', 'AL', 215006, 34.7304, -86.5861, 0),
  ('Birmingham', 'Jefferson', 'AL', 200733, 33.5186, -86.8104, 0),
  ('Montgomery', 'Montgomery', 'AL', 200603, 32.3792, -86.3077, 0),
  ('Mobile', 'Mobile', 'AL', 187041, 30.6954, -88.0399, 0),
  ('Tuscaloosa', 'Tuscaloosa', 'AL', 99600, 33.2098, -87.5692, 0),

  -- ── Alaska ────────────────────────────────────────────────────────────────
  ('Anchorage', 'Anchorage', 'AK', 291247, 61.2181, -149.9003, 0),
  ('Fairbanks', 'Fairbanks North Star', 'AK', 32515, 64.8378, -147.7164, 0),
  ('Juneau', 'Juneau', 'AK', 32255, 58.3019, -134.4197, 0),
  ('Wasilla', 'Matanuska-Susitna', 'AK', 9054, 61.5814, -149.4394, 0),
  ('Sitka', 'Sitka', 'AK', 8458, 57.0531, -135.3300, 0),

  -- ── Arizona ───────────────────────────────────────────────────────────────
  ('Phoenix', 'Maricopa', 'AZ', 1608139, 33.4484, -112.0740, 0),
  ('Tucson', 'Pima', 'AZ', 542629, 32.2226, -110.9747, 0),
  ('Mesa', 'Maricopa', 'AZ', 504258, 33.4152, -111.8315, 0),
  ('Chandler', 'Maricopa', 'AZ', 275987, 33.3062, -111.8413, 0),
  ('Scottsdale', 'Maricopa', 'AZ', 241361, 33.4942, -111.9261, 0),

  -- ── Arkansas ──────────────────────────────────────────────────────────────
  ('Little Rock', 'Pulaski', 'AR', 202591, 34.7465, -92.2896, 0),
  ('Fayetteville', 'Washington', 'AR', 93949, 36.0626, -94.1574, 0),
  ('Fort Smith', 'Sebastian', 'AR', 89142, 35.3859, -94.3985, 0),
  ('Springdale', 'Washington', 'AR', 84161, 36.1867, -94.1288, 0),
  ('Jonesboro', 'Craighead', 'AR', 78576, 35.8423, -90.7043, 0),

  -- ── Colorado ──────────────────────────────────────────────────────────────
  ('Denver', 'Denver', 'CO', 715522, 39.7392, -104.9903, 0),
  ('Colorado Springs', 'El Paso', 'CO', 478961, 38.8339, -104.8214, 0),
  ('Aurora', 'Arapahoe', 'CO', 386261, 39.7294, -104.8319, 0),
  ('Fort Collins', 'Larimer', 'CO', 169810, 40.5853, -105.0844, 0),
  ('Lakewood', 'Jefferson', 'CO', 155984, 39.7047, -105.0814, 0),

  -- ── Connecticut ───────────────────────────────────────────────────────────
  ('Bridgeport', 'Fairfield', 'CT', 148654, 41.1865, -73.1952, 0),
  ('New Haven', 'New Haven', 'CT', 134023, 41.3083, -72.9279, 0),
  ('Stamford', 'Fairfield', 'CT', 135470, 41.0534, -73.5387, 0),
  ('Hartford', 'Hartford', 'CT', 121054, 41.7658, -72.6734, 0),
  ('Waterbury', 'New Haven', 'CT', 114403, 41.5582, -73.0515, 0),

  -- ── Delaware ──────────────────────────────────────────────────────────────
  ('Wilmington', 'New Castle', 'DE', 70898, 39.7391, -75.5398, 0),
  ('Dover', 'Kent', 'DE', 39403, 39.1582, -75.5244, 0),
  ('Newark', 'New Castle', 'DE', 31454, 39.6837, -75.7497, 0),
  ('Middletown', 'New Castle', 'DE', 23192, 39.4496, -75.7163, 0),
  ('Smyrna', 'Kent', 'DE', 12883, 39.2998, -75.6046, 0),

  -- ── Florida ───────────────────────────────────────────────────────────────
  ('Jacksonville', 'Duval', 'FL', 949611, 30.3322, -81.6557, 0),
  ('Miami', 'Miami-Dade', 'FL', 442241, 25.7617, -80.1918, 0),
  ('Tampa', 'Hillsborough', 'FL', 384959, 27.9506, -82.4572, 0),
  ('Orlando', 'Orange', 'FL', 307573, 28.5383, -81.3792, 0),
  ('St. Petersburg', 'Pinellas', 'FL', 258308, 27.7676, -82.6403, 0),

  -- ── Georgia ───────────────────────────────────────────────────────────────
  ('Atlanta', 'Fulton', 'GA', 498715, 33.7490, -84.3880, 0),
  ('Columbus', 'Muscogee', 'GA', 206922, 32.4610, -84.9877, 0),
  ('Augusta', 'Richmond', 'GA', 202081, 33.4735, -82.0105, 0),
  ('Macon', 'Bibb', 'GA', 157346, 32.8407, -83.6324, 0),
  ('Savannah', 'Chatham', 'GA', 147780, 32.0809, -81.0912, 0),

  -- ── Hawaii ────────────────────────────────────────────────────────────────
  ('Honolulu', 'Honolulu', 'HI', 350964, 21.3069, -157.8583, 0),
  ('Pearl City', 'Honolulu', 'HI', 45295, 21.3972, -157.9752, 0),
  ('Hilo', 'Hawaii', 'HI', 44186, 19.7297, -155.0900, 0),
  ('Waipahu', 'Honolulu', 'HI', 43485, 21.3867, -158.0092, 0),
  ('Kailua', 'Honolulu', 'HI', 40514, 21.4022, -157.7394, 0),

  -- ── Idaho ─────────────────────────────────────────────────────────────────
  ('Boise', 'Ada', 'ID', 235684, 43.6150, -116.2023, 0),
  ('Meridian', 'Ada', 'ID', 117635, 43.6121, -116.3915, 0),
  ('Nampa', 'Canyon', 'ID', 100200, 43.5407, -116.5635, 0),
  ('Idaho Falls', 'Bonneville', 'ID', 64818, 43.4917, -112.0339, 0),
  ('Caldwell', 'Canyon', 'ID', 59996, 43.6629, -116.6874, 0),

  -- ── Indiana ───────────────────────────────────────────────────────────────
  ('Indianapolis', 'Marion', 'IN', 887642, 39.7684, -86.1581, 0),
  ('Fort Wayne', 'Allen', 'IN', 263886, 41.0793, -85.1394, 0),
  ('Evansville', 'Vanderburgh', 'IN', 118414, 37.9716, -87.5711, 0),
  ('South Bend', 'St. Joseph', 'IN', 103453, 41.6764, -86.2520, 0),
  ('Carmel', 'Hamilton', 'IN', 99757, 39.9784, -86.1180, 0),

  -- ── Iowa ──────────────────────────────────────────────────────────────────
  ('Des Moines', 'Polk', 'IA', 214133, 41.5868, -93.6250, 0),
  ('Cedar Rapids', 'Linn', 'IA', 137710, 41.9779, -91.6656, 0),
  ('Davenport', 'Scott', 'IA', 101724, 41.5236, -90.5776, 0),
  ('Sioux City', 'Woodbury', 'IA', 85797, 42.4963, -96.4049, 0),
  ('Iowa City', 'Johnson', 'IA', 74828, 41.6611, -91.5302, 0),

  -- ── Kansas ────────────────────────────────────────────────────────────────
  ('Wichita', 'Sedgwick', 'KS', 397532, 37.6872, -97.3301, 0),
  ('Overland Park', 'Johnson', 'KS', 197238, 38.9822, -94.6708, 0),
  ('Kansas City', 'Wyandotte', 'KS', 156607, 39.1141, -94.6275, 0),
  ('Olathe', 'Johnson', 'KS', 141290, 38.8814, -94.8191, 0),
  ('Topeka', 'Shawnee', 'KS', 126587, 39.0473, -95.6752, 0),

  -- ── Kentucky ──────────────────────────────────────────────────────────────
  ('Louisville', 'Jefferson', 'KY', 633045, 38.2527, -85.7585, 0),
  ('Lexington', 'Fayette', 'KY', 322570, 38.0406, -84.5037, 0),
  ('Bowling Green', 'Warren', 'KY', 72294, 36.9685, -86.4808, 0),
  ('Owensboro', 'Daviess', 'KY', 60183, 37.7719, -87.1112, 0),
  ('Covington', 'Kenton', 'KY', 40961, 39.0837, -84.5086, 0),

  -- ── Louisiana ─────────────────────────────────────────────────────────────
  ('New Orleans', 'Orleans', 'LA', 383997, 29.9511, -90.0715, 0),
  ('Baton Rouge', 'East Baton Rouge', 'LA', 227470, 30.4515, -91.1871, 0),
  ('Shreveport', 'Caddo', 'LA', 187593, 32.5252, -93.7502, 0),
  ('Lafayette', 'Lafayette', 'LA', 121374, 30.2241, -92.0198, 0),
  ('Lake Charles', 'Calcasieu', 'LA', 84872, 30.2266, -93.2174, 0),

  -- ── Maine ─────────────────────────────────────────────────────────────────
  ('Portland', 'Cumberland', 'ME', 68408, 43.6591, -70.2568, 0),
  ('Lewiston', 'Androscoggin', 'ME', 37121, 44.1004, -70.2148, 0),
  ('Bangor', 'Penobscot', 'ME', 31753, 44.8016, -68.7712, 0),
  ('South Portland', 'Cumberland', 'ME', 26498, 43.6415, -70.2409, 0),
  ('Auburn', 'Androscoggin', 'ME', 24061, 44.0979, -70.2312, 0),

  -- ── Maryland ──────────────────────────────────────────────────────────────
  ('Baltimore', 'Baltimore City', 'MD', 585708, 39.2904, -76.6122, 0),
  ('Columbia', 'Howard', 'MD', 104681, 39.2037, -76.8610, 0),
  ('Germantown', 'Montgomery', 'MD', 91249, 39.1732, -77.2717, 0),
  ('Silver Spring', 'Montgomery', 'MD', 81015, 38.9907, -77.0261, 0),
  ('Frederick', 'Frederick', 'MD', 78171, 39.4143, -77.4105, 0),

  -- ── Massachusetts ─────────────────────────────────────────────────────────
  ('Boston', 'Suffolk', 'MA', 675647, 42.3601, -71.0589, 0),
  ('Worcester', 'Worcester', 'MA', 206518, 42.2626, -71.8023, 0),
  ('Springfield', 'Hampden', 'MA', 155929, 42.1015, -72.5898, 0),
  ('Cambridge', 'Middlesex', 'MA', 118403, 42.3736, -71.1097, 0),
  ('Lowell', 'Middlesex', 'MA', 115554, 42.6334, -71.3162, 0),

  -- ── Michigan ──────────────────────────────────────────────────────────────
  ('Detroit', 'Wayne', 'MI', 639111, 42.3314, -83.0458, 0),
  ('Grand Rapids', 'Kent', 'MI', 198917, 42.9634, -85.6681, 0),
  ('Warren', 'Macomb', 'MI', 139387, 42.5145, -83.0147, 0),
  ('Sterling Heights', 'Macomb', 'MI', 134346, 42.5803, -83.0302, 0),
  ('Ann Arbor', 'Washtenaw', 'MI', 123851, 42.2808, -83.7430, 0),

  -- ── Mississippi ───────────────────────────────────────────────────────────
  ('Jackson', 'Hinds', 'MS', 153701, 32.2988, -90.1848, 0),
  ('Gulfport', 'Harrison', 'MS', 72926, 30.3674, -89.0928, 0),
  ('Southaven', 'DeSoto', 'MS', 54648, 34.9890, -90.0126, 0),
  ('Biloxi', 'Harrison', 'MS', 49449, 30.3960, -88.8853, 0),
  ('Hattiesburg', 'Forrest', 'MS', 48730, 31.3271, -89.2903, 0),

  -- ── Missouri ──────────────────────────────────────────────────────────────
  ('Kansas City', 'Jackson', 'MO', 508090, 39.0997, -94.5786, 0),
  ('St. Louis', 'St. Louis City', 'MO', 301578, 38.6270, -90.1994, 0),
  ('Springfield', 'Greene', 'MO', 169176, 37.2090, -93.2923, 0),
  ('Columbia', 'Boone', 'MO', 126254, 38.9517, -92.3341, 0),
  ('Independence', 'Jackson', 'MO', 123011, 39.0911, -94.4155, 0),

  -- ── Montana ───────────────────────────────────────────────────────────────
  ('Billings', 'Yellowstone', 'MT', 117116, 45.7833, -108.5007, 0),
  ('Missoula', 'Missoula', 'MT', 75516, 46.8721, -113.9940, 0),
  ('Great Falls', 'Cascade', 'MT', 60442, 47.5052, -111.3008, 0),
  ('Bozeman', 'Gallatin', 'MT', 53293, 45.6770, -111.0429, 0),
  ('Butte', 'Silver Bow', 'MT', 34494, 46.0038, -112.5348, 0),

  -- ── Nebraska ──────────────────────────────────────────────────────────────
  ('Omaha', 'Douglas', 'NE', 486051, 41.2565, -95.9345, 0),
  ('Lincoln', 'Lancaster', 'NE', 291082, 40.8136, -96.7026, 0),
  ('Bellevue', 'Sarpy', 'NE', 64176, 41.1544, -95.9146, 0),
  ('Grand Island', 'Hall', 'NE', 53131, 40.9264, -98.3420, 0),
  ('Kearney', 'Buffalo', 'NE', 33790, 40.6993, -99.0817, 0),

  -- ── Nevada ────────────────────────────────────────────────────────────────
  ('Las Vegas', 'Clark', 'NV', 641903, 36.1699, -115.1398, 0),
  ('Henderson', 'Clark', 'NV', 317610, 36.0395, -114.9817, 0),
  ('Reno', 'Washoe', 'NV', 264165, 39.5296, -119.8138, 0),
  ('North Las Vegas', 'Clark', 'NV', 262527, 36.1989, -115.1175, 0),
  ('Sparks', 'Washoe', 'NV', 108445, 39.5349, -119.7527, 0),

  -- ── New Hampshire ─────────────────────────────────────────────────────────
  ('Manchester', 'Hillsborough', 'NH', 115644, 42.9956, -71.4548, 0),
  ('Nashua', 'Hillsborough', 'NH', 91322, 42.7654, -71.4676, 0),
  ('Concord', 'Merrimack', 'NH', 43976, 43.2081, -71.5376, 0),
  ('Derry', 'Rockingham', 'NH', 34317, 42.8806, -71.3273, 0),
  ('Dover', 'Strafford', 'NH', 32741, 43.1979, -70.8737, 0),

  -- ── New Jersey ────────────────────────────────────────────────────────────
  ('Newark', 'Essex', 'NJ', 311549, 40.7357, -74.1724, 0),
  ('Jersey City', 'Hudson', 'NJ', 292449, 40.7178, -74.0431, 0),
  ('Paterson', 'Passaic', 'NJ', 159732, 40.9168, -74.1718, 0),
  ('Elizabeth', 'Union', 'NJ', 137298, 40.6640, -74.2107, 0),
  ('Edison', 'Middlesex', 'NJ', 107588, 40.5187, -74.4121, 0),

  -- ── New Mexico ────────────────────────────────────────────────────────────
  ('Albuquerque', 'Bernalillo', 'NM', 564559, 35.0844, -106.6504, 0),
  ('Las Cruces', 'Dona Ana', 'NM', 111385, 32.3199, -106.7637, 0),
  ('Rio Rancho', 'Sandoval', 'NM', 104046, 35.2328, -106.6630, 0),
  ('Santa Fe', 'Santa Fe', 'NM', 87505, 35.6870, -105.9378, 0),
  ('Roswell', 'Chaves', 'NM', 48386, 33.3943, -104.5230, 0),

  -- ── North Carolina ────────────────────────────────────────────────────────
  ('Charlotte', 'Mecklenburg', 'NC', 874579, 35.2271, -80.8431, 0),
  ('Raleigh', 'Wake', 'NC', 467665, 35.7796, -78.6382, 0),
  ('Greensboro', 'Guilford', 'NC', 299035, 36.0726, -79.7920, 0),
  ('Durham', 'Durham', 'NC', 283506, 35.9940, -78.8986, 0),
  ('Winston-Salem', 'Forsyth', 'NC', 249545, 36.0999, -80.2442, 0),

  -- ── North Dakota ──────────────────────────────────────────────────────────
  ('Fargo', 'Cass', 'ND', 125990, 46.8772, -96.7898, 0),
  ('Bismarck', 'Burleigh', 'ND', 73622, 46.8083, -100.7837, 0),
  ('Grand Forks', 'Grand Forks', 'ND', 59166, 47.9253, -97.0329, 0),
  ('Minot', 'Ward', 'ND', 48377, 48.2330, -101.2963, 0),
  ('West Fargo', 'Cass', 'ND', 38626, 46.8749, -96.9003, 0),

  -- ── Ohio ──────────────────────────────────────────────────────────────────
  ('Columbus', 'Franklin', 'OH', 905748, 39.9612, -82.9988, 0),
  ('Cleveland', 'Cuyahoga', 'OH', 372624, 41.4993, -81.6944, 0),
  ('Cincinnati', 'Hamilton', 'OH', 309317, 39.1031, -84.5120, 0),
  ('Toledo', 'Lucas', 'OH', 270871, 41.6528, -83.5379, 0),
  ('Akron', 'Summit', 'OH', 190469, 41.0814, -81.5190, 0),

  -- ── Oklahoma ──────────────────────────────────────────────────────────────
  ('Oklahoma City', 'Oklahoma', 'OK', 681054, 35.4676, -97.5164, 0),
  ('Tulsa', 'Tulsa', 'OK', 413066, 36.1540, -95.9928, 0),
  ('Norman', 'Cleveland', 'OK', 128026, 35.2226, -97.4395, 0),
  ('Broken Arrow', 'Tulsa', 'OK', 113540, 36.0526, -95.7909, 0),
  ('Edmond', 'Oklahoma', 'OK', 94428, 35.6528, -97.4781, 0),

  -- ── Oregon ────────────────────────────────────────────────────────────────
  ('Portland', 'Multnomah', 'OR', 652503, 45.5152, -122.6784, 0),
  ('Eugene', 'Lane', 'OR', 176654, 44.0521, -123.0868, 0),
  ('Salem', 'Marion', 'OR', 175535, 44.9429, -123.0351, 0),
  ('Gresham', 'Multnomah', 'OR', 114247, 45.5001, -122.4302, 0),
  ('Hillsboro', 'Washington', 'OR', 106447, 45.5229, -122.9898, 0),

  -- ── Pennsylvania ──────────────────────────────────────────────────────────
  ('Philadelphia', 'Philadelphia', 'PA', 1603797, 39.9526, -75.1652, 0),
  ('Pittsburgh', 'Allegheny', 'PA', 302971, 40.4406, -79.9959, 0),
  ('Allentown', 'Lehigh', 'PA', 125845, 40.6084, -75.4902, 0),
  ('Reading', 'Berks', 'PA', 95112, 40.3356, -75.9269, 0),
  ('Erie', 'Erie', 'PA', 94831, 42.1292, -80.0851, 0),

  -- ── Rhode Island ──────────────────────────────────────────────────────────
  ('Providence', 'Providence', 'RI', 190934, 41.8240, -71.4128, 0),
  ('Cranston', 'Providence', 'RI', 82934, 41.7798, -71.4373, 0),
  ('Warwick', 'Kent', 'RI', 82823, 41.7001, -71.4162, 0),
  ('Pawtucket', 'Providence', 'RI', 75604, 41.8787, -71.3826, 0),
  ('East Providence', 'Providence', 'RI', 47139, 41.8137, -71.3701, 0),

  -- ── South Carolina ────────────────────────────────────────────────────────
  ('Charleston', 'Charleston', 'SC', 150227, 32.7765, -79.9311, 0),
  ('Columbia', 'Richland', 'SC', 136632, 34.0007, -81.0348, 0),
  ('North Charleston', 'Charleston', 'SC', 114852, 32.8546, -79.9748, 0),
  ('Mount Pleasant', 'Charleston', 'SC', 90801, 32.8323, -79.8284, 0),
  ('Rock Hill', 'York', 'SC', 74372, 34.9249, -81.0251, 0),

  -- ── South Dakota ──────────────────────────────────────────────────────────
  ('Sioux Falls', 'Minnehaha', 'SD', 192517, 43.5446, -96.7311, 0),
  ('Rapid City', 'Pennington', 'SD', 74703, 44.0805, -103.2310, 0),
  ('Aberdeen', 'Brown', 'SD', 28495, 45.4647, -98.4865, 0),
  ('Brookings', 'Brookings', 'SD', 23377, 44.3114, -96.7984, 0),
  ('Watertown', 'Codington', 'SD', 22655, 44.8994, -97.1151, 0),

  -- ── Tennessee ─────────────────────────────────────────────────────────────
  ('Nashville', 'Davidson', 'TN', 689447, 36.1627, -86.7816, 0),
  ('Memphis', 'Shelby', 'TN', 633104, 35.1495, -90.0490, 0),
  ('Knoxville', 'Knox', 'TN', 190740, 35.9606, -83.9207, 0),
  ('Chattanooga', 'Hamilton', 'TN', 181099, 35.0456, -85.3097, 0),
  ('Clarksville', 'Montgomery', 'TN', 166722, 36.5298, -87.3595, 0),

  -- ── Texas ─────────────────────────────────────────────────────────────────
  ('Houston', 'Harris', 'TX', 2304580, 29.7604, -95.3698, 0),
  ('San Antonio', 'Bexar', 'TX', 1434625, 29.4241, -98.4936, 0),
  ('Dallas', 'Dallas', 'TX', 1304379, 32.7767, -96.7970, 0),
  ('Austin', 'Travis', 'TX', 961855, 30.2672, -97.7431, 0),
  ('Fort Worth', 'Tarrant', 'TX', 918915, 32.7555, -97.3308, 0),

  -- ── Utah ──────────────────────────────────────────────────────────────────
  ('Salt Lake City', 'Salt Lake', 'UT', 199723, 40.7608, -111.8910, 0),
  ('West Valley City', 'Salt Lake', 'UT', 140230, 40.6916, -112.0011, 0),
  ('West Jordan', 'Salt Lake', 'UT', 116961, 40.6097, -111.9391, 0),
  ('Provo', 'Utah', 'UT', 115162, 40.2338, -111.6585, 0),
  ('Orem', 'Utah', 'UT', 98129, 40.2969, -111.6946, 0),

  -- ── Vermont ───────────────────────────────────────────────────────────────
  ('Burlington', 'Chittenden', 'VT', 44743, 44.4759, -73.2121, 0),
  ('Essex', 'Chittenden', 'VT', 22094, 44.4906, -73.1129, 0),
  ('South Burlington', 'Chittenden', 'VT', 20292, 44.4670, -73.1710, 0),
  ('Colchester', 'Chittenden', 'VT', 17524, 44.5439, -73.1479, 0),
  ('Rutland', 'Rutland', 'VT', 15807, 43.6106, -72.9726, 0),

  -- ── Virginia ──────────────────────────────────────────────────────────────
  ('Virginia Beach', 'Virginia Beach City', 'VA', 459470, 36.8529, -75.9780, 0),
  ('Chesapeake', 'Chesapeake City', 'VA', 249422, 36.7682, -76.2875, 0),
  ('Norfolk', 'Norfolk City', 'VA', 238005, 36.8508, -76.2859, 0),
  ('Richmond', 'Richmond City', 'VA', 226610, 37.5407, -77.4360, 0),
  ('Newport News', 'Newport News City', 'VA', 186247, 37.0871, -76.4730, 0),

  -- ── Washington ────────────────────────────────────────────────────────────
  ('Seattle', 'King', 'WA', 737015, 47.6062, -122.3321, 0),
  ('Spokane', 'Spokane', 'WA', 228989, 47.6588, -117.4260, 0),
  ('Tacoma', 'Pierce', 'WA', 219346, 47.2529, -122.4443, 0),
  ('Vancouver', 'Clark', 'WA', 190915, 45.6387, -122.6615, 0),
  ('Bellevue', 'King', 'WA', 151854, 47.6101, -122.2015, 0),

  -- ── West Virginia ─────────────────────────────────────────────────────────
  ('Charleston', 'Kanawha', 'WV', 48864, 38.3498, -81.6326, 0),
  ('Huntington', 'Cabell', 'WV', 46842, 38.4192, -82.4452, 0),
  ('Morgantown', 'Monongalia', 'WV', 30347, 39.6295, -79.9559, 0),
  ('Parkersburg', 'Wood', 'WV', 29738, 39.2667, -81.5615, 0),
  ('Wheeling', 'Ohio', 'WV', 27062, 40.0640, -80.7209, 0),

  -- ── Wyoming ───────────────────────────────────────────────────────────────
  ('Cheyenne', 'Laramie', 'WY', 65132, 41.1400, -104.8202, 0),
  ('Casper', 'Natrona', 'WY', 59038, 42.8501, -106.3252, 0),
  ('Gillette', 'Campbell', 'WY', 33403, 44.2911, -105.5022, 0),
  ('Laramie', 'Albany', 'WY', 31407, 41.3114, -105.5911, 0),
  ('Rock Springs', 'Sweetwater', 'WY', 23526, 41.5875, -109.2029, 0)
) AS v(city_name, county, state, population, latitude, longitude, defense_points)
WHERE NOT EXISTS (
  SELECT 1 FROM gyms g WHERE g.city_name = v.city_name AND g.state = v.state
);

-- If your gyms table has a PostGIS geography column (e.g. "location") that
-- gyms_near uses instead of latitude/longitude, ALSO run this after the
-- insert (skip it if you get "column does not exist"):
--
-- UPDATE gyms
-- SET location = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
-- WHERE location IS NULL;
