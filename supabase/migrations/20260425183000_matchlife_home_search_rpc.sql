CREATE OR REPLACE FUNCTION public.matchlife_search_matches(
  p_keyword TEXT DEFAULT NULL,
  p_date_from DATE DEFAULT NULL,
  p_date_to DATE DEFAULT NULL,
  p_category_filter TEXT DEFAULT NULL,
  p_tournament_filter TEXT DEFAULT NULL,
  p_limit INT DEFAULT 20
)
RETURNS SETOF public.matches
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH params AS (
    SELECT
      nullif(trim(coalesce(p_keyword, '')), '') AS keyword,
      nullif(trim(coalesce(p_category_filter, '')), '') AS category_filter,
      nullif(trim(coalesce(p_tournament_filter, '')), '') AS tournament_filter,
      LEAST(GREATEST(coalesce(p_limit, 20), 1), 50) AS row_limit
  )
  SELECT m.*
  FROM public.matches m
  CROSS JOIN params p
  WHERE (p_date_from IS NULL OR m.start_time::date >= p_date_from)
    AND (p_date_to IS NULL OR m.start_time::date <= p_date_to)
    AND (p.category_filter IS NULL OR coalesce(m.category, '') ILIKE '%' || p.category_filter || '%')
    AND (p.tournament_filter IS NULL OR coalesce(m.tournament_name, '') ILIKE '%' || p.tournament_filter || '%')
    AND (
      p.keyword IS NULL
      OR coalesce(m.tournament_name, '') ILIKE '%' || p.keyword || '%'
      OR coalesce(m.players_text, '') ILIKE '%' || p.keyword || '%'
      OR coalesce(m.event_key, '') ILIKE '%' || p.keyword || '%'
      OR coalesce(m.round_name, '') ILIKE '%' || p.keyword || '%'
      OR coalesce(m.match_time_name, '') ILIKE '%' || p.keyword || '%'
      OR coalesce(m.category, '') ILIKE '%' || p.keyword || '%'
      OR coalesce(m.city, '') ILIKE '%' || p.keyword || '%'
      OR coalesce(m.location, '') ILIKE '%' || p.keyword || '%'
    )
  ORDER BY
    CASE
      WHEN p.keyword IS NULL THEN 0
      WHEN coalesce(m.tournament_name, '') ILIKE '%' || p.keyword || '%' THEN 0
      WHEN coalesce(m.players_text, '') ILIKE '%' || p.keyword || '%' THEN 1
      WHEN coalesce(m.event_key, '') ILIKE '%' || p.keyword || '%' THEN 2
      WHEN coalesce(m.round_name, '') ILIKE '%' || p.keyword || '%' THEN 3
      ELSE 4
    END,
    m.start_time DESC NULLS LAST,
    m.source_updated_at DESC NULLS LAST
  LIMIT (SELECT row_limit FROM params);
$$;

REVOKE ALL ON FUNCTION public.matchlife_search_matches(TEXT, DATE, DATE, TEXT, TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.matchlife_search_matches(TEXT, DATE, DATE, TEXT, TEXT, INT) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
