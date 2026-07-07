-- ============================================================================
-- Living world: every 2 hours, bots donate to their halls and besiege enemy
-- halls. Bot-held halls can fall to the other party's bots; PLAYER-held halls
-- get ground down but are never stolen by bots (only real players capture).
-- Run once in the Supabase SQL editor.
-- ============================================================================

CREATE OR REPLACE FUNCTION bot_world_tick() RETURNS text AS $$
DECLARE
  r RECORD;
  nb RECORD;
  donated int := 0;
  attacked int := 0;
  flipped int := 0;
BEGIN
  -- 1. Donations: bots reinforce ~10% of their halls each tick
  FOR r IN
    SELECT g.id FROM gyms g
    JOIN profiles p ON p.id = g.holder_id
    WHERE p.clerk_user_id LIKE 'bot\_%'
      AND g.defense_points < 5000
      AND random() < 0.10
    LIMIT 120
  LOOP
    UPDATE gyms
    SET defense_points = LEAST(defense_points + 100 + floor(random()*300)::int, 5000)
    WHERE id = r.id;
    donated := donated + 1;
  END LOOP;

  -- 2. Sieges: ~3% of held halls get attacked by the opposing side's bots
  FOR r IN
    SELECT g.id, g.holder_id, g.holder_party::text AS holder_party, g.defense_points,
           (p.clerk_user_id LIKE 'bot\_%') AS holder_is_bot
    FROM gyms g
    LEFT JOIN profiles p ON p.id = g.holder_id
    WHERE g.holder_id IS NOT NULL AND random() < 0.03
    LIMIT 60
  LOOP
    attacked := attacked + 1;
    IF r.defense_points > 500 THEN
      -- chip damage
      UPDATE gyms
      SET defense_points = GREATEST(defense_points - (200 + floor(random()*300))::int, 0)
      WHERE id = r.id;
    ELSIF r.holder_is_bot THEN
      -- weak bot-held hall falls to a random bot from the other party
      SELECT id, party INTO nb FROM profiles
      WHERE clerk_user_id LIKE 'bot\_%' AND party::text <> r.holder_party
      ORDER BY random() LIMIT 1;
      IF nb.id IS NOT NULL THEN
        UPDATE gyms
        SET holder_id = nb.id,
            holder_party = nb.party,
            defense_points = 300 + floor(random()*600)::int,
            held_since = now()
        WHERE id = r.id;
        flipped := flipped + 1;
      END IF;
    ELSE
      -- player-held: bots grind defense down but never capture from players
      UPDATE gyms
      SET defense_points = GREATEST(defense_points - (150 + floor(random()*250))::int, 0)
      WHERE id = r.id;
    END IF;
  END LOOP;

  RETURN format('donated:%s attacked:%s flipped:%s', donated, attacked, flipped);
END;
$$ LANGUAGE plpgsql;

-- Schedule it every 2 hours
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule('bot-world-tick', '15 */2 * * *', 'SELECT bot_world_tick()');

-- Run one tick right now so you can see the world move
SELECT bot_world_tick();
