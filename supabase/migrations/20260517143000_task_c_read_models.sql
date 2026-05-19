CREATE OR REPLACE FUNCTION public.matchlife_read_stage_label(
  p_match_status TEXT,
  p_lifecycle_status TEXT,
  p_is_realtime BOOLEAN DEFAULT FALSE,
  p_is_fallback BOOLEAN DEFAULT FALSE
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_is_fallback OR coalesce(p_lifecycle_status, '') IN ('manual_review', 'quality_blocked') THEN '降级展示'
    WHEN coalesce(p_lifecycle_status, '') IN ('pending_persist', 'persist_failed') THEN '待落库'
    WHEN p_is_realtime OR coalesce(p_lifecycle_status, '') IN ('hot_cached', 'normalized') OR coalesce(p_match_status, '') = 'LIVE' THEN '实时同步中'
    WHEN coalesce(p_lifecycle_status, '') IN ('persisted', 'archived') THEN '已正式入库'
    ELSE '已正式入库'
  END;
$$;

CREATE OR REPLACE FUNCTION public.matchlife_read_stage_hint(
  p_match_status TEXT,
  p_lifecycle_status TEXT,
  p_is_realtime BOOLEAN DEFAULT FALSE,
  p_is_fallback BOOLEAN DEFAULT FALSE
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_is_fallback OR coalesce(p_lifecycle_status, '') IN ('manual_review', 'quality_blocked')
      THEN '当前未命中可用热缓存，页面先展示最近一版正式快照，并继续通过轮询等待实时链路恢复。'
    WHEN coalesce(p_lifecycle_status, '') IN ('pending_persist', 'persist_failed')
      THEN '比赛结果已进入热缓存，正式库仍在写入或补偿重试中，页面会继续轮询刷新。'
    WHEN p_is_realtime OR coalesce(p_lifecycle_status, '') IN ('hot_cached', 'normalized') OR coalesce(p_match_status, '') = 'LIVE'
      THEN '比赛进行中，比分优先来自 active_match_cache 热缓存，并通过轮询持续刷新。'
    WHEN coalesce(p_lifecycle_status, '') IN ('persisted', 'archived')
      THEN '当前结果已正式入库，页面展示稳定历史快照。'
    ELSE '当前结果来自统一读模型。'
  END;
$$;

CREATE OR REPLACE FUNCTION public.matchlife_read_priority(
  p_match_status TEXT,
  p_lifecycle_status TEXT,
  p_is_realtime BOOLEAN DEFAULT FALSE,
  p_is_fallback BOOLEAN DEFAULT FALSE
)
RETURNS INT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_is_realtime OR coalesce(p_lifecycle_status, '') IN ('hot_cached', 'normalized') OR coalesce(p_match_status, '') = 'LIVE' THEN 0
    WHEN coalesce(p_lifecycle_status, '') IN ('pending_persist', 'persist_failed') THEN 1
    WHEN p_is_fallback OR coalesce(p_lifecycle_status, '') IN ('manual_review', 'quality_blocked') THEN 2
    ELSE 3
  END;
$$;

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
  detail_match_ref TEXT,
  canonical_match_id TEXT,
  source_match_id TEXT,
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
  match_status TEXT,
  lifecycle_status TEXT,
  snapshot_version BIGINT,
  stage_label TEXT,
  stage_hint TEXT,
  is_realtime BOOLEAN,
  is_fallback BOOLEAN
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
  cache_ranked AS (
    SELECT
      c.*,
      persisted.id AS persisted_match_id,
      coalesce(c.canonical_match_id, persisted.canonical_match_id, 'cache:' || c.id::TEXT) AS entity_key,
      public.matchlife_read_priority(
        c.match_status,
        c.lifecycle_status,
        c.cache_status = 'ACTIVE',
        FALSE
      ) AS read_priority,
      CASE
        WHEN p.keyword IS NULL THEN 0
        WHEN coalesce(c.tournament_name, '') ILIKE '%' || p.keyword || '%' THEN 0
        WHEN coalesce(c.players_text, '') ILIKE '%' || p.keyword || '%' THEN 1
        WHEN coalesce(c.event_key, '') ILIKE '%' || p.keyword || '%' THEN 2
        WHEN coalesce(c.round_name, '') ILIKE '%' || p.keyword || '%' THEN 3
        ELSE 4
      END AS search_rank,
      row_number() OVER (
        PARTITION BY coalesce(c.canonical_match_id, persisted.canonical_match_id, 'cache:' || c.id::TEXT)
        ORDER BY
          c.snapshot_version DESC,
          c.source_priority ASC,
          coalesce(c.source_updated_at, c.last_seen_at, c.match_started_at, c.start_time) DESC NULLS LAST,
          c.updated_at DESC NULLS LAST,
          c.id DESC
      ) AS canonical_rank
    FROM public.active_match_cache c
    LEFT JOIN LATERAL (
      SELECT m.id, m.canonical_match_id
      FROM public.matches m
      WHERE m.canonical_match_id IS NOT DISTINCT FROM c.canonical_match_id
      ORDER BY
        m.snapshot_version DESC,
        m.source_priority ASC,
        coalesce(m.source_updated_at, m.match_ended_at, m.match_started_at, m.start_time, m.updated_at, m.created_at) DESC NULLS LAST,
        m.id DESC
      LIMIT 1
    ) persisted ON TRUE
    CROSS JOIN params p
    WHERE c.cache_status IN ('ACTIVE', 'READY_TO_PERSIST')
      AND (
        p_date_from IS NULL
        OR coalesce(c.start_time::DATE, c.match_started_at::DATE, c.source_updated_at::DATE) >= p_date_from
      )
      AND (
        p_date_to IS NULL
        OR coalesce(c.start_time::DATE, c.match_started_at::DATE, c.source_updated_at::DATE) <= p_date_to
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
  cache_rows AS (
    SELECT
      c.id,
      c.persisted_match_id AS detail_match_id,
      coalesce(c.canonical_match_id, c.id::TEXT) AS detail_match_ref,
      c.canonical_match_id,
      c.source_match_id,
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
      c.match_status,
      c.lifecycle_status,
      c.snapshot_version,
      public.matchlife_read_stage_label(
        c.match_status,
        c.lifecycle_status,
        c.cache_status = 'ACTIVE',
        FALSE
      ) AS stage_label,
      public.matchlife_read_stage_hint(
        c.match_status,
        c.lifecycle_status,
        c.cache_status = 'ACTIVE',
        FALSE
      ) AS stage_hint,
      c.cache_status = 'ACTIVE' AS is_realtime,
      FALSE AS is_fallback,
      c.search_rank,
      c.read_priority,
      coalesce(c.source_updated_at, c.last_seen_at, c.match_started_at, c.start_time) AS primary_sort_at,
      c.entity_key
    FROM cache_ranked c
    WHERE c.canonical_rank = 1
  ),
  history_ranked AS (
    SELECT
      m.*,
      coalesce(m.canonical_match_id, 'db:' || m.id::TEXT) AS entity_key,
      CASE
        WHEN m.match_status = 'LIVE' OR m.lifecycle_status IN ('persist_failed', 'manual_review', 'quality_blocked') THEN TRUE
        ELSE FALSE
      END AS is_fallback,
      public.matchlife_read_priority(
        m.match_status,
        m.lifecycle_status,
        FALSE,
        CASE
          WHEN m.match_status = 'LIVE' OR m.lifecycle_status IN ('persist_failed', 'manual_review', 'quality_blocked') THEN TRUE
          ELSE FALSE
        END
      ) AS read_priority,
      CASE
        WHEN p.keyword IS NULL THEN 0
        WHEN coalesce(m.tournament_name, '') ILIKE '%' || p.keyword || '%' THEN 0
        WHEN coalesce(m.players_text, '') ILIKE '%' || p.keyword || '%' THEN 1
        WHEN coalesce(m.event_key, '') ILIKE '%' || p.keyword || '%' THEN 2
        WHEN coalesce(m.round_name, '') ILIKE '%' || p.keyword || '%' THEN 3
        ELSE 4
      END AS search_rank,
      row_number() OVER (
        PARTITION BY coalesce(m.canonical_match_id, 'db:' || m.id::TEXT)
        ORDER BY
          m.snapshot_version DESC,
          m.source_priority ASC,
          coalesce(m.source_updated_at, m.match_ended_at, m.match_started_at, m.start_time, m.updated_at, m.created_at) DESC NULLS LAST,
          m.id DESC
      ) AS canonical_rank
    FROM public.matches m
    CROSS JOIN params p
    WHERE (p_date_from IS NULL OR coalesce(m.start_time::DATE, m.match_started_at::DATE, m.source_updated_at::DATE) >= p_date_from)
      AND (p_date_to IS NULL OR coalesce(m.start_time::DATE, m.match_ended_at::DATE, m.source_updated_at::DATE) <= p_date_to)
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
  ),
  history_rows AS (
    SELECT
      h.id,
      h.id AS detail_match_id,
      coalesce(h.canonical_match_id, h.id::TEXT) AS detail_match_ref,
      h.canonical_match_id,
      h.source_match_id,
      h.category,
      h.tournament_name,
      h.start_time,
      h.source_updated_at,
      h.match_started_at,
      h.match_ended_at,
      h.match_time_name,
      h.city,
      h.location,
      h.players_a,
      h.players_b,
      h.score_text,
      h.winner_side,
      h.event_key,
      h.round_name,
      h.lifecycle_status AS data_stage,
      h.match_status,
      h.lifecycle_status,
      h.snapshot_version,
      public.matchlife_read_stage_label(
        h.match_status,
        h.lifecycle_status,
        FALSE,
        h.is_fallback
      ) AS stage_label,
      public.matchlife_read_stage_hint(
        h.match_status,
        h.lifecycle_status,
        FALSE,
        h.is_fallback
      ) AS stage_hint,
      FALSE AS is_realtime,
      h.is_fallback,
      h.search_rank,
      h.read_priority,
      coalesce(h.source_updated_at, h.match_ended_at, h.match_started_at, h.start_time, h.updated_at, h.created_at) AS primary_sort_at,
      h.entity_key
    FROM history_ranked h
    WHERE h.canonical_rank = 1
      AND NOT EXISTS (
        SELECT 1
        FROM cache_rows c
        WHERE c.entity_key = h.entity_key
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
    detail_match_ref,
    canonical_match_id,
    source_match_id,
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
    match_status,
    lifecycle_status,
    snapshot_version,
    stage_label,
    stage_hint,
    is_realtime,
    is_fallback
  FROM combined
  ORDER BY
    search_rank,
    read_priority,
    primary_sort_at DESC NULLS LAST,
    snapshot_version DESC NULLS LAST
  LIMIT (SELECT row_limit FROM params);
$$;

REVOKE ALL ON FUNCTION public.matchlife_search_matches(TEXT, DATE, DATE, TEXT, TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.matchlife_search_matches(TEXT, DATE, DATE, TEXT, TEXT, INT) TO anon, authenticated, service_role;

DROP FUNCTION IF EXISTS public.matchlife_get_match_detail(TEXT);

CREATE FUNCTION public.matchlife_get_match_detail(
  p_match_ref TEXT
)
RETURNS TABLE (
  id UUID,
  match_id UUID,
  persisted_match_id UUID,
  detail_match_ref TEXT,
  canonical_match_id TEXT,
  source_match_id TEXT,
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
  match_status TEXT,
  lifecycle_status TEXT,
  snapshot_version BIGINT,
  stage_label TEXT,
  stage_hint TEXT,
  is_realtime BOOLEAN,
  is_fallback BOOLEAN,
  has_persisted_match BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH input_ref AS (
    SELECT nullif(trim(coalesce(p_match_ref, '')), '') AS match_ref
  ),
  resolved AS (
    SELECT
      i.match_ref,
      coalesce(
        (
          SELECT m.canonical_match_id
          FROM public.matches m
          WHERE m.id::TEXT = i.match_ref
          LIMIT 1
        ),
        (
          SELECT c.canonical_match_id
          FROM public.active_match_cache c
          WHERE c.canonical_match_id = i.match_ref
          ORDER BY
            c.snapshot_version DESC,
            c.source_priority ASC,
            coalesce(c.source_updated_at, c.last_seen_at, c.match_started_at, c.start_time) DESC NULLS LAST
          LIMIT 1
        ),
        (
          SELECT m.canonical_match_id
          FROM public.matches m
          WHERE m.canonical_match_id = i.match_ref
          ORDER BY
            m.snapshot_version DESC,
            m.source_priority ASC,
            coalesce(m.source_updated_at, m.match_ended_at, m.match_started_at, m.start_time, m.updated_at, m.created_at) DESC NULLS LAST
          LIMIT 1
        ),
        (
          SELECT c.canonical_match_id
          FROM public.active_match_cache c
          WHERE c.source_match_id = i.match_ref OR c.ymq_match_id = i.match_ref
          ORDER BY
            c.snapshot_version DESC,
            c.source_priority ASC,
            coalesce(c.source_updated_at, c.last_seen_at, c.match_started_at, c.start_time) DESC NULLS LAST
          LIMIT 1
        ),
        (
          SELECT m.canonical_match_id
          FROM public.matches m
          WHERE m.source_match_id = i.match_ref OR m.ymq_match_id = i.match_ref
          ORDER BY
            m.snapshot_version DESC,
            m.source_priority ASC,
            coalesce(m.source_updated_at, m.match_ended_at, m.match_started_at, m.start_time, m.updated_at, m.created_at) DESC NULLS LAST
          LIMIT 1
        )
      ) AS canonical_match_id
    FROM input_ref i
  ),
  persisted_matches AS (
    SELECT
      m.*,
      row_number() OVER (
        ORDER BY
          CASE WHEN m.id::TEXT = r.match_ref THEN 0 ELSE 1 END,
          m.snapshot_version DESC,
          m.source_priority ASC,
          coalesce(m.source_updated_at, m.match_ended_at, m.match_started_at, m.start_time, m.updated_at, m.created_at) DESC NULLS LAST,
          m.id DESC
      ) AS match_rank
    FROM public.matches m
    CROSS JOIN resolved r
    WHERE (
      r.canonical_match_id IS NOT NULL
      AND m.canonical_match_id = r.canonical_match_id
    )
      OR m.id::TEXT = r.match_ref
  ),
  persisted_ref AS (
    SELECT id, canonical_match_id
    FROM persisted_matches
    WHERE match_rank = 1
  ),
  cache_candidates AS (
    SELECT
      c.*,
      coalesce(c.canonical_match_id, r.canonical_match_id, c.id::TEXT) AS detail_match_ref,
      row_number() OVER (
        ORDER BY
          public.matchlife_read_priority(
            c.match_status,
            c.lifecycle_status,
            c.cache_status = 'ACTIVE',
            FALSE
          ),
          c.snapshot_version DESC,
          c.source_priority ASC,
          coalesce(c.source_updated_at, c.last_seen_at, c.match_started_at, c.start_time) DESC NULLS LAST,
          c.updated_at DESC NULLS LAST,
          c.id DESC
      ) AS candidate_rank
    FROM public.active_match_cache c
    CROSS JOIN resolved r
    WHERE (
      r.canonical_match_id IS NOT NULL
      AND c.canonical_match_id = r.canonical_match_id
    )
      OR c.id::TEXT = r.match_ref
      OR c.source_match_id = r.match_ref
      OR c.ymq_match_id = r.match_ref
  ),
  history_candidates AS (
    SELECT
      m.*,
      CASE
        WHEN m.match_status = 'LIVE' OR m.lifecycle_status IN ('persist_failed', 'manual_review', 'quality_blocked') THEN TRUE
        ELSE FALSE
      END AS is_fallback,
      row_number() OVER (
        ORDER BY
          public.matchlife_read_priority(
            m.match_status,
            m.lifecycle_status,
            FALSE,
            CASE
              WHEN m.match_status = 'LIVE' OR m.lifecycle_status IN ('persist_failed', 'manual_review', 'quality_blocked') THEN TRUE
              ELSE FALSE
            END
          ),
          m.snapshot_version DESC,
          m.source_priority ASC,
          coalesce(m.source_updated_at, m.match_ended_at, m.match_started_at, m.start_time, m.updated_at, m.created_at) DESC NULLS LAST,
          m.id DESC
      ) AS candidate_rank
    FROM public.matches m
    CROSS JOIN resolved r
    WHERE (
      r.canonical_match_id IS NOT NULL
      AND m.canonical_match_id = r.canonical_match_id
    )
      OR m.id::TEXT = r.match_ref
      OR m.source_match_id = r.match_ref
      OR m.ymq_match_id = r.match_ref
  ),
  best_cache AS (
    SELECT * FROM cache_candidates WHERE candidate_rank = 1
  ),
  best_history AS (
    SELECT * FROM history_candidates WHERE candidate_rank = 1
  ),
  detail_row AS (
    SELECT
      c.id,
      pr.id AS match_id,
      pr.id AS persisted_match_id,
      c.detail_match_ref,
      c.canonical_match_id,
      c.source_match_id,
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
      c.match_status,
      c.lifecycle_status,
      c.snapshot_version,
      public.matchlife_read_stage_label(
        c.match_status,
        c.lifecycle_status,
        c.cache_status = 'ACTIVE',
        FALSE
      ) AS stage_label,
      public.matchlife_read_stage_hint(
        c.match_status,
        c.lifecycle_status,
        c.cache_status = 'ACTIVE',
        FALSE
      ) AS stage_hint,
      c.cache_status = 'ACTIVE' AS is_realtime,
      FALSE AS is_fallback,
      pr.id IS NOT NULL AS has_persisted_match,
      0 AS source_order,
      coalesce(c.source_updated_at, c.last_seen_at, c.match_started_at, c.start_time) AS sort_at
    FROM best_cache c
    LEFT JOIN persisted_ref pr ON pr.canonical_match_id IS NOT DISTINCT FROM c.canonical_match_id

    UNION ALL

    SELECT
      h.id,
      h.id AS match_id,
      h.id AS persisted_match_id,
      coalesce(h.canonical_match_id, h.id::TEXT) AS detail_match_ref,
      h.canonical_match_id,
      h.source_match_id,
      h.category,
      h.tournament_name,
      h.start_time,
      h.source_updated_at,
      h.match_started_at,
      h.match_ended_at,
      h.match_time_name,
      h.city,
      h.location,
      h.players_a,
      h.players_b,
      h.score_text,
      h.winner_side,
      h.event_key,
      h.round_name,
      h.lifecycle_status AS data_stage,
      h.match_status,
      h.lifecycle_status,
      h.snapshot_version,
      public.matchlife_read_stage_label(
        h.match_status,
        h.lifecycle_status,
        FALSE,
        h.is_fallback
      ) AS stage_label,
      public.matchlife_read_stage_hint(
        h.match_status,
        h.lifecycle_status,
        FALSE,
        h.is_fallback
      ) AS stage_hint,
      FALSE AS is_realtime,
      h.is_fallback,
      TRUE AS has_persisted_match,
      CASE WHEN h.is_fallback THEN 1 ELSE 2 END AS source_order,
      coalesce(h.source_updated_at, h.match_ended_at, h.match_started_at, h.start_time, h.updated_at, h.created_at) AS sort_at
    FROM best_history h
  )
  SELECT
    id,
    match_id,
    persisted_match_id,
    detail_match_ref,
    canonical_match_id,
    source_match_id,
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
    match_status,
    lifecycle_status,
    snapshot_version,
    stage_label,
    stage_hint,
    is_realtime,
    is_fallback,
    has_persisted_match
  FROM detail_row
  ORDER BY source_order, sort_at DESC NULLS LAST, snapshot_version DESC NULLS LAST
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.matchlife_get_match_detail(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.matchlife_get_match_detail(TEXT) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
