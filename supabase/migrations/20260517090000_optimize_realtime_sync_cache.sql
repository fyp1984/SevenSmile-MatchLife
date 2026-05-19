ALTER TABLE IF EXISTS public.sync_runs
  ADD COLUMN IF NOT EXISTS active_cached_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pending_persist_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS persisted_count INT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.active_match_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL DEFAULT 'ymq',
  source_race_id BIGINT,
  ymq_match_id TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL DEFAULT 'U',
  tournament_name TEXT NOT NULL,
  start_time TIMESTAMPTZ,
  match_started_at TIMESTAMPTZ,
  match_ended_at TIMESTAMPTZ,
  location TEXT,
  city TEXT,
  court_num INT,
  match_no INT,
  match_time_name TEXT,
  round_name TEXT,
  players_a TEXT[] NOT NULL DEFAULT '{}'::text[],
  players_b TEXT[] NOT NULL DEFAULT '{}'::text[],
  players_text TEXT,
  score_text TEXT,
  winner_side TEXT NOT NULL DEFAULT 'UNKNOWN',
  source_status_no INT,
  source_updated_at TIMESTAMPTZ,
  raw_hash TEXT,
  raw JSONB,
  age_years INT,
  item_name TEXT,
  event_key TEXT,
  cache_status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (cache_status IN ('ACTIVE', 'READY_TO_PERSIST', 'PERSISTED', 'STALE')),
  persist_ready_at TIMESTAMPTZ,
  persisted_at TIMESTAMPTZ,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  write_count INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_active_match_cache_status_seen
  ON public.active_match_cache (cache_status, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_active_match_cache_race_status
  ON public.active_match_cache (source, source_race_id, cache_status, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_active_match_cache_court
  ON public.active_match_cache (source_race_id, court_num, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_active_match_cache_persist_ready
  ON public.active_match_cache (cache_status, persist_ready_at ASC);

ALTER TABLE IF EXISTS public.active_match_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read active_match_cache" ON public.active_match_cache;
CREATE POLICY "Public read active_match_cache"
  ON public.active_match_cache
  FOR SELECT
  TO anon, authenticated
  USING (true);

GRANT SELECT ON public.active_match_cache TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.active_match_cache TO service_role;

CREATE OR REPLACE VIEW public.sync_runtime_state AS
SELECT
  COUNT(*) FILTER (WHERE cache_status = 'ACTIVE')::INT AS active_cached_count,
  COUNT(*) FILTER (WHERE cache_status = 'READY_TO_PERSIST')::INT AS pending_persist_count,
  COUNT(*) FILTER (WHERE cache_status = 'PERSISTED')::INT AS persisted_count,
  COUNT(*) FILTER (WHERE cache_status = 'STALE')::INT AS stale_count,
  MAX(source_updated_at) AS last_source_updated_at,
  MAX(last_seen_at) AS last_cache_seen_at,
  MAX(persisted_at) AS last_persisted_at
FROM public.active_match_cache;

GRANT SELECT ON public.sync_runtime_state TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.matchlife_reset_db()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  TRUNCATE TABLE public.active_match_cache RESTART IDENTITY;
  TRUNCATE TABLE public.matches RESTART IDENTITY;
  TRUNCATE TABLE public.sync_runs RESTART IDENTITY;
END;
$$;

REVOKE ALL ON FUNCTION public.matchlife_reset_db() FROM PUBLIC;

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
      COALESCE(r->>'source', 'ymq') AS source,
      NULLIF(r->>'source_race_id', '')::BIGINT AS source_race_id,
      r->>'ymq_match_id' AS ymq_match_id,
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
      NULLIF(r->>'raw_hash', '') AS raw_hash,
      r->'raw' AS raw,
      NULLIF(r->>'age_years', '')::INT AS age_years,
      NULLIF(r->>'item_name', '') AS item_name,
      NULLIF(r->>'event_key', '') AS event_key,
      CASE
        WHEN COALESCE(r->>'winner_side', 'UNKNOWN') IN ('A', 'B')
          OR NULLIF(r->>'match_ended_at', '') IS NOT NULL
          OR NULLIF(r->>'source_status_no', '')::INT = 2
          THEN 'READY_TO_PERSIST'
        WHEN NULLIF(r->>'match_started_at', '') IS NOT NULL
          OR COALESCE(NULLIF(r->>'score_text', ''), '') <> ''
          OR NULLIF(r->>'source_status_no', '')::INT IN (1, 3, 4, 5)
          THEN 'ACTIVE'
        ELSE 'STALE'
      END AS derived_status
    FROM input
    WHERE (r ? 'ymq_match_id')
  ), filtered AS (
    SELECT *
    FROM parsed
    WHERE derived_status IN ('ACTIVE', 'READY_TO_PERSIST')
  ), upserted AS (
    INSERT INTO public.active_match_cache (
      source,
      source_race_id,
      ymq_match_id,
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
      raw_hash,
      raw,
      age_years,
      item_name,
      event_key,
      cache_status,
      persist_ready_at,
      persisted_at,
      first_seen_at,
      last_seen_at,
      write_count,
      updated_at
    )
    SELECT
      source,
      source_race_id,
      ymq_match_id,
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
      raw_hash,
      raw,
      age_years,
      item_name,
      event_key,
      derived_status,
      CASE
        WHEN derived_status = 'READY_TO_PERSIST' THEN COALESCE(match_ended_at, source_updated_at, NOW())
        ELSE NULL
      END,
      NULL,
      NOW(),
      NOW(),
      1,
      NOW()
    FROM filtered
    ON CONFLICT (ymq_match_id)
    DO UPDATE SET
      source = EXCLUDED.source,
      source_race_id = EXCLUDED.source_race_id,
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
      raw_hash = EXCLUDED.raw_hash,
      raw = EXCLUDED.raw,
      age_years = EXCLUDED.age_years,
      item_name = EXCLUDED.item_name,
      event_key = EXCLUDED.event_key,
      cache_status = EXCLUDED.cache_status,
      persist_ready_at = CASE
        WHEN EXCLUDED.cache_status = 'READY_TO_PERSIST' THEN COALESCE(public.active_match_cache.persist_ready_at, EXCLUDED.persist_ready_at, NOW())
        ELSE NULL
      END,
      persisted_at = NULL,
      last_seen_at = NOW(),
      write_count = CASE
        WHEN public.active_match_cache.raw_hash IS DISTINCT FROM EXCLUDED.raw_hash
          OR public.active_match_cache.cache_status IS DISTINCT FROM EXCLUDED.cache_status
          OR public.active_match_cache.match_ended_at IS DISTINCT FROM EXCLUDED.match_ended_at
          THEN public.active_match_cache.write_count + 1
        ELSE public.active_match_cache.write_count
      END,
      updated_at = NOW()
    WHERE public.active_match_cache.raw_hash IS DISTINCT FROM EXCLUDED.raw_hash
      OR public.active_match_cache.cache_status IS DISTINCT FROM EXCLUDED.cache_status
      OR public.active_match_cache.match_ended_at IS DISTINCT FROM EXCLUDED.match_ended_at
    RETURNING (xmax = 0) AS inserted, cache_status
  )
  SELECT
    (SELECT COUNT(*) FROM upserted WHERE inserted),
    (SELECT COUNT(*) FROM upserted WHERE NOT inserted),
    (SELECT COUNT(*) FROM filtered WHERE derived_status = 'ACTIVE'),
    (SELECT COUNT(*) FROM filtered WHERE derived_status = 'READY_TO_PERSIST'),
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

CREATE OR REPLACE FUNCTION public.persist_ready_active_matches()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  ready_payload jsonb := '[]'::jsonb;
  persist_meta jsonb := '{}'::jsonb;
  marked_persisted_count INT := 0;
  remaining_pending_count INT := 0;
  stale_marked_count INT := 0;
  cleaned_count INT := 0;
BEGIN
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'source', source,
        'ymq_match_id', ymq_match_id,
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
        'raw_hash', raw_hash,
        'raw', raw,
        'age_years', age_years,
        'item_name', item_name,
        'event_key', event_key
      )
    ),
    '[]'::jsonb
  )
  INTO ready_payload
  FROM public.active_match_cache
  WHERE cache_status = 'READY_TO_PERSIST';

  persist_meta := public.upsert_matches_if_changed(ready_payload);

  UPDATE public.active_match_cache
  SET
    cache_status = 'PERSISTED',
    persisted_at = NOW(),
    updated_at = NOW()
  WHERE cache_status = 'READY_TO_PERSIST';
  GET DIAGNOSTICS marked_persisted_count = ROW_COUNT;

  UPDATE public.active_match_cache
  SET
    cache_status = 'STALE',
    updated_at = NOW()
  WHERE cache_status = 'ACTIVE'
    AND last_seen_at < NOW() - INTERVAL '30 minutes';
  GET DIAGNOSTICS stale_marked_count = ROW_COUNT;

  DELETE FROM public.active_match_cache
  WHERE (cache_status = 'PERSISTED' AND persisted_at < NOW() - INTERVAL '6 hours')
     OR (cache_status = 'STALE' AND last_seen_at < NOW() - INTERVAL '12 hours');
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
    'stale_marked_count', stale_marked_count,
    'cleaned_count', cleaned_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.persist_ready_active_matches() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.persist_ready_active_matches() TO service_role;

NOTIFY pgrst, 'reload schema';
