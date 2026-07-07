-- ============================================================================
-- Profile photos, profile posts, and Clicks (clans tied to town halls).
-- Run once in the Supabase SQL editor.
-- ============================================================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS clique_id UUID;

-- Clicks: party-scoped clans, each tied to a town hall. party is TEXT with a
-- CHECK (not an enum) on purpose — no more enum battles.
CREATE TABLE IF NOT EXISTS cliques (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL CHECK (char_length(name) <= 60),
  gym_id UUID REFERENCES gyms(id) ON DELETE CASCADE,
  party TEXT NOT NULL CHECK (party IN ('democrat', 'republican')),
  creator_id UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS cliques_party_idx ON cliques(party);

-- Profile posts (public feed at the bottom of each profile)
CREATE TABLE IF NOT EXISTS profile_posts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL CHECK (char_length(content) <= 500),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS posts_profile_idx ON profile_posts(profile_id, created_at DESC);
