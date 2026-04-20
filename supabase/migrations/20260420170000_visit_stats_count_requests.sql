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
    SELECT request_at
    FROM public.page_visit_requests
    WHERE source_host = COALESCE(NULLIF(TRIM(p_source_host), ''), 'unknown')
      AND app_scope = COALESCE(NULLIF(TRIM(p_app_scope), ''), 'matchlife')
  ),
  ranges AS (
    SELECT
      date_trunc('day', NOW()) AS today_start,
      date_trunc('week', NOW()) AS week_start,
      date_trunc('month', NOW()) AS month_start
  )
  SELECT
    COUNT(*) FILTER (WHERE s.request_at >= r.today_start) AS today_count,
    COUNT(*) FILTER (WHERE s.request_at >= r.week_start) AS week_count,
    COUNT(*) FILTER (WHERE s.request_at >= r.month_start) AS month_count,
    COUNT(*) AS all_time_count
  FROM scoped s
  CROSS JOIN ranges r;
$$;

REVOKE ALL ON FUNCTION public.get_page_visit_stats(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_page_visit_stats(TEXT, TEXT) TO anon, authenticated;
