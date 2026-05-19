ALTER TABLE IF EXISTS public.active_match_cache
  ADD COLUMN IF NOT EXISTS sport_type TEXT NOT NULL DEFAULT 'badminton',
  ADD COLUMN IF NOT EXISTS source_match_id TEXT,
  ADD COLUMN IF NOT EXISTS canonical_match_id TEXT,
  ADD COLUMN IF NOT EXISTS dedupe_scope_key TEXT,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS match_status TEXT NOT NULL DEFAULT 'UNKNOWN'
    CHECK (match_status IN ('SCHEDULED', 'LIVE', 'FINISHED', 'CANCELLED', 'UNKNOWN')),
  ADD COLUMN IF NOT EXISTS lifecycle_status TEXT NOT NULL DEFAULT 'hot_cached'
    CHECK (lifecycle_status IN ('normalized', 'hot_cached', 'pending_persist', 'persisted', 'archived', 'persist_failed', 'quality_blocked', 'manual_review')),
  ADD COLUMN IF NOT EXISTS source_priority INT NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS snapshot_version BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS snapshot_captured_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cleanup_after TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archive_after TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS compensate_after TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS persist_attempts INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_persist_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_persist_error TEXT;

ALTER TABLE IF EXISTS public.matches
  ADD COLUMN IF NOT EXISTS sport_type TEXT NOT NULL DEFAULT 'badminton',
  ADD COLUMN IF NOT EXISTS source_match_id TEXT,
  ADD COLUMN IF NOT EXISTS canonical_match_id TEXT,
  ADD COLUMN IF NOT EXISTS dedupe_scope_key TEXT,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS match_status TEXT NOT NULL DEFAULT 'UNKNOWN'
    CHECK (match_status IN ('SCHEDULED', 'LIVE', 'FINISHED', 'CANCELLED', 'UNKNOWN')),
  ADD COLUMN IF NOT EXISTS lifecycle_status TEXT NOT NULL DEFAULT 'persisted'
    CHECK (lifecycle_status IN ('normalized', 'hot_cached', 'pending_persist', 'persisted', 'archived', 'persist_failed', 'quality_blocked', 'manual_review')),
  ADD COLUMN IF NOT EXISTS source_priority INT NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS snapshot_version BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS snapshot_captured_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS persisted_from_cache_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS persist_version INT NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION public.matchlife_normalize_identity(value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT trim(BOTH '-' FROM regexp_replace(lower(coalesce(value, '')), '[^[:alnum:]]+', '-', 'g'));
$$;

CREATE OR REPLACE FUNCTION public.matchlife_side_signature(players TEXT[])
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    (
      SELECT string_agg(public.matchlife_normalize_identity(item), '+' ORDER BY public.matchlife_normalize_identity(item))
      FROM unnest(coalesce(players, '{}'::TEXT[])) AS item
      WHERE nullif(trim(item), '') IS NOT NULL
    ),
    'na'
  );
$$;

CREATE OR REPLACE FUNCTION public.matchlife_build_canonical_match_id(
  p_sport_type TEXT,
  p_tournament_name TEXT,
  p_event_key TEXT,
  p_round_name TEXT,
  p_match_time_name TEXT,
  p_start_time TIMESTAMPTZ,
  p_match_started_at TIMESTAMPTZ,
  p_source_updated_at TIMESTAMPTZ,
  p_players_a TEXT[],
  p_players_b TEXT[]
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    coalesce(public.matchlife_normalize_identity(p_sport_type), 'sport')
    || ':'
    || md5(
      concat_ws(
        '|',
        coalesce(public.matchlife_normalize_identity(p_sport_type), 'sport'),
        coalesce(public.matchlife_normalize_identity(p_tournament_name), 'unknown-tournament'),
        coalesce(public.matchlife_normalize_identity(p_event_key), 'unknown-event'),
        coalesce(public.matchlife_normalize_identity(coalesce(p_round_name, p_match_time_name)), 'unknown-round'),
        coalesce(to_char(coalesce(p_start_time, p_match_started_at, p_source_updated_at), 'YYYY-MM-DD'), 'unknown-day'),
        public.matchlife_side_signature(p_players_a),
        public.matchlife_side_signature(p_players_b)
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.matchlife_build_dedupe_scope_key(
  p_sport_type TEXT,
  p_event_key TEXT,
  p_round_name TEXT,
  p_match_time_name TEXT,
  p_start_time TIMESTAMPTZ,
  p_match_started_at TIMESTAMPTZ,
  p_players_a TEXT[],
  p_players_b TEXT[]
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    coalesce(public.matchlife_normalize_identity(p_sport_type), 'sport')
    || ':'
    || substr(
      md5(
        concat_ws(
          '|',
          coalesce(public.matchlife_normalize_identity(p_sport_type), 'sport'),
          coalesce(public.matchlife_normalize_identity(p_event_key), 'unknown-event'),
          coalesce(public.matchlife_normalize_identity(coalesce(p_round_name, p_match_time_name)), 'unknown-round'),
          coalesce(to_char(coalesce(p_start_time, p_match_started_at), 'YYYY-MM-DD'), 'unknown-day'),
          public.matchlife_side_signature(p_players_a),
          public.matchlife_side_signature(p_players_b)
        )
      ),
      1,
      16
    );
$$;

CREATE OR REPLACE FUNCTION public.matchlife_resolve_match_status(
  p_winner_side TEXT,
  p_match_ended_at TIMESTAMPTZ,
  p_match_started_at TIMESTAMPTZ,
  p_source_status_no INT,
  p_score_text TEXT
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN coalesce(p_winner_side, 'UNKNOWN') IN ('A', 'B') OR p_match_ended_at IS NOT NULL OR p_source_status_no = 2 THEN 'FINISHED'
    WHEN p_match_started_at IS NOT NULL OR coalesce(nullif(p_score_text, ''), '') <> '' OR p_source_status_no IN (1, 3, 4, 5) THEN 'LIVE'
    WHEN p_source_status_no IN (0, 6) THEN 'SCHEDULED'
    ELSE 'UNKNOWN'
  END;
$$;

CREATE OR REPLACE FUNCTION public.matchlife_resolve_lifecycle_status(
  p_match_status TEXT,
  p_requested_lifecycle_status TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_requested_lifecycle_status IN ('normalized', 'hot_cached', 'pending_persist', 'persisted', 'archived', 'persist_failed', 'quality_blocked', 'manual_review')
      THEN p_requested_lifecycle_status
    WHEN p_match_status = 'FINISHED' THEN 'pending_persist'
    WHEN p_match_status = 'LIVE' THEN 'hot_cached'
    WHEN p_match_status = 'SCHEDULED' THEN 'normalized'
    ELSE 'normalized'
  END;
$$;

CREATE OR REPLACE FUNCTION public.matchlife_resolve_cache_status(
  p_match_status TEXT,
  p_lifecycle_status TEXT
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_lifecycle_status = 'persisted' THEN 'PERSISTED'
    WHEN p_lifecycle_status = 'archived' THEN 'STALE'
    WHEN p_lifecycle_status = 'persist_failed' THEN 'READY_TO_PERSIST'
    WHEN p_lifecycle_status IN ('quality_blocked', 'manual_review') THEN 'STALE'
    WHEN p_match_status = 'FINISHED' THEN 'READY_TO_PERSIST'
    WHEN p_match_status = 'LIVE' THEN 'ACTIVE'
    ELSE 'STALE'
  END;
$$;

UPDATE public.active_match_cache
SET
  source_match_id = coalesce(source_match_id, ymq_match_id),
  sport_type = coalesce(nullif(sport_type, ''), CASE WHEN source = 'tennis-json' THEN 'tennis' ELSE 'badminton' END),
  match_status = public.matchlife_resolve_match_status(winner_side, match_ended_at, match_started_at, source_status_no, score_text),
  lifecycle_status = CASE
    WHEN cache_status = 'PERSISTED' THEN 'persisted'
    WHEN cache_status = 'STALE' THEN 'archived'
    ELSE public.matchlife_resolve_lifecycle_status(
      public.matchlife_resolve_match_status(winner_side, match_ended_at, match_started_at, source_status_no, score_text),
      lifecycle_status
    )
  END,
  snapshot_captured_at = coalesce(snapshot_captured_at, source_updated_at, last_seen_at, updated_at, created_at, now()),
  snapshot_version = CASE
    WHEN snapshot_version > 0 THEN snapshot_version
    ELSE floor(extract(epoch FROM coalesce(source_updated_at, last_seen_at, updated_at, created_at, now())) * 1000)::BIGINT
  END,
  canonical_match_id = coalesce(
    canonical_match_id,
    public.matchlife_build_canonical_match_id(
      coalesce(nullif(sport_type, ''), CASE WHEN source = 'tennis-json' THEN 'tennis' ELSE 'badminton' END),
      tournament_name,
      event_key,
      round_name,
      match_time_name,
      start_time,
      match_started_at,
      source_updated_at,
      players_a,
      players_b
    )
  ),
  dedupe_scope_key = coalesce(
    dedupe_scope_key,
    public.matchlife_build_dedupe_scope_key(
      coalesce(nullif(sport_type, ''), CASE WHEN source = 'tennis-json' THEN 'tennis' ELSE 'badminton' END),
      event_key,
      round_name,
      match_time_name,
      start_time,
      match_started_at,
      players_a,
      players_b
    )
  ),
  idempotency_key = coalesce(
    idempotency_key,
    coalesce(source, 'unknown') || ':' || md5(
      concat_ws(
        '|',
        coalesce(source, 'unknown'),
        coalesce(source_match_id, ymq_match_id, ''),
        coalesce(raw_hash, ''),
        CASE
          WHEN snapshot_version > 0 THEN snapshot_version::TEXT
          ELSE floor(extract(epoch FROM coalesce(source_updated_at, last_seen_at, updated_at, created_at, now())) * 1000)::BIGINT::TEXT
        END
      )
    )
  ),
  cleanup_after = coalesce(
    cleanup_after,
    CASE
      WHEN cache_status = 'PERSISTED' THEN coalesce(persisted_at, updated_at, now()) + INTERVAL '6 hours'
      WHEN cache_status = 'STALE' THEN coalesce(last_seen_at, updated_at, now()) + INTERVAL '12 hours'
      ELSE NULL
    END
  ),
  archive_after = coalesce(
    archive_after,
    CASE
      WHEN cache_status = 'PERSISTED' THEN coalesce(persisted_at, updated_at, now()) + INTERVAL '30 days'
      ELSE NULL
    END
  );

UPDATE public.matches
SET
  source_match_id = coalesce(source_match_id, ymq_match_id),
  sport_type = coalesce(nullif(sport_type, ''), CASE WHEN source = 'tennis-json' THEN 'tennis' ELSE 'badminton' END),
  match_status = public.matchlife_resolve_match_status(winner_side, match_ended_at, match_started_at, NULL, score_text),
  lifecycle_status = 'persisted',
  snapshot_captured_at = coalesce(snapshot_captured_at, source_updated_at, match_ended_at, match_started_at, updated_at, created_at, now()),
  snapshot_version = CASE
    WHEN snapshot_version > 0 THEN snapshot_version
    ELSE floor(extract(epoch FROM coalesce(source_updated_at, match_ended_at, match_started_at, updated_at, created_at, now())) * 1000)::BIGINT
  END,
  canonical_match_id = coalesce(
    canonical_match_id,
    public.matchlife_build_canonical_match_id(
      coalesce(nullif(sport_type, ''), CASE WHEN source = 'tennis-json' THEN 'tennis' ELSE 'badminton' END),
      tournament_name,
      event_key,
      round_name,
      match_time_name,
      start_time,
      match_started_at,
      source_updated_at,
      players_a,
      players_b
    )
  ),
  dedupe_scope_key = coalesce(
    dedupe_scope_key,
    public.matchlife_build_dedupe_scope_key(
      coalesce(nullif(sport_type, ''), CASE WHEN source = 'tennis-json' THEN 'tennis' ELSE 'badminton' END),
      event_key,
      round_name,
      match_time_name,
      start_time,
      match_started_at,
      players_a,
      players_b
    )
  ),
  idempotency_key = coalesce(
    idempotency_key,
    coalesce(source, 'unknown') || ':' || md5(
      concat_ws(
        '|',
        coalesce(source, 'unknown'),
        coalesce(source_match_id, ymq_match_id, ''),
        coalesce(raw_hash, ''),
        CASE
          WHEN snapshot_version > 0 THEN snapshot_version::TEXT
          ELSE floor(extract(epoch FROM coalesce(source_updated_at, match_ended_at, match_started_at, updated_at, created_at, now())) * 1000)::BIGINT::TEXT
        END
      )
    )
  ),
  persisted_from_cache_at = coalesce(persisted_from_cache_at, updated_at, created_at, now());

CREATE INDEX IF NOT EXISTS idx_active_match_cache_canonical_status
  ON public.active_match_cache (canonical_match_id, cache_status, snapshot_version DESC);

CREATE INDEX IF NOT EXISTS idx_active_match_cache_lifecycle_status
  ON public.active_match_cache (lifecycle_status, cleanup_after ASC, compensate_after ASC);

CREATE INDEX IF NOT EXISTS idx_matches_canonical_snapshot
  ON public.matches (canonical_match_id, snapshot_version DESC);

CREATE INDEX IF NOT EXISTS idx_matches_match_status
  ON public.matches (match_status, source_updated_at DESC);

DROP VIEW IF EXISTS public.sync_runtime_state;

CREATE VIEW public.sync_runtime_state AS
SELECT
  COUNT(*) FILTER (WHERE cache_status = 'ACTIVE')::INT AS active_cached_count,
  COUNT(*) FILTER (WHERE cache_status = 'READY_TO_PERSIST')::INT AS pending_persist_count,
  COUNT(*) FILTER (WHERE cache_status = 'PERSISTED')::INT AS persisted_count,
  COUNT(*) FILTER (WHERE cache_status = 'STALE')::INT AS stale_count,
  COUNT(*) FILTER (WHERE lifecycle_status = 'persist_failed')::INT AS persist_failed_count,
  COUNT(*) FILTER (WHERE lifecycle_status = 'manual_review')::INT AS manual_review_count,
  MAX(source_updated_at) AS last_source_updated_at,
  MAX(last_seen_at) AS last_cache_seen_at,
  MAX(persisted_at) AS last_persisted_at
FROM public.active_match_cache;

GRANT SELECT ON public.sync_runtime_state TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.stage_live_matches(records jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  inserted_count INT := 0;
  updated_count INT := 0;
  skipped_count INT := 0;
  active_count INT := 0;
  ready_count INT := 0;
  filtered_count INT := 0;
  total_count INT := 0;
BEGIN
  IF records IS NULL OR jsonb_typeof(records) <> 'array' THEN
    RETURN jsonb_build_object(
      'cached_inserted_count', 0,
      'cached_updated_count', 0,
      'cached_skipped_count', 0,
      'active_cached_count', 0,
      'queued_persist_count', 0,
      'ignored_count', 0,
      'total_count', 0
    );
  END IF;

  WITH input AS (
    SELECT jsonb_array_elements(records) AS r
  ), parsed AS (
    SELECT
      COALESCE(NULLIF(r->>'source', ''), 'ymq') AS source,
      COALESCE(NULLIF(r->>'source_match_id', ''), NULLIF(r->>'ymq_match_id', '')) AS source_match_id,
      NULLIF(r->>'source_race_id', '')::BIGINT AS source_race_id,
      COALESCE(NULLIF(r->>'sport_type', ''), CASE WHEN COALESCE(NULLIF(r->>'source', ''), 'ymq') = 'tennis-json' THEN 'tennis' ELSE 'badminton' END) AS sport_type,
      COALESCE(r->>'category', 'U') AS category,
      COALESCE(r->>'tournament_name', '') AS tournament_name,
      NULLIF(r->>'start_time', '')::TIMESTAMPTZ AS start_time,
      NULLIF(r->>'match_started_at', '')::TIMESTAMPTZ AS match_started_at,
      NULLIF(r->>'match_ended_at', '')::TIMESTAMPTZ AS match_ended_at,
      NULLIF(r->>'location', '') AS location,
      NULLIF(r->>'city', '') AS city,
      NULLIF(r->>'court_num', '')::INT AS court_num,
      NULLIF(r->>'match_no', '')::INT AS match_no,
      NULLIF(r->>'match_time_name', '') AS match_time_name,
      NULLIF(r->>'round_name', '') AS round_name,
      COALESCE(ARRAY(SELECT jsonb_array_elements_text(r->'players_a')), '{}'::TEXT[]) AS players_a,
      COALESCE(ARRAY(SELECT jsonb_array_elements_text(r->'players_b')), '{}'::TEXT[]) AS players_b,
      NULLIF(r->>'players_text', '') AS players_text,
      NULLIF(r->>'score_text', '') AS score_text,
      COALESCE(r->>'winner_side', 'UNKNOWN') AS winner_side,
      NULLIF(r->>'source_status_no', '')::INT AS source_status_no,
      NULLIF(r->>'source_updated_at', '')::TIMESTAMPTZ AS source_updated_at,
      NULLIF(r->>'snapshot_captured_at', '')::TIMESTAMPTZ AS snapshot_captured_at,
      NULLIF(r->>'snapshot_version', '')::BIGINT AS snapshot_version_input,
      NULLIF(r->>'raw_hash', '') AS raw_hash,
      r->'raw' AS raw,
      NULLIF(r->>'age_years', '')::INT AS age_years,
      NULLIF(r->>'item_name', '') AS item_name,
      NULLIF(r->>'event_key', '') AS event_key,
      NULLIF(r->>'canonical_match_id', '') AS canonical_match_id_input,
      NULLIF(r->>'dedupe_scope_key', '') AS dedupe_scope_key_input,
      NULLIF(r->>'idempotency_key', '') AS idempotency_key_input,
      NULLIF(r->>'match_status', '') AS match_status_input,
      NULLIF(r->>'lifecycle_status', '') AS lifecycle_status_input,
      COALESCE(NULLIF(r->>'source_priority', '')::INT, 100) AS source_priority
    FROM input
  ), enriched AS (
    SELECT
      source,
      source_match_id,
      source_race_id,
      sport_type,
      category,
      tournament_name,
      start_time,
      match_started_at,
      match_ended_at,
      location,
      city,
      court_num,
      match_no,
      match_time_name,
      round_name,
      players_a,
      players_b,
      players_text,
      score_text,
      winner_side,
      source_status_no,
      source_updated_at,
      COALESCE(snapshot_captured_at, source_updated_at, now()) AS snapshot_captured_at,
      COALESCE(snapshot_version_input, floor(extract(epoch FROM COALESCE(snapshot_captured_at, source_updated_at, now())) * 1000)::BIGINT) AS snapshot_version,
      raw_hash,
      raw,
      age_years,
      item_name,
      event_key,
      COALESCE(match_status_input, public.matchlife_resolve_match_status(winner_side, match_ended_at, match_started_at, source_status_no, score_text)) AS match_status,
      source_priority,
      canonical_match_id_input,
      dedupe_scope_key_input,
      idempotency_key_input,
      lifecycle_status_input
    FROM parsed
    WHERE source_match_id IS NOT NULL
  ), finalized AS (
    SELECT
      source,
      source_race_id,
      source_match_id,
      source_match_id AS ymq_match_id,
      sport_type,
      category,
      tournament_name,
      start_time,
      match_started_at,
      match_ended_at,
      location,
      city,
      court_num,
      match_no,
      match_time_name,
      round_name,
      players_a,
      players_b,
      players_text,
      score_text,
      winner_side,
      source_status_no,
      source_updated_at,
      snapshot_captured_at,
      snapshot_version,
      COALESCE(raw_hash, md5(coalesce(raw::TEXT, ''))) AS raw_hash,
      raw,
      age_years,
      item_name,
      event_key,
      COALESCE(
        canonical_match_id_input,
        public.matchlife_build_canonical_match_id(
          sport_type,
          tournament_name,
          event_key,
          round_name,
          match_time_name,
          start_time,
          match_started_at,
          source_updated_at,
          players_a,
          players_b
        )
      ) AS canonical_match_id,
      COALESCE(
        dedupe_scope_key_input,
        public.matchlife_build_dedupe_scope_key(
          sport_type,
          event_key,
          round_name,
          match_time_name,
          start_time,
          match_started_at,
          players_a,
          players_b
        )
      ) AS dedupe_scope_key,
      match_status,
      public.matchlife_resolve_lifecycle_status(match_status, lifecycle_status_input) AS lifecycle_status,
      source_priority,
      COALESCE(
        idempotency_key_input,
        source || ':' || md5(concat_ws('|', source, source_match_id, coalesce(raw_hash, md5(coalesce(raw::TEXT, ''))), snapshot_version::TEXT))
      ) AS idempotency_key,
      public.matchlife_resolve_cache_status(
        match_status,
        public.matchlife_resolve_lifecycle_status(match_status, lifecycle_status_input)
      ) AS cache_status
    FROM enriched
  ), filtered AS (
    SELECT *
    FROM finalized
    WHERE cache_status IN ('ACTIVE', 'READY_TO_PERSIST')
  ), upserted AS (
    INSERT INTO public.active_match_cache (
      source,
      source_race_id,
      ymq_match_id,
      source_match_id,
      canonical_match_id,
      dedupe_scope_key,
      idempotency_key,
      sport_type,
      category,
      tournament_name,
      start_time,
      match_started_at,
      match_ended_at,
      location,
      city,
      court_num,
      match_no,
      match_time_name,
      round_name,
      players_a,
      players_b,
      players_text,
      score_text,
      winner_side,
      source_status_no,
      source_updated_at,
      snapshot_captured_at,
      snapshot_version,
      raw_hash,
      raw,
      age_years,
      item_name,
      event_key,
      match_status,
      lifecycle_status,
      cache_status,
      source_priority,
      persist_ready_at,
      persisted_at,
      compensate_after,
      cleanup_after,
      archive_after,
      first_seen_at,
      last_seen_at,
      write_count,
      created_at,
      updated_at
    )
    SELECT
      source,
      source_race_id,
      ymq_match_id,
      source_match_id,
      canonical_match_id,
      dedupe_scope_key,
      idempotency_key,
      sport_type,
      category,
      tournament_name,
      start_time,
      match_started_at,
      match_ended_at,
      location,
      city,
      court_num,
      match_no,
      match_time_name,
      round_name,
      players_a,
      players_b,
      players_text,
      score_text,
      winner_side,
      source_status_no,
      source_updated_at,
      snapshot_captured_at,
      snapshot_version,
      raw_hash,
      raw,
      age_years,
      item_name,
      event_key,
      match_status,
      lifecycle_status,
      cache_status,
      source_priority,
      CASE
        WHEN cache_status = 'READY_TO_PERSIST' THEN COALESCE(match_ended_at, source_updated_at, snapshot_captured_at, now())
        ELSE NULL
      END,
      NULL,
      NULL,
      CASE
        WHEN cache_status = 'READY_TO_PERSIST' THEN now() + INTERVAL '6 hours'
        ELSE NULL
      END,
      CASE
        WHEN cache_status = 'READY_TO_PERSIST' THEN now() + INTERVAL '30 days'
        ELSE NULL
      END,
      now(),
      now(),
      1,
      now(),
      now()
    FROM filtered
    ON CONFLICT (ymq_match_id)
    DO UPDATE SET
      source = EXCLUDED.source,
      source_race_id = EXCLUDED.source_race_id,
      source_match_id = EXCLUDED.source_match_id,
      canonical_match_id = EXCLUDED.canonical_match_id,
      dedupe_scope_key = EXCLUDED.dedupe_scope_key,
      idempotency_key = EXCLUDED.idempotency_key,
      sport_type = EXCLUDED.sport_type,
      category = EXCLUDED.category,
      tournament_name = EXCLUDED.tournament_name,
      start_time = EXCLUDED.start_time,
      match_started_at = EXCLUDED.match_started_at,
      match_ended_at = EXCLUDED.match_ended_at,
      location = EXCLUDED.location,
      city = EXCLUDED.city,
      court_num = EXCLUDED.court_num,
      match_no = EXCLUDED.match_no,
      match_time_name = EXCLUDED.match_time_name,
      round_name = EXCLUDED.round_name,
      players_a = EXCLUDED.players_a,
      players_b = EXCLUDED.players_b,
      players_text = EXCLUDED.players_text,
      score_text = EXCLUDED.score_text,
      winner_side = EXCLUDED.winner_side,
      source_status_no = EXCLUDED.source_status_no,
      source_updated_at = EXCLUDED.source_updated_at,
      snapshot_captured_at = EXCLUDED.snapshot_captured_at,
      snapshot_version = EXCLUDED.snapshot_version,
      raw_hash = EXCLUDED.raw_hash,
      raw = EXCLUDED.raw,
      age_years = EXCLUDED.age_years,
      item_name = EXCLUDED.item_name,
      event_key = EXCLUDED.event_key,
      match_status = EXCLUDED.match_status,
      lifecycle_status = EXCLUDED.lifecycle_status,
      cache_status = EXCLUDED.cache_status,
      source_priority = EXCLUDED.source_priority,
      persist_ready_at = CASE
        WHEN EXCLUDED.cache_status = 'READY_TO_PERSIST' THEN COALESCE(public.active_match_cache.persist_ready_at, EXCLUDED.persist_ready_at, now())
        ELSE NULL
      END,
      persisted_at = CASE
        WHEN EXCLUDED.cache_status = 'PERSISTED' THEN COALESCE(public.active_match_cache.persisted_at, now())
        ELSE NULL
      END,
      compensate_after = NULL,
      cleanup_after = CASE
        WHEN EXCLUDED.cache_status = 'READY_TO_PERSIST' THEN now() + INTERVAL '6 hours'
        ELSE public.active_match_cache.cleanup_after
      END,
      archive_after = CASE
        WHEN EXCLUDED.cache_status = 'READY_TO_PERSIST' THEN now() + INTERVAL '30 days'
        ELSE public.active_match_cache.archive_after
      END,
      last_seen_at = now(),
      write_count = CASE
        WHEN public.active_match_cache.raw_hash IS DISTINCT FROM EXCLUDED.raw_hash
          OR public.active_match_cache.match_status IS DISTINCT FROM EXCLUDED.match_status
          OR public.active_match_cache.lifecycle_status IS DISTINCT FROM EXCLUDED.lifecycle_status
          OR public.active_match_cache.snapshot_version IS DISTINCT FROM EXCLUDED.snapshot_version
          THEN public.active_match_cache.write_count + 1
        ELSE public.active_match_cache.write_count
      END,
      updated_at = now()
    WHERE EXCLUDED.snapshot_version > COALESCE(public.active_match_cache.snapshot_version, -1)
      OR (
        EXCLUDED.snapshot_version = COALESCE(public.active_match_cache.snapshot_version, -1)
        AND (
          public.active_match_cache.raw_hash IS DISTINCT FROM EXCLUDED.raw_hash
          OR public.active_match_cache.match_status IS DISTINCT FROM EXCLUDED.match_status
          OR public.active_match_cache.lifecycle_status IS DISTINCT FROM EXCLUDED.lifecycle_status
          OR public.active_match_cache.cache_status IS DISTINCT FROM EXCLUDED.cache_status
          OR COALESCE(EXCLUDED.source_priority, 1000000) < COALESCE(public.active_match_cache.source_priority, 1000000)
        )
      )
    RETURNING (xmax = 0) AS inserted, cache_status
  )
  SELECT
    (SELECT COUNT(*) FROM upserted WHERE inserted),
    (SELECT COUNT(*) FROM upserted WHERE NOT inserted),
    (SELECT COUNT(*) FROM filtered WHERE cache_status = 'ACTIVE'),
    (SELECT COUNT(*) FROM filtered WHERE cache_status = 'READY_TO_PERSIST'),
    (SELECT COUNT(*) FROM filtered),
    jsonb_array_length(records)
  INTO inserted_count, updated_count, active_count, ready_count, filtered_count, total_count;

  skipped_count := GREATEST(filtered_count - inserted_count - updated_count, 0);

  RETURN jsonb_build_object(
    'cached_inserted_count', inserted_count,
    'cached_updated_count', updated_count,
    'cached_skipped_count', skipped_count,
    'active_cached_count', active_count,
    'queued_persist_count', ready_count,
    'ignored_count', GREATEST(total_count - filtered_count, 0),
    'total_count', total_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.stage_live_matches(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.stage_live_matches(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.upsert_matches_if_changed(records jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  inserted_count INT := 0;
  updated_count INT := 0;
  skipped_count INT := 0;
  total_count INT := 0;
BEGIN
  IF records IS NULL OR jsonb_typeof(records) <> 'array' THEN
    RETURN jsonb_build_object('inserted_count', 0, 'updated_count', 0, 'skipped_count', 0, 'total_count', 0);
  END IF;

  WITH input AS (
    SELECT jsonb_array_elements(records) AS r
  ), parsed AS (
    SELECT
      COALESCE(NULLIF(r->>'source', ''), 'ymq') AS source,
      COALESCE(NULLIF(r->>'source_match_id', ''), NULLIF(r->>'ymq_match_id', '')) AS source_match_id,
      COALESCE(NULLIF(r->>'sport_type', ''), CASE WHEN COALESCE(NULLIF(r->>'source', ''), 'ymq') = 'tennis-json' THEN 'tennis' ELSE 'badminton' END) AS sport_type,
      COALESCE(r->>'category', 'U') AS category,
      COALESCE(r->>'tournament_name', '') AS tournament_name,
      NULLIF(r->>'start_time', '')::TIMESTAMPTZ AS start_time,
      NULLIF(r->>'match_started_at', '')::TIMESTAMPTZ AS match_started_at,
      NULLIF(r->>'match_ended_at', '')::TIMESTAMPTZ AS match_ended_at,
      NULLIF(r->>'location', '') AS location,
      NULLIF(r->>'city', '') AS city,
      NULLIF(r->>'court_num', '')::INT AS court_num,
      NULLIF(r->>'match_no', '')::INT AS match_no,
      NULLIF(r->>'match_time_name', '') AS match_time_name,
      NULLIF(r->>'round_name', '') AS round_name,
      COALESCE(ARRAY(SELECT jsonb_array_elements_text(r->'players_a')), '{}'::TEXT[]) AS players_a,
      COALESCE(ARRAY(SELECT jsonb_array_elements_text(r->'players_b')), '{}'::TEXT[]) AS players_b,
      NULLIF(r->>'players_text', '') AS players_text,
      NULLIF(r->>'score_text', '') AS score_text,
      COALESCE(r->>'winner_side', 'UNKNOWN') AS winner_side,
      NULLIF(r->>'source_updated_at', '')::TIMESTAMPTZ AS source_updated_at,
      NULLIF(r->>'snapshot_captured_at', '')::TIMESTAMPTZ AS snapshot_captured_at,
      NULLIF(r->>'snapshot_version', '')::BIGINT AS snapshot_version_input,
      NULLIF(r->>'raw_hash', '') AS raw_hash,
      r->'raw' AS raw,
      NULLIF(r->>'age_years', '')::INT AS age_years,
      NULLIF(r->>'item_name', '') AS item_name,
      NULLIF(r->>'event_key', '') AS event_key,
      NULLIF(r->>'canonical_match_id', '') AS canonical_match_id_input,
      NULLIF(r->>'dedupe_scope_key', '') AS dedupe_scope_key_input,
      NULLIF(r->>'idempotency_key', '') AS idempotency_key_input,
      NULLIF(r->>'match_status', '') AS match_status_input,
      COALESCE(NULLIF(r->>'source_priority', '')::INT, 100) AS source_priority
    FROM input
  ), finalized AS (
    SELECT
      source,
      source_match_id,
      source_match_id AS ymq_match_id,
      sport_type,
      category,
      tournament_name,
      start_time,
      match_started_at,
      match_ended_at,
      location,
      city,
      court_num,
      match_no,
      match_time_name,
      round_name,
      players_a,
      players_b,
      players_text,
      score_text,
      winner_side,
      source_updated_at,
      COALESCE(snapshot_captured_at, source_updated_at, now()) AS snapshot_captured_at,
      COALESCE(snapshot_version_input, floor(extract(epoch FROM COALESCE(snapshot_captured_at, source_updated_at, now())) * 1000)::BIGINT) AS snapshot_version,
      COALESCE(raw_hash, md5(coalesce(raw::TEXT, ''))) AS raw_hash,
      raw,
      age_years,
      item_name,
      event_key,
      COALESCE(
        canonical_match_id_input,
        public.matchlife_build_canonical_match_id(
          sport_type,
          tournament_name,
          event_key,
          round_name,
          match_time_name,
          start_time,
          match_started_at,
          source_updated_at,
          players_a,
          players_b
        )
      ) AS canonical_match_id,
      COALESCE(
        dedupe_scope_key_input,
        public.matchlife_build_dedupe_scope_key(
          sport_type,
          event_key,
          round_name,
          match_time_name,
          start_time,
          match_started_at,
          players_a,
          players_b
        )
      ) AS dedupe_scope_key,
      COALESCE(match_status_input, public.matchlife_resolve_match_status(winner_side, match_ended_at, match_started_at, NULL, score_text)) AS match_status,
      source_priority,
      COALESCE(
        idempotency_key_input,
        source || ':' || md5(concat_ws('|', source, source_match_id, COALESCE(raw_hash, md5(coalesce(raw::TEXT, ''))), COALESCE(snapshot_version_input, floor(extract(epoch FROM COALESCE(snapshot_captured_at, source_updated_at, now())) * 1000)::BIGINT)::TEXT))
      ) AS idempotency_key
    FROM parsed
    WHERE source_match_id IS NOT NULL
  ), ins AS (
    INSERT INTO public.matches (
      source,
      ymq_match_id,
      source_match_id,
      canonical_match_id,
      dedupe_scope_key,
      idempotency_key,
      sport_type,
      category,
      tournament_name,
      start_time,
      match_started_at,
      match_ended_at,
      location,
      city,
      court_num,
      match_no,
      match_time_name,
      round_name,
      players_a,
      players_b,
      players_text,
      score_text,
      winner_side,
      source_updated_at,
      snapshot_captured_at,
      snapshot_version,
      raw_hash,
      raw,
      age_years,
      item_name,
      event_key,
      match_status,
      lifecycle_status,
      source_priority,
      persisted_from_cache_at,
      persist_version,
      created_at,
      updated_at
    )
    SELECT
      source,
      ymq_match_id,
      source_match_id,
      canonical_match_id,
      dedupe_scope_key,
      idempotency_key,
      sport_type,
      category,
      tournament_name,
      start_time,
      match_started_at,
      match_ended_at,
      location,
      city,
      court_num,
      match_no,
      match_time_name,
      round_name,
      players_a,
      players_b,
      players_text,
      score_text,
      winner_side,
      source_updated_at,
      snapshot_captured_at,
      snapshot_version,
      raw_hash,
      raw,
      age_years,
      item_name,
      event_key,
      match_status,
      'persisted',
      source_priority,
      now(),
      1,
      now(),
      now()
    FROM finalized
    ON CONFLICT (ymq_match_id)
    DO UPDATE SET
      source = EXCLUDED.source,
      source_match_id = EXCLUDED.source_match_id,
      canonical_match_id = EXCLUDED.canonical_match_id,
      dedupe_scope_key = EXCLUDED.dedupe_scope_key,
      idempotency_key = EXCLUDED.idempotency_key,
      sport_type = EXCLUDED.sport_type,
      category = EXCLUDED.category,
      tournament_name = EXCLUDED.tournament_name,
      start_time = EXCLUDED.start_time,
      match_started_at = EXCLUDED.match_started_at,
      match_ended_at = EXCLUDED.match_ended_at,
      location = EXCLUDED.location,
      city = EXCLUDED.city,
      court_num = EXCLUDED.court_num,
      match_no = EXCLUDED.match_no,
      match_time_name = EXCLUDED.match_time_name,
      round_name = EXCLUDED.round_name,
      players_a = EXCLUDED.players_a,
      players_b = EXCLUDED.players_b,
      players_text = EXCLUDED.players_text,
      score_text = EXCLUDED.score_text,
      winner_side = EXCLUDED.winner_side,
      source_updated_at = EXCLUDED.source_updated_at,
      snapshot_captured_at = EXCLUDED.snapshot_captured_at,
      snapshot_version = EXCLUDED.snapshot_version,
      raw_hash = EXCLUDED.raw_hash,
      raw = EXCLUDED.raw,
      age_years = EXCLUDED.age_years,
      item_name = EXCLUDED.item_name,
      event_key = EXCLUDED.event_key,
      match_status = EXCLUDED.match_status,
      lifecycle_status = 'persisted',
      source_priority = EXCLUDED.source_priority,
      persisted_from_cache_at = now(),
      persist_version = public.matches.persist_version + 1,
      updated_at = now()
    WHERE EXCLUDED.snapshot_version > COALESCE(public.matches.snapshot_version, -1)
      OR (
        EXCLUDED.snapshot_version = COALESCE(public.matches.snapshot_version, -1)
        AND (
          public.matches.raw_hash IS DISTINCT FROM EXCLUDED.raw_hash
          OR public.matches.match_status IS DISTINCT FROM EXCLUDED.match_status
          OR COALESCE(EXCLUDED.source_priority, 1000000) < COALESCE(public.matches.source_priority, 1000000)
        )
      )
    RETURNING (xmax = 0) AS inserted
  )
  SELECT
    COUNT(*) FILTER (WHERE inserted),
    COUNT(*) FILTER (WHERE NOT inserted)
  INTO inserted_count, updated_count
  FROM ins;

  SELECT jsonb_array_length(records) INTO total_count;
  skipped_count := GREATEST(total_count - inserted_count - updated_count, 0);

  RETURN jsonb_build_object(
    'inserted_count', inserted_count,
    'updated_count', updated_count,
    'skipped_count', skipped_count,
    'total_count', total_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_matches_if_changed(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_matches_if_changed(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.persist_ready_active_matches()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  ready_payload jsonb := '[]'::jsonb;
  ready_ids uuid[] := '{}'::uuid[];
  persist_meta jsonb := '{}'::jsonb;
  marked_persisted_count INT := 0;
  remaining_pending_count INT := 0;
  archived_count INT := 0;
  cleaned_count INT := 0;
  persist_failed_count INT := 0;
  compensated_count INT := 0;
BEGIN
  WITH candidates AS (
    SELECT *
    FROM public.active_match_cache
    WHERE cache_status = 'READY_TO_PERSIST'
      AND (
        lifecycle_status = 'pending_persist'
        OR (
          lifecycle_status = 'persist_failed'
          AND coalesce(compensate_after, now()) <= now()
        )
      )
  )
  SELECT
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'source', source,
          'source_match_id', source_match_id,
          'ymq_match_id', ymq_match_id,
          'canonical_match_id', canonical_match_id,
          'dedupe_scope_key', dedupe_scope_key,
          'idempotency_key', idempotency_key,
          'sport_type', sport_type,
          'category', category,
          'tournament_name', tournament_name,
          'start_time', start_time,
          'match_started_at', match_started_at,
          'match_ended_at', match_ended_at,
          'location', location,
          'city', city,
          'court_num', court_num,
          'match_no', match_no,
          'match_time_name', match_time_name,
          'round_name', round_name,
          'players_a', to_jsonb(players_a),
          'players_b', to_jsonb(players_b),
          'players_text', players_text,
          'score_text', score_text,
          'winner_side', winner_side,
          'source_updated_at', source_updated_at,
          'snapshot_captured_at', snapshot_captured_at,
          'snapshot_version', snapshot_version,
          'raw_hash', raw_hash,
          'raw', raw,
          'age_years', age_years,
          'item_name', item_name,
          'event_key', event_key,
          'match_status', match_status,
          'source_priority', source_priority
        )
        ORDER BY snapshot_version DESC, source_priority ASC, last_seen_at DESC
      ),
      '[]'::jsonb
    ),
    COALESCE(array_agg(id), '{}'::uuid[]),
    COUNT(*) FILTER (WHERE lifecycle_status = 'persist_failed')::INT
  INTO ready_payload, ready_ids, compensated_count
  FROM candidates;

  IF coalesce(array_length(ready_ids, 1), 0) > 0 THEN
    BEGIN
      persist_meta := public.upsert_matches_if_changed(ready_payload);

      UPDATE public.active_match_cache
      SET
        cache_status = 'PERSISTED',
        lifecycle_status = 'persisted',
        persisted_at = now(),
        persist_attempts = persist_attempts + 1,
        last_persist_attempt_at = now(),
        last_persist_error = NULL,
        compensate_after = NULL,
        cleanup_after = coalesce(cleanup_after, now() + INTERVAL '6 hours'),
        archive_after = coalesce(archive_after, now() + INTERVAL '30 days'),
        updated_at = now()
      WHERE id = ANY(ready_ids);
      GET DIAGNOSTICS marked_persisted_count = ROW_COUNT;
    EXCEPTION
      WHEN OTHERS THEN
        UPDATE public.active_match_cache
        SET
          lifecycle_status = 'persist_failed',
          cache_status = 'READY_TO_PERSIST',
          persist_attempts = persist_attempts + 1,
          last_persist_attempt_at = now(),
          last_persist_error = left(SQLERRM, 500),
          compensate_after = now() + INTERVAL '5 minutes',
          updated_at = now()
        WHERE id = ANY(ready_ids);
        GET DIAGNOSTICS persist_failed_count = ROW_COUNT;

        SELECT COUNT(*)
        INTO remaining_pending_count
        FROM public.active_match_cache
        WHERE cache_status = 'READY_TO_PERSIST';

        RETURN jsonb_build_object(
          'persisted_inserted_count', 0,
          'persisted_updated_count', 0,
          'persisted_skipped_count', 0,
          'marked_persisted_count', 0,
          'remaining_pending_count', remaining_pending_count,
          'archived_count', 0,
          'cleaned_count', 0,
          'persist_failed_count', persist_failed_count,
          'compensated_count', compensated_count,
          'error_message', SQLERRM
        );
    END;
  END IF;

  UPDATE public.active_match_cache
  SET
    cache_status = 'STALE',
    lifecycle_status = 'archived',
    cleanup_after = coalesce(cleanup_after, now() + INTERVAL '12 hours'),
    updated_at = now()
  WHERE cache_status = 'ACTIVE'
    AND last_seen_at < now() - INTERVAL '30 minutes';
  GET DIAGNOSTICS archived_count = ROW_COUNT;

  DELETE FROM public.active_match_cache
  WHERE (
    cache_status = 'PERSISTED'
    AND coalesce(cleanup_after, persisted_at + INTERVAL '6 hours', updated_at + INTERVAL '6 hours') < now()
  )
  OR (
    cache_status = 'STALE'
    AND coalesce(cleanup_after, last_seen_at + INTERVAL '12 hours', updated_at + INTERVAL '12 hours') < now()
  );
  GET DIAGNOSTICS cleaned_count = ROW_COUNT;

  SELECT COUNT(*)
  INTO remaining_pending_count
  FROM public.active_match_cache
  WHERE cache_status = 'READY_TO_PERSIST';

  RETURN jsonb_build_object(
    'persisted_inserted_count', COALESCE((persist_meta->>'inserted_count')::INT, 0),
    'persisted_updated_count', COALESCE((persist_meta->>'updated_count')::INT, 0),
    'persisted_skipped_count', COALESCE((persist_meta->>'skipped_count')::INT, 0),
    'marked_persisted_count', marked_persisted_count,
    'remaining_pending_count', remaining_pending_count,
    'archived_count', archived_count,
    'cleaned_count', cleaned_count,
    'persist_failed_count', persist_failed_count,
    'compensated_count', compensated_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.persist_ready_active_matches() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.persist_ready_active_matches() TO service_role;

NOTIFY pgrst, 'reload schema';
