-- 1. Create matches table
CREATE TABLE IF NOT EXISTS matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL DEFAULT 'ymq',
  ymq_match_id TEXT UNIQUE NOT NULL,
  category TEXT NOT NULL DEFAULT 'U',
  tournament_name TEXT NOT NULL,
  start_time TIMESTAMPTZ,
  location TEXT,
  city TEXT,
  players_a TEXT[] NOT NULL DEFAULT '{}',
  players_b TEXT[] NOT NULL DEFAULT '{}',
  score_text TEXT,
  winner_side TEXT NOT NULL DEFAULT 'UNKNOWN',
  source_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for searching and filtering
CREATE INDEX IF NOT EXISTS idx_matches_start_time_desc ON matches(start_time DESC);
CREATE INDEX IF NOT EXISTS idx_matches_tournament_name ON matches(tournament_name);
CREATE INDEX IF NOT EXISTS idx_matches_players_a_gin ON matches USING GIN(players_a);
CREATE INDEX IF NOT EXISTS idx_matches_players_b_gin ON matches USING GIN(players_b);

-- Minimal permission controls (Read-only for public)
GRANT SELECT ON matches TO anon;
GRANT ALL PRIVILEGES ON matches TO authenticated;

-- 2. Create sync_runs table
CREATE TABLE IF NOT EXISTS sync_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL DEFAULT 'ymq',
  run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL,
  pulled_count INT NOT NULL DEFAULT 0,
  upserted_count INT NOT NULL DEFAULT 0,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_runs_run_at_desc ON sync_runs(run_at DESC);

GRANT SELECT ON sync_runs TO anon;
GRANT ALL PRIVILEGES ON sync_runs TO authenticated;
