CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_matches_tournament_name_trgm
  ON public.matches USING gin (tournament_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_matches_players_text_trgm
  ON public.matches USING gin (players_text gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_matches_event_key_trgm
  ON public.matches USING gin (event_key gin_trgm_ops);
