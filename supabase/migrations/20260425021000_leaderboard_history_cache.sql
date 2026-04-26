CREATE OR REPLACE FUNCTION public.matchlife_player_rank_uuid(
  p_player_name TEXT,
  p_sport_type TEXT
)
RETURNS UUID
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT (
    substr(md5(lower(trim(coalesce(p_player_name, ''))) || ':' || lower(trim(coalesce(p_sport_type, '')))), 1, 8) || '-' ||
    substr(md5(lower(trim(coalesce(p_player_name, ''))) || ':' || lower(trim(coalesce(p_sport_type, '')))), 9, 4) || '-' ||
    substr(md5(lower(trim(coalesce(p_player_name, ''))) || ':' || lower(trim(coalesce(p_sport_type, '')))), 13, 4) || '-' ||
    substr(md5(lower(trim(coalesce(p_player_name, ''))) || ':' || lower(trim(coalesce(p_sport_type, '')))), 17, 4) || '-' ||
    substr(md5(lower(trim(coalesce(p_player_name, ''))) || ':' || lower(trim(coalesce(p_sport_type, '')))), 21, 12)
  )::uuid;
$$;

CREATE OR REPLACE FUNCTION public.matchlife_infer_sport(
  p_source TEXT,
  p_tournament_name TEXT,
  p_event_key TEXT,
  p_category TEXT
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN concat_ws(' ', lower(coalesce(p_source, '')), lower(coalesce(p_tournament_name, '')), lower(coalesce(p_event_key, '')), lower(coalesce(p_category, ''))) ~ '网球|tennis|atp|wta' THEN 'tennis'
    WHEN concat_ws(' ', lower(coalesce(p_source, '')), lower(coalesce(p_tournament_name, '')), lower(coalesce(p_event_key, '')), lower(coalesce(p_category, ''))) ~ '篮球|basketball' THEN 'basketball'
    WHEN concat_ws(' ', lower(coalesce(p_source, '')), lower(coalesce(p_tournament_name, '')), lower(coalesce(p_event_key, '')), lower(coalesce(p_category, ''))) ~ '足球|football|soccer' THEN 'football'
    WHEN concat_ws(' ', lower(coalesce(p_source, '')), lower(coalesce(p_tournament_name, '')), lower(coalesce(p_event_key, '')), lower(coalesce(p_category, ''))) ~ '乒乓|table.?tennis|ping.?pong' THEN 'tabletennis'
    ELSE 'badminton'
  END;
$$;

DROP MATERIALIZED VIEW IF EXISTS public.mv_player_rankings_history_cache;

CREATE MATERIALIZED VIEW public.mv_player_rankings_history_cache AS
WITH historical_player_matches AS (
  SELECT
    trim(players.player_name) AS player_name,
    public.matchlife_infer_sport(m.source, m.tournament_name, m.event_key, m.category) AS primary_sport,
    CASE
      WHEN players.side = 'A' AND m.winner_side = 'A' THEN 1
      WHEN players.side = 'B' AND m.winner_side = 'B' THEN 1
      ELSE 0
    END AS is_win,
    COALESCE(m.start_time, m.match_ended_at, m.match_started_at, m.source_updated_at, m.updated_at, m.created_at) AS last_active
  FROM public.matches m
  CROSS JOIN LATERAL (
    SELECT 'A'::TEXT AS side, unnest(m.players_a) AS player_name
    UNION ALL
    SELECT 'B'::TEXT AS side, unnest(m.players_b) AS player_name
  ) players
  WHERE m.winner_side IN ('A', 'B')
    AND trim(players.player_name) <> ''
    AND COALESCE(m.source_updated_at, m.updated_at, m.created_at, m.start_time) < (NOW() - INTERVAL '24 hours')
)
SELECT
  public.matchlife_player_rank_uuid(player_name, primary_sport) AS player_id,
  player_name,
  primary_sport,
  COUNT(*)::BIGINT AS total_matches,
  SUM(is_win)::BIGINT AS wins,
  ROUND((SUM(is_win)::NUMERIC / NULLIF(COUNT(*), 0)) * 100, 2) AS win_rate,
  MAX(last_active) AS last_active
FROM historical_player_matches
GROUP BY player_name, primary_sport;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_player_rankings_history_cache_player_id
  ON public.mv_player_rankings_history_cache(player_id);

CREATE INDEX IF NOT EXISTS idx_mv_player_rankings_history_cache_sport_rank
  ON public.mv_player_rankings_history_cache(primary_sport, win_rate DESC, wins DESC, total_matches DESC, last_active DESC);

CREATE INDEX IF NOT EXISTS idx_mv_player_rankings_history_cache_last_active
  ON public.mv_player_rankings_history_cache(last_active DESC);

CREATE OR REPLACE FUNCTION public.get_player_rankings(
  page_limit INT DEFAULT 20,
  page_offset INT DEFAULT 0,
  sport_type TEXT DEFAULT NULL
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
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH recent_player_matches AS (
    SELECT
      trim(players.player_name) AS player_name,
      public.matchlife_infer_sport(m.source, m.tournament_name, m.event_key, m.category) AS primary_sport,
      CASE
        WHEN players.side = 'A' AND m.winner_side = 'A' THEN 1
        WHEN players.side = 'B' AND m.winner_side = 'B' THEN 1
        ELSE 0
      END AS is_win,
      COALESCE(m.start_time, m.match_ended_at, m.match_started_at, m.source_updated_at, m.updated_at, m.created_at) AS last_active
    FROM public.matches m
    CROSS JOIN LATERAL (
      SELECT 'A'::TEXT AS side, unnest(m.players_a) AS player_name
      UNION ALL
      SELECT 'B'::TEXT AS side, unnest(m.players_b) AS player_name
    ) players
    WHERE m.winner_side IN ('A', 'B')
      AND trim(players.player_name) <> ''
      AND COALESCE(m.source_updated_at, m.updated_at, m.created_at, m.start_time) >= (NOW() - INTERVAL '24 hours')
  ),
  recent_rankings AS (
    SELECT
      public.matchlife_player_rank_uuid(player_name, primary_sport) AS player_id,
      player_name,
      primary_sport,
      COUNT(*)::BIGINT AS total_matches,
      SUM(is_win)::BIGINT AS wins,
      ROUND((SUM(is_win)::NUMERIC / NULLIF(COUNT(*), 0)) * 100, 2) AS win_rate,
      MAX(last_active) AS last_active
    FROM recent_player_matches
    GROUP BY player_name, primary_sport
  ),
  merged_rankings AS (
    SELECT
      public.matchlife_player_rank_uuid(player_name, primary_sport) AS player_id,
      player_name,
      primary_sport,
      SUM(total_matches)::BIGINT AS total_matches,
      SUM(wins)::BIGINT AS wins,
      ROUND((SUM(wins)::NUMERIC / NULLIF(SUM(total_matches), 0)) * 100, 2) AS win_rate,
      MAX(last_active) AS last_active
    FROM (
      SELECT player_name, primary_sport, total_matches, wins, last_active
      FROM public.mv_player_rankings_history_cache
      UNION ALL
      SELECT player_name, primary_sport, total_matches, wins, last_active
      FROM recent_rankings
    ) all_rankings
    GROUP BY player_name, primary_sport
  ),
  enriched_rankings AS (
    SELECT
      ranking.player_id,
      ranking.player_name,
      ranking.primary_sport,
      profile.avatar_url,
      ranking.total_matches,
      ranking.wins,
      ranking.win_rate,
      ranking.last_active
    FROM merged_rankings ranking
    LEFT JOIN LATERAL (
      SELECT p.avatar_url
      FROM public.players p
      WHERE p.player_name = ranking.player_name
        AND COALESCE(NULLIF(p.primary_sport, ''), ranking.primary_sport) = ranking.primary_sport
      ORDER BY (p.status = 'active') DESC, p.updated_at DESC NULLS LAST, p.created_at DESC NULLS LAST
      LIMIT 1
    ) profile ON TRUE
    WHERE sport_type IS NULL OR ranking.primary_sport = sport_type
  )
  SELECT
    ROW_NUMBER() OVER (
      ORDER BY win_rate DESC, wins DESC, total_matches DESC, last_active DESC, player_name ASC
    )::BIGINT AS rank,
    player_id,
    player_name::VARCHAR,
    avatar_url,
    total_matches,
    wins,
    win_rate,
    last_active
  FROM enriched_rankings
  ORDER BY win_rate DESC, wins DESC, total_matches DESC, last_active DESC, player_name ASC
  LIMIT page_limit
  OFFSET page_offset;
$$;

CREATE OR REPLACE FUNCTION public.refresh_player_rankings()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_player_rankings_history_cache;
END;
$$;

REVOKE ALL ON FUNCTION public.get_player_rankings(INT, INT, TEXT) FROM PUBLIC;
GRANT SELECT ON TABLE public.mv_player_rankings_history_cache TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_player_rankings(INT, INT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.refresh_player_rankings() TO service_role;
