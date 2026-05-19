DROP FUNCTION IF EXISTS public.matchlife_search_matches(TEXT, DATE, DATE, TEXT, TEXT, INT);

CREATE FUNCTION public.matchlife_search_matches(
  p_keyword TEXT DEFAULT NULL,
  p_date_from DATE DEFAULT NULL,
  p_date_to DATE DEFAULT NULL,
  p_category_filter TEXT DEFAULT NULL,
  p_tournament_filter TEXT DEFAULT NULL,
  p_limit INT DEFAULT 20
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
      nullif(trim(coalesce(p_keyword, '')), '') AS keyword,
      nullif(trim(coalesce(p_category_filter, '')), '') AS category_filter,
      nullif(trim(coalesce(p_tournament_filter, '')), '') AS tournament_filter,
      LEAST(GREATEST(coalesce(p_limit, 20), 1), 50) AS row_limit
  ),
  cache_rows AS (
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
      c.cache_status AS data_stage,
      CASE
        WHEN c.cache_status = 'ACTIVE' THEN '实时比分'
        WHEN c.cache_status = 'READY_TO_PERSIST' THEN '结果待入库'
        ELSE '缓存结果'
      END AS stage_label,
      CASE
        WHEN c.cache_status = 'ACTIVE' THEN '比赛进行中，当前比分来自 active_match_cache 实时缓存。'
        WHEN c.cache_status = 'READY_TO_PERSIST' THEN '比赛已结束，结果已进入缓存，正式战绩正在入库。'
        ELSE NULL
      END AS stage_hint,
      TRUE AS is_realtime,
      CASE
        WHEN p.keyword IS NULL THEN 0
        WHEN coalesce(c.tournament_name, '') ILIKE '%' || p.keyword || '%' THEN 0
        WHEN coalesce(c.players_text, '') ILIKE '%' || p.keyword || '%' THEN 1
        WHEN coalesce(c.event_key, '') ILIKE '%' || p.keyword || '%' THEN 2
        WHEN coalesce(c.round_name, '') ILIKE '%' || p.keyword || '%' THEN 3
        ELSE 4
      END AS search_rank,
      0 AS realtime_rank,
      COALESCE(c.match_started_at, c.start_time, c.source_updated_at, c.last_seen_at) AS primary_sort_at,
      COALESCE(c.source_updated_at, c.last_seen_at, c.start_time, c.match_started_at) AS secondary_sort_at
    FROM public.active_match_cache c
    LEFT JOIN public.matches m ON m.ymq_match_id = c.ymq_match_id
    CROSS JOIN params p
    WHERE c.cache_status IN ('ACTIVE', 'READY_TO_PERSIST')
      AND (
        p_date_from IS NULL
        OR COALESCE(c.start_time::date, c.match_started_at::date, c.source_updated_at::date) >= p_date_from
      )
      AND (
        p_date_to IS NULL
        OR COALESCE(c.start_time::date, c.match_started_at::date, c.source_updated_at::date) <= p_date_to
      )
      AND (p.category_filter IS NULL OR coalesce(c.category, '') ILIKE '%' || p.category_filter || '%')
      AND (p.tournament_filter IS NULL OR coalesce(c.tournament_name, '') ILIKE '%' || p.tournament_filter || '%')
      AND (
        p.keyword IS NULL
        OR coalesce(c.tournament_name, '') ILIKE '%' || p.keyword || '%'
        OR coalesce(c.players_text, '') ILIKE '%' || p.keyword || '%'
        OR coalesce(c.event_key, '') ILIKE '%' || p.keyword || '%'
        OR coalesce(c.round_name, '') ILIKE '%' || p.keyword || '%'
        OR coalesce(c.match_time_name, '') ILIKE '%' || p.keyword || '%'
        OR coalesce(c.category, '') ILIKE '%' || p.keyword || '%'
        OR coalesce(c.city, '') ILIKE '%' || p.keyword || '%'
        OR coalesce(c.location, '') ILIKE '%' || p.keyword || '%'
      )
  ),
  history_rows AS (
    SELECT
      m.id,
      m.id AS detail_match_id,
      m.category,
      m.tournament_name,
      m.start_time,
      m.source_updated_at,
      m.match_started_at,
      m.match_ended_at,
      m.match_time_name,
      m.city,
      m.location,
      m.players_a,
      m.players_b,
      m.score_text,
      m.winner_side,
      m.event_key,
      m.round_name,
      'DATABASE'::TEXT AS data_stage,
      NULL::TEXT AS stage_label,
      NULL::TEXT AS stage_hint,
      FALSE AS is_realtime,
      CASE
        WHEN p.keyword IS NULL THEN 0
        WHEN coalesce(m.tournament_name, '') ILIKE '%' || p.keyword || '%' THEN 0
        WHEN coalesce(m.players_text, '') ILIKE '%' || p.keyword || '%' THEN 1
        WHEN coalesce(m.event_key, '') ILIKE '%' || p.keyword || '%' THEN 2
        WHEN coalesce(m.round_name, '') ILIKE '%' || p.keyword || '%' THEN 3
        ELSE 4
      END AS search_rank,
      1 AS realtime_rank,
      COALESCE(m.start_time, m.source_updated_at, m.match_started_at, m.match_ended_at) AS primary_sort_at,
      COALESCE(m.source_updated_at, m.match_ended_at, m.match_started_at, m.start_time) AS secondary_sort_at
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
      AND NOT EXISTS (
        SELECT 1
        FROM public.active_match_cache c
        WHERE c.ymq_match_id = m.ymq_match_id
          AND c.cache_status IN ('ACTIVE', 'READY_TO_PERSIST')
      )
  ),
  combined AS (
    SELECT * FROM cache_rows
    UNION ALL
    SELECT * FROM history_rows
  )
  SELECT
    id,
    detail_match_id,
    category,
    tournament_name,
    start_time,
    source_updated_at,
    match_started_at,
    match_ended_at,
    match_time_name,
    city,
    location,
    players_a,
    players_b,
    score_text,
    winner_side,
    event_key,
    round_name,
    data_stage,
    stage_label,
    stage_hint,
    is_realtime
  FROM combined
  ORDER BY
    search_rank,
    realtime_rank,
    primary_sort_at DESC NULLS LAST,
    secondary_sort_at DESC NULLS LAST
  LIMIT (SELECT row_limit FROM params);
$$;

REVOKE ALL ON FUNCTION public.matchlife_search_matches(TEXT, DATE, DATE, TEXT, TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.matchlife_search_matches(TEXT, DATE, DATE, TEXT, TEXT, INT) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
