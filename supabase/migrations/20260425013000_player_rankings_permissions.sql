GRANT SELECT ON TABLE public.mv_player_rankings TO anon, authenticated, service_role;

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
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
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
  FROM public.mv_player_rankings r
  WHERE (sport_type IS NULL OR r.primary_sport = sport_type)
  ORDER BY r.win_rate DESC, r.wins DESC, r.total_matches DESC
  LIMIT page_limit
  OFFSET page_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.get_player_rankings(INT, INT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_player_rankings(INT, INT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.refresh_player_rankings() TO service_role;
