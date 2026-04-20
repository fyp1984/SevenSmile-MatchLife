CREATE TABLE IF NOT EXISTS public.matchlife_data_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('api', 'html', 'file')),
  url TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('ymq-json', 'matchlife-source-json')),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  origin TEXT NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual', 'imported'))
);

CREATE INDEX IF NOT EXISTS idx_matchlife_data_sources_enabled_updated
  ON public.matchlife_data_sources (enabled, updated_at DESC);

ALTER TABLE public.matchlife_data_sources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read data sources" ON public.matchlife_data_sources;
CREATE POLICY "Public read data sources"
  ON public.matchlife_data_sources
  FOR SELECT
  USING (TRUE);

DROP POLICY IF EXISTS "Public write data sources" ON public.matchlife_data_sources;
CREATE POLICY "Public write data sources"
  ON public.matchlife_data_sources
  FOR ALL
  USING (TRUE)
  WITH CHECK (TRUE);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.matchlife_data_sources TO anon;
GRANT ALL PRIVILEGES ON public.matchlife_data_sources TO authenticated;

CREATE OR REPLACE FUNCTION public.matchlife_list_recent_tournaments(p_limit INT DEFAULT 30)
RETURNS TABLE (
  tournament_name TEXT,
  latest_at TIMESTAMPTZ,
  match_count BIGINT
)
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    m.tournament_name,
    MAX(COALESCE(m.source_updated_at, m.start_time, NOW())) AS latest_at,
    COUNT(*)::BIGINT AS match_count
  FROM public.matches m
  WHERE COALESCE(TRIM(m.tournament_name), '') <> ''
  GROUP BY m.tournament_name
  ORDER BY latest_at DESC
  LIMIT GREATEST(COALESCE(p_limit, 30), 1);
$$;

REVOKE ALL ON FUNCTION public.matchlife_list_recent_tournaments(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.matchlife_list_recent_tournaments(INT) TO anon, authenticated, service_role;
