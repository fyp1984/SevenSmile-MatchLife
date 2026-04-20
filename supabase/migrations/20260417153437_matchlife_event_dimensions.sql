ALTER TABLE IF EXISTS public.matches ADD COLUMN IF NOT EXISTS age_years INT;
ALTER TABLE IF EXISTS public.matches ADD COLUMN IF NOT EXISTS item_name TEXT;
ALTER TABLE IF EXISTS public.matches ADD COLUMN IF NOT EXISTS event_key TEXT;

CREATE INDEX IF NOT EXISTS idx_matches_event_key ON public.matches(event_key);
CREATE INDEX IF NOT EXISTS idx_matches_item_name ON public.matches(item_name);
CREATE INDEX IF NOT EXISTS idx_matches_age_years ON public.matches(age_years);

CREATE OR REPLACE FUNCTION public.upsert_matches_if_changed(records jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  inserted_count int := 0;
  updated_count int := 0;
  skipped_count int := 0;
  total_count int := 0;
BEGIN
  IF records IS NULL OR jsonb_typeof(records) <> 'array' THEN
    RETURN jsonb_build_object('inserted_count', 0, 'updated_count', 0, 'skipped_count', 0, 'total_count', 0);
  END IF;

  WITH input AS (
    SELECT jsonb_array_elements(records) AS r
  ), ins AS (
    INSERT INTO public.matches (
      source,
      ymq_match_id,
      category,
      tournament_name,
      start_time,
      location,
      city,
      court_num,
      match_no,
      match_time_name,
      players_a,
      players_b,
      players_text,
      score_text,
      winner_side,
      source_updated_at,
      raw_hash,
      raw,
      age_years,
      item_name,
      event_key
    )
    SELECT
      COALESCE(r->>'source', 'ymq') AS source,
      r->>'ymq_match_id' AS ymq_match_id,
      COALESCE(r->>'category', 'U') AS category,
      COALESCE(r->>'tournament_name', '') AS tournament_name,
      NULLIF(r->>'start_time', '')::timestamptz AS start_time,
      NULLIF(r->>'location', '') AS location,
      NULLIF(r->>'city', '') AS city,
      NULLIF(r->>'court_num', '')::int AS court_num,
      NULLIF(r->>'match_no', '')::int AS match_no,
      NULLIF(r->>'match_time_name', '') AS match_time_name,
      COALESCE(ARRAY(SELECT jsonb_array_elements_text(r->'players_a')), '{}'::text[]) AS players_a,
      COALESCE(ARRAY(SELECT jsonb_array_elements_text(r->'players_b')), '{}'::text[]) AS players_b,
      NULLIF(r->>'players_text', '') AS players_text,
      NULLIF(r->>'score_text', '') AS score_text,
      COALESCE(r->>'winner_side', 'UNKNOWN') AS winner_side,
      NULLIF(r->>'source_updated_at', '')::timestamptz AS source_updated_at,
      NULLIF(r->>'raw_hash', '') AS raw_hash,
      r->'raw' AS raw,
      NULLIF(r->>'age_years', '')::int AS age_years,
      NULLIF(r->>'item_name', '') AS item_name,
      NULLIF(r->>'event_key', '') AS event_key
    FROM input
    WHERE (r ? 'ymq_match_id')
    ON CONFLICT (ymq_match_id)
    DO UPDATE SET
      source = EXCLUDED.source,
      category = EXCLUDED.category,
      tournament_name = EXCLUDED.tournament_name,
      start_time = EXCLUDED.start_time,
      location = EXCLUDED.location,
      city = EXCLUDED.city,
      court_num = EXCLUDED.court_num,
      match_no = EXCLUDED.match_no,
      match_time_name = EXCLUDED.match_time_name,
      players_a = EXCLUDED.players_a,
      players_b = EXCLUDED.players_b,
      players_text = EXCLUDED.players_text,
      score_text = EXCLUDED.score_text,
      winner_side = EXCLUDED.winner_side,
      source_updated_at = EXCLUDED.source_updated_at,
      raw_hash = EXCLUDED.raw_hash,
      raw = EXCLUDED.raw,
      age_years = EXCLUDED.age_years,
      item_name = EXCLUDED.item_name,
      event_key = EXCLUDED.event_key,
      updated_at = NOW()
    WHERE public.matches.raw_hash IS DISTINCT FROM EXCLUDED.raw_hash
    RETURNING (xmax = 0) AS inserted
  )
  SELECT
    COUNT(*) FILTER (WHERE inserted) AS ins,
    COUNT(*) FILTER (WHERE NOT inserted) AS upd
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

