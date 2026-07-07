-- ============================================================================
-- Bot holders for town halls.
-- Creates 20 bot profiles (10 per party), then assigns every UNCLAIMED hall
-- to a random bot with 500-2,500 defense points. Player-held halls are never
-- touched, so this is safe to re-run after seeding more halls.
-- (Individual INSERT statements because profiles.party is an enum — literals
-- coerce to enums, VALUES-table columns don't.)
-- ============================================================================

-- 1. Bot profiles (each skips itself if it already exists)
INSERT INTO profiles (clerk_user_id, username, party, fp_balance)
SELECT 'bot_r01', 'EagleEyeEd', 'republican', 5000
WHERE NOT EXISTS (SELECT 1 FROM profiles WHERE clerk_user_id = 'bot_r01');
INSERT INTO profiles (clerk_user_id, username, party, fp_balance)
SELECT 'bot_r02', 'LibertyLou', 'republican', 5000
WHERE NOT EXISTS (SELECT 1 FROM profiles WHERE clerk_user_id = 'bot_r02');
INSERT INTO profiles (clerk_user_id, username, party, fp_balance)
SELECT 'bot_r03', 'RedStateRex', 'republican', 5000
WHERE NOT EXISTS (SELECT 1 FROM profiles WHERE clerk_user_id = 'bot_r03');
INSERT INTO profiles (clerk_user_id, username, party, fp_balance)
SELECT 'bot_r04', 'FreedomFrank', 'republican', 5000
WHERE NOT EXISTS (SELECT 1 FROM profiles WHERE clerk_user_id = 'bot_r04');
INSERT INTO profiles (clerk_user_id, username, party, fp_balance)
SELECT 'bot_r05', 'CowboyCal', 'republican', 5000
WHERE NOT EXISTS (SELECT 1 FROM profiles WHERE clerk_user_id = 'bot_r05');
INSERT INTO profiles (clerk_user_id, username, party, fp_balance)
SELECT 'bot_r06', 'PatriotPete', 'republican', 5000
WHERE NOT EXISTS (SELECT 1 FROM profiles WHERE clerk_user_id = 'bot_r06');
INSERT INTO profiles (clerk_user_id, username, party, fp_balance)
SELECT 'bot_r07', 'TexasTina', 'republican', 5000
WHERE NOT EXISTS (SELECT 1 FROM profiles WHERE clerk_user_id = 'bot_r07');
INSERT INTO profiles (clerk_user_id, username, party, fp_balance)
SELECT 'bot_r08', 'GritGrace', 'republican', 5000
WHERE NOT EXISTS (SELECT 1 FROM profiles WHERE clerk_user_id = 'bot_r08');
INSERT INTO profiles (clerk_user_id, username, party, fp_balance)
SELECT 'bot_r09', 'OilBaronOtis', 'republican', 5000
WHERE NOT EXISTS (SELECT 1 FROM profiles WHERE clerk_user_id = 'bot_r09');
INSERT INTO profiles (clerk_user_id, username, party, fp_balance)
SELECT 'bot_r10', 'MidwestMack', 'republican', 5000
WHERE NOT EXISTS (SELECT 1 FROM profiles WHERE clerk_user_id = 'bot_r10');
INSERT INTO profiles (clerk_user_id, username, party, fp_balance)
SELECT 'bot_d01', 'BlueWaveBetty', 'democrat', 5000
WHERE NOT EXISTS (SELECT 1 FROM profiles WHERE clerk_user_id = 'bot_d01');
INSERT INTO profiles (clerk_user_id, username, party, fp_balance)
SELECT 'bot_d02', 'ProgressivePam', 'democrat', 5000
WHERE NOT EXISTS (SELECT 1 FROM profiles WHERE clerk_user_id = 'bot_d02');
INSERT INTO profiles (clerk_user_id, username, party, fp_balance)
SELECT 'bot_d03', 'UnionJoe', 'democrat', 5000
WHERE NOT EXISTS (SELECT 1 FROM profiles WHERE clerk_user_id = 'bot_d03');
INSERT INTO profiles (clerk_user_id, username, party, fp_balance)
SELECT 'bot_d04', 'CoastalCarl', 'democrat', 5000
WHERE NOT EXISTS (SELECT 1 FROM profiles WHERE clerk_user_id = 'bot_d04');
INSERT INTO profiles (clerk_user_id, username, party, fp_balance)
SELECT 'bot_d05', 'GreenGwen', 'democrat', 5000
WHERE NOT EXISTS (SELECT 1 FROM profiles WHERE clerk_user_id = 'bot_d05');
INSERT INTO profiles (clerk_user_id, username, party, fp_balance)
SELECT 'bot_d06', 'MetroMia', 'democrat', 5000
WHERE NOT EXISTS (SELECT 1 FROM profiles WHERE clerk_user_id = 'bot_d06');
INSERT INTO profiles (clerk_user_id, username, party, fp_balance)
SELECT 'bot_d07', 'CanvassCindy', 'democrat', 5000
WHERE NOT EXISTS (SELECT 1 FROM profiles WHERE clerk_user_id = 'bot_d07');
INSERT INTO profiles (clerk_user_id, username, party, fp_balance)
SELECT 'bot_d08', 'PolicyPaul', 'democrat', 5000
WHERE NOT EXISTS (SELECT 1 FROM profiles WHERE clerk_user_id = 'bot_d08');
INSERT INTO profiles (clerk_user_id, username, party, fp_balance)
SELECT 'bot_d09', 'TurnoutTara', 'democrat', 5000
WHERE NOT EXISTS (SELECT 1 FROM profiles WHERE clerk_user_id = 'bot_d09');
INSERT INTO profiles (clerk_user_id, username, party, fp_balance)
SELECT 'bot_d10', 'DonkeyDrew', 'democrat', 5000
WHERE NOT EXISTS (SELECT 1 FROM profiles WHERE clerk_user_id = 'bot_d10');

-- 2. Hand every unclaimed hall to a random bot with random defense
WITH bots AS (
  SELECT id, party, row_number() OVER (ORDER BY id) AS rn
  FROM profiles
  WHERE clerk_user_id LIKE 'bot\_%'
),
bot_count AS (SELECT count(*) AS c FROM bots),
targets AS (
  SELECT g.id AS gym_id,
         1 + floor(random() * (SELECT c FROM bot_count))::int AS pick,
         500 + floor(random() * 2000)::int AS def
  FROM gyms g
  WHERE g.holder_id IS NULL
)
UPDATE gyms g
SET holder_id      = b.id,
    holder_party   = b.party,
    defense_points = t.def,
    held_since     = now()
FROM targets t
JOIN bots b ON b.rn = t.pick
WHERE g.id = t.gym_id;

-- Sanity check: how the map now splits
SELECT holder_party, count(*) FROM gyms GROUP BY holder_party;
