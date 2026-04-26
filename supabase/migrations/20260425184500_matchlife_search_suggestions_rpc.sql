CREATE OR REPLACE FUNCTION public.matchlife_search_suggestions(
  p_keyword TEXT,
  p_limit INT DEFAULT 8
)
RETURNS TABLE (
  suggestion TEXT,
  suggestion_type TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH params AS (
    SELECT
      nullif(trim(coalesce(p_keyword, '')), '') AS keyword,
      LEAST(GREATEST(coalesce(p_limit, 8), 1), 20) AS row_limit
  ),
  source_matches AS (
    SELECT
      m.tournament_name,
      m.players_a,
      m.players_b,
      m.players_text,
      m.start_time,
      m.source_updated_at
    FROM public.matches m
    CROSS JOIN params p
    WHERE p.keyword IS NOT NULL
      AND (
        coalesce(m.tournament_name, '') ILIKE '%' || p.keyword || '%'
        OR coalesce(m.players_text, '') ILIKE '%' || p.keyword || '%'
      )
    ORDER BY m.start_time DESC NULLS LAST, m.source_updated_at DESC NULLS LAST
    LIMIT 60
  ),
  tournament_rows AS (
    SELECT DISTINCT
      trim(tournament_name) AS suggestion,
      'tournament'::TEXT AS suggestion_type,
      0 AS priority
    FROM source_matches
    CROSS JOIN params p
    WHERE trim(coalesce(tournament_name, '')) <> ''
      AND lower(tournament_name) LIKE '%' || lower(p.keyword) || '%'
  ),
  player_rows AS (
    SELECT DISTINCT
      trim(player_name) AS suggestion,
      'player'::TEXT AS suggestion_type,
      1 AS priority
    FROM source_matches
    CROSS JOIN params p
    CROSS JOIN LATERAL unnest(coalesce(players_a, '{}'::TEXT[]) || coalesce(players_b, '{}'::TEXT[])) AS player_name
    WHERE trim(player_name) <> ''
      AND lower(player_name) LIKE '%' || lower(p.keyword) || '%'
  ),
  merged AS (
    SELECT * FROM tournament_rows
    UNION ALL
    SELECT * FROM player_rows
  )
  SELECT suggestion, suggestion_type
  FROM merged
  ORDER BY priority ASC, char_length(suggestion) ASC, suggestion ASC
  LIMIT (SELECT row_limit FROM params);
$$;

REVOKE ALL ON FUNCTION public.matchlife_search_suggestions(TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.matchlife_search_suggestions(TEXT, INT) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
