CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_matches_source_updated_at_desc
  ON public.matches (source_updated_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_matches_round_name_trgm
  ON public.matches USING gin (round_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_matches_match_time_name_trgm
  ON public.matches USING gin (match_time_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_matches_category_trgm
  ON public.matches USING gin (category gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_matches_city_trgm
  ON public.matches USING gin (city gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_matches_location_trgm
  ON public.matches USING gin (location gin_trgm_ops);
