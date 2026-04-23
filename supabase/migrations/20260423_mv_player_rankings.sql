-- MatchLife V2.0 P1: Player Rankings Materialized View
-- Purpose: Aggregate player statistics for leaderboard functionality
-- Created: 2026-04-23

-- Drop existing objects if they exist (for idempotent migrations)
DROP MATERIALIZED VIEW IF EXISTS mv_player_rankings CASCADE;
DROP FUNCTION IF EXISTS get_player_rankings(TEXT, INT, INT);
DROP FUNCTION IF EXISTS refresh_player_rankings();

-- Create materialized view for player rankings
-- Aggregates: total matches, wins, win rate, last active date
-- Filters: Only active players with >= 5 matches
CREATE MATERIALIZED VIEW mv_player_rankings AS
WITH player_matches AS (
  SELECT 
    p.id,
    p.player_name,
    p.avatar_url,
    p.primary_sport,
    m.id as match_id,
    m.winner_side,
    m.players_a,
    m.players_b,
    m.match_date,
    CASE 
      WHEN m.winner_side = 'A' AND p.player_name = ANY(m.players_a) THEN 1
      WHEN m.winner_side = 'B' AND p.player_name = ANY(m.players_b) THEN 1
      ELSE 0
    END as is_win
  FROM players p
  LEFT JOIN matches m ON (
    p.player_name = ANY(m.players_a) OR 
    p.player_name = ANY(m.players_b)
  )
  WHERE p.status = 'active'
    AND m.winner_side IN ('A', 'B')
)
SELECT 
  id as player_id,
  player_name,
  avatar_url,
  primary_sport,
  COUNT(match_id) as total_matches,
  SUM(is_win) as wins,
  ROUND(
    (SUM(is_win)::numeric / NULLIF(COUNT(match_id), 0)) * 100, 
    2
  ) as win_rate,
  MAX(match_date) as last_active
FROM player_matches
GROUP BY id, player_name, avatar_url, primary_sport
HAVING COUNT(match_id) >= 5;

-- Create indexes for optimal query performance
CREATE INDEX idx_mv_player_rankings_sport 
  ON mv_player_rankings(primary_sport);

CREATE INDEX idx_mv_player_rankings_win_rate 
  ON mv_player_rankings(win_rate DESC, wins DESC);

CREATE INDEX idx_mv_player_rankings_last_active 
  ON mv_player_rankings(last_active DESC);

-- RPC function: get_player_rankings
-- Returns paginated player rankings with optional sport filter
-- Parameters:
--   sport_type: Filter by sport (badminton, tennis, etc.) - NULL for all
--   page_limit: Number of records per page (default 20)
--   page_offset: Offset for pagination (default 0)
CREATE OR REPLACE FUNCTION get_player_rankings(
  sport_type TEXT DEFAULT NULL,
  page_limit INT DEFAULT 20,
  page_offset INT DEFAULT 0
)
RETURNS TABLE (
  rank BIGINT,
  player_id UUID,
  player_name VARCHAR,
  avatar_url TEXT,
  total_matches BIGINT,
  wins BIGINT,
  win_rate NUMERIC,
  last_active TIMESTAMPTZ
) 
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ROW_NUMBER() OVER (
      ORDER BY r.win_rate DESC, r.wins DESC, r.total_matches DESC
    ) as rank,
    r.player_id,
    r.player_name,
    r.avatar_url,
    r.total_matches,
    r.wins,
    r.win_rate,
    r.last_active
  FROM mv_player_rankings r
  WHERE (sport_type IS NULL OR r.primary_sport = sport_type)
  ORDER BY r.win_rate DESC, r.wins DESC, r.total_matches DESC
  LIMIT page_limit 
  OFFSET page_offset;
END;
$$;

-- Function to manually refresh materialized view
CREATE OR REPLACE FUNCTION refresh_player_rankings()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_player_rankings;
END;
$$;

-- Initial data population
REFRESH MATERIALIZED VIEW mv_player_rankings;
