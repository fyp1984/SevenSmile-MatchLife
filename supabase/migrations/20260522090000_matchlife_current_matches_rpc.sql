DROP FUNCTION IF EXISTS public.matchlife_current_matches(TEXT, TEXT, INT);

CREATE FUNCTION public.matchlife_current_matches(
  p_tournament_filter TEXT DEFAULT NULL,
  p_session_filter TEXT DEFAULT NULL,
  p_limit INT DEFAULT 50
)
RETURNS TABLE (
  id UUID,
  detail_match_id UUID,
  category TEXT,
  tournament_name TEXT,
  start_time TIMESTAMPTZ,
  source_updated_at TIMESTAMPTZ,
  match_started_at TIMESTAMPTZ,
  match_ended_at TIMESTAMPTZ,
  match_time_name TEXT,
  city TEXT,
  location TEXT,
  players_a TEXT[],
  players_b TEXT[],
  score_text TEXT,
  winner_side TEXT,
  event_key TEXT,
  round_name TEXT,
  match_no INT,
  court_num INT,
  data_stage TEXT,
  stage_label TEXT,
  stage_hint TEXT,
  is_realtime BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH params AS (
    SELECT
      nullif(trim(coalesce(p_tournament_filter, '')), '') AS tournament_filter,
      nullif(trim(coalesce(p_session_filter, '')), '') AS session_filter,
      LEAST(GREATEST(coalesce(p_limit, 50), 1), 100) AS row_limit
  )
  SELECT
    COALESCE(m.id, c.id) AS id,
    m.id AS detail_match_id,
    c.category,
    c.tournament_name,
    c.start_time,
    c.source_updated_at,
    c.match_started_at,
    c.match_ended_at,
    c.match_time_name,
    c.city,
    c.location,
    c.players_a,
    c.players_b,
    c.score_text,
    c.winner_side,
    c.event_key,
    c.round_name,
    c.match_no,
    c.court_num,
    c.cache_status AS data_stage,
    '当前比分'::TEXT AS stage_label,
    '比赛进行中，比分来自实时缓存。'::TEXT AS stage_hint,
    TRUE AS is_realtime
  FROM public.active_match_cache c
  LEFT JOIN public.matches m ON m.ymq_match_id = c.ymq_match_id
  CROSS JOIN params p
  WHERE c.cache_status = 'ACTIVE'
    AND (p.tournament_filter IS NULL OR coalesce(c.tournament_name, '') ILIKE '%' || p.tournament_filter || '%')
    AND (
      p.session_filter IS NULL
      OR coalesce(c.round_name, '') ILIKE '%' || p.session_filter || '%'
      OR coalesce(c.match_time_name, '') ILIKE '%' || p.session_filter || '%'
      OR coalesce(c.match_no::text, '') ILIKE '%' || p.session_filter || '%'
      OR coalesce(c.court_num::text, '') ILIKE '%' || p.session_filter || '%'
    )
  ORDER BY COALESCE(c.source_updated_at, c.last_seen_at, c.match_started_at, c.start_time) DESC NULLS LAST
  LIMIT (SELECT row_limit FROM params);
$$;

REVOKE ALL ON FUNCTION public.matchlife_current_matches(TEXT, TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.matchlife_current_matches(TEXT, TEXT, INT) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
