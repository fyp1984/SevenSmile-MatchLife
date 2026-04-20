CREATE TABLE IF NOT EXISTS public.page_visit_events (
  id BIGSERIAL PRIMARY KEY,
  visit_date DATE NOT NULL DEFAULT CURRENT_DATE,
  network_signature TEXT NOT NULL,
  device_type TEXT NOT NULL DEFAULT 'other',
  source_host TEXT NOT NULL DEFAULT '',
  app_scope TEXT NOT NULL DEFAULT 'matchlife',
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_page_visit_events_unique_daily
  ON public.page_visit_events (visit_date, network_signature, device_type, source_host, app_scope);

CREATE INDEX IF NOT EXISTS idx_page_visit_events_scope_date
  ON public.page_visit_events (source_host, app_scope, visit_date DESC);

CREATE OR REPLACE FUNCTION public.record_page_visit(
  p_source_host TEXT,
  p_app_scope TEXT,
  p_network_signature TEXT,
  p_device_type TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.page_visit_events (
    visit_date,
    network_signature,
    device_type,
    source_host,
    app_scope,
    first_seen_at,
    last_seen_at
  ) VALUES (
    CURRENT_DATE,
    COALESCE(NULLIF(TRIM(p_network_signature), ''), 'unknown'),
    COALESCE(NULLIF(TRIM(p_device_type), ''), 'other'),
    COALESCE(NULLIF(TRIM(p_source_host), ''), 'unknown'),
    COALESCE(NULLIF(TRIM(p_app_scope), ''), 'matchlife'),
    NOW(),
    NOW()
  )
  ON CONFLICT (visit_date, network_signature, device_type, source_host, app_scope)
  DO UPDATE SET last_seen_at = NOW();
END;
$$;

CREATE OR REPLACE FUNCTION public.get_page_visit_stats(
  p_source_host TEXT,
  p_app_scope TEXT
) RETURNS TABLE (
  today_count BIGINT,
  week_count BIGINT,
  month_count BIGINT,
  all_time_count BIGINT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH scoped AS (
    SELECT
      visit_date,
      network_signature,
      device_type
    FROM public.page_visit_events
    WHERE source_host = COALESCE(NULLIF(TRIM(p_source_host), ''), 'unknown')
      AND app_scope = COALESCE(NULLIF(TRIM(p_app_scope), ''), 'matchlife')
  ),
  ranges AS (
    SELECT
      CURRENT_DATE AS today_start,
      date_trunc('week', CURRENT_DATE::timestamp)::date AS week_start,
      date_trunc('month', CURRENT_DATE::timestamp)::date AS month_start
  )
  SELECT
    COUNT(DISTINCT (CASE WHEN s.visit_date = r.today_start THEN s.network_signature END, CASE WHEN s.visit_date = r.today_start THEN s.device_type END)) FILTER (WHERE s.visit_date = r.today_start) AS today_count,
    COUNT(DISTINCT (CASE WHEN s.visit_date >= r.week_start THEN s.network_signature END, CASE WHEN s.visit_date >= r.week_start THEN s.device_type END)) FILTER (WHERE s.visit_date >= r.week_start) AS week_count,
    COUNT(DISTINCT (CASE WHEN s.visit_date >= r.month_start THEN s.network_signature END, CASE WHEN s.visit_date >= r.month_start THEN s.device_type END)) FILTER (WHERE s.visit_date >= r.month_start) AS month_count,
    COUNT(DISTINCT (s.network_signature, s.device_type)) AS all_time_count
  FROM scoped s
  CROSS JOIN ranges r;
$$;

REVOKE ALL ON TABLE public.page_visit_events FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_page_visit(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_page_visit_stats(TEXT, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.record_page_visit(TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_page_visit_stats(TEXT, TEXT) TO anon, authenticated;
