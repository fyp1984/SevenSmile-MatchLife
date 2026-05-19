CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_active_match_cache_tournament_name_trgm
  ON public.active_match_cache USING gin (tournament_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_active_match_cache_players_text_trgm
  ON public.active_match_cache USING gin (players_text gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_active_match_cache_event_key_trgm
  ON public.active_match_cache USING gin (event_key gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_active_match_cache_round_name_trgm
  ON public.active_match_cache USING gin (round_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_active_match_cache_match_time_name_trgm
  ON public.active_match_cache USING gin (match_time_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_active_match_cache_category_trgm
  ON public.active_match_cache USING gin (category gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_active_match_cache_city_trgm
  ON public.active_match_cache USING gin (city gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_active_match_cache_location_trgm
  ON public.active_match_cache USING gin (location gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_active_match_cache_source_match_snapshot
  ON public.active_match_cache (source_match_id, snapshot_version DESC);

CREATE INDEX IF NOT EXISTS idx_active_match_cache_canonical_lookup
  ON public.active_match_cache (
    canonical_match_id,
    snapshot_version DESC,
    source_priority ASC,
    source_updated_at DESC NULLS LAST
  );

CREATE INDEX IF NOT EXISTS idx_matches_source_match_snapshot
  ON public.matches (source_match_id, snapshot_version DESC);

CREATE INDEX IF NOT EXISTS idx_matches_canonical_lookup
  ON public.matches (
    canonical_match_id,
    snapshot_version DESC,
    source_priority ASC,
    source_updated_at DESC NULLS LAST
  );

CREATE INDEX IF NOT EXISTS idx_matches_stable_tournament_lookup
  ON public.matches (
    (trim(coalesce(tournament_name, ''))),
    persisted_from_cache_at DESC,
    source_updated_at DESC,
    start_time DESC
  )
  WHERE coalesce(persist_version, 0) > 0
    AND persisted_from_cache_at IS NOT NULL
    AND coalesce(lifecycle_status, '') IN ('persisted', 'archived')
    AND coalesce(match_status, 'UNKNOWN') NOT IN ('LIVE', 'UNKNOWN');

CREATE OR REPLACE FUNCTION public.matchlife_search_matches(
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
      coalesce(c.canonical_match_id, 'cache:' || c.id::TEXT) AS entity_key,
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
        PARTITION BY coalesce(c.canonical_match_id, 'cache:' || c.id::TEXT)
        ORDER BY
          c.snapshot_version DESC,
          c.source_priority ASC,
          coalesce(c.source_updated_at, c.last_seen_at, c.match_started_at, c.start_time) DESC NULLS LAST,
          c.updated_at DESC NULLS LAST,
          c.id DESC
      ) AS canonical_rank
    FROM public.active_match_cache c
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
      persisted.id AS detail_match_id,
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
    LEFT JOIN LATERAL (
      SELECT m.id
      FROM public.matches m
      WHERE c.canonical_match_id IS NOT NULL
        AND m.canonical_match_id = c.canonical_match_id
      ORDER BY
        m.snapshot_version DESC,
        m.source_priority ASC,
        coalesce(m.source_updated_at, m.match_ended_at, m.match_started_at, m.start_time, m.updated_at, m.created_at) DESC NULLS LAST,
        m.id DESC
      LIMIT 1
    ) persisted ON TRUE
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

CREATE OR REPLACE FUNCTION public.matchlife_get_tournament_stats_readiness(
  p_tournament_name TEXT
)
RETURNS TABLE (
  scope_type TEXT,
  scope_key TEXT,
  scope_label TEXT,
  scope_summary TEXT,
  scope_status TEXT,
  is_paused BOOLEAN,
  primary_reason_code TEXT,
  pause_reason TEXT,
  recovery_hint TEXT,
  affected_match_count INT,
  active_cached_count INT,
  pending_persist_count INT,
  persist_failed_count INT,
  manual_review_count INT,
  quality_blocked_count INT,
  affected_sources TEXT[],
  affected_tournaments TEXT[],
  latest_source_updated_at TIMESTAMPTZ,
  last_persisted_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH params AS (
    SELECT coalesce(nullif(trim(p_tournament_name), ''), '未选择赛事') AS scope_label
  ),
  blocking AS (
    SELECT
      c.source,
      coalesce(nullif(trim(c.tournament_name), ''), '未命名赛事') AS tournament_name,
      public.matchlife_stats_blocking_state_code(
        c.cache_status,
        c.lifecycle_status,
        c.match_status
      ) AS reason_code,
      c.source_updated_at
    FROM public.active_match_cache c
    CROSS JOIN params p
    WHERE trim(coalesce(c.tournament_name, '')) = p.scope_label
      AND (
        c.lifecycle_status IN ('manual_review', 'quality_blocked', 'persist_failed', 'pending_persist', 'normalized', 'hot_cached')
        OR c.cache_status IN ('READY_TO_PERSIST', 'ACTIVE')
        OR c.match_status = 'LIVE'
      )
  ),
  agg AS (
    SELECT
      count(*) FILTER (WHERE reason_code IS NOT NULL)::INT AS affected_match_count,
      count(*) FILTER (WHERE reason_code = 'active_cached')::INT AS active_cached_count,
      count(*) FILTER (WHERE reason_code = 'pending_persist')::INT AS pending_persist_count,
      count(*) FILTER (WHERE reason_code = 'persist_failed')::INT AS persist_failed_count,
      count(*) FILTER (WHERE reason_code = 'manual_review')::INT AS manual_review_count,
      count(*) FILTER (WHERE reason_code = 'quality_blocked')::INT AS quality_blocked_count,
      coalesce(array_agg(DISTINCT source) FILTER (WHERE reason_code IS NOT NULL AND source IS NOT NULL), '{}'::TEXT[]) AS affected_sources,
      coalesce(array_agg(DISTINCT tournament_name) FILTER (WHERE reason_code IS NOT NULL AND tournament_name IS NOT NULL), '{}'::TEXT[]) AS affected_tournaments,
      max(source_updated_at) FILTER (WHERE reason_code IS NOT NULL) AS latest_source_updated_at
    FROM blocking
  )
  SELECT
    'tournament'::TEXT AS scope_type,
    concat('tournament:', p.scope_label) AS scope_key,
    p.scope_label,
    public.matchlife_stats_scope_summary('tournament', p.scope_label) AS scope_summary,
    CASE WHEN a.affected_match_count > 0 THEN 'paused' ELSE 'ready' END AS scope_status,
    a.affected_match_count > 0 AS is_paused,
    public.matchlife_stats_primary_reason_code(
      a.active_cached_count,
      a.pending_persist_count,
      a.persist_failed_count,
      a.manual_review_count,
      a.quality_blocked_count
    ) AS primary_reason_code,
    public.matchlife_stats_pause_reason_text(
      'tournament',
      p.scope_label,
      public.matchlife_stats_primary_reason_code(
        a.active_cached_count,
        a.pending_persist_count,
        a.persist_failed_count,
        a.manual_review_count,
        a.quality_blocked_count
      ),
      a.active_cached_count,
      a.pending_persist_count,
      a.persist_failed_count,
      a.manual_review_count,
      a.quality_blocked_count
    ) AS pause_reason,
    public.matchlife_stats_recovery_hint_text(
      public.matchlife_stats_primary_reason_code(
        a.active_cached_count,
        a.pending_persist_count,
        a.persist_failed_count,
        a.manual_review_count,
        a.quality_blocked_count
      )
    ) AS recovery_hint,
    a.affected_match_count,
    a.active_cached_count,
    a.pending_persist_count,
    a.persist_failed_count,
    a.manual_review_count,
    a.quality_blocked_count,
    a.affected_sources,
    a.affected_tournaments,
    a.latest_source_updated_at,
    (SELECT last_persisted_at FROM public.sync_runtime_state LIMIT 1) AS last_persisted_at
  FROM params p
  CROSS JOIN agg a;
$$;

REVOKE ALL ON FUNCTION public.matchlife_search_matches(TEXT, DATE, DATE, TEXT, TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.matchlife_search_matches(TEXT, DATE, DATE, TEXT, TEXT, INT) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.matchlife_get_tournament_stats_readiness(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.matchlife_get_tournament_stats_readiness(TEXT) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
