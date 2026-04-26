CREATE INDEX IF NOT EXISTS idx_sync_runs_source_run_at_desc
  ON public.sync_runs (source, run_at DESC);

CREATE INDEX IF NOT EXISTS idx_matches_start_updated_desc
  ON public.matches (start_time DESC NULLS LAST, source_updated_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_matches_ongoing_recent
  ON public.matches (source_updated_at DESC NULLS LAST)
  WHERE winner_side = 'UNKNOWN';
