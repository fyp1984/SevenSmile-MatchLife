CREATE TABLE IF NOT EXISTS public.page_visit_requests (
  id BIGSERIAL PRIMARY KEY,
  request_id UUID NOT NULL DEFAULT gen_random_uuid(),
  request_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  visit_date DATE NOT NULL DEFAULT CURRENT_DATE,
  source_host TEXT NOT NULL DEFAULT '',
  app_scope TEXT NOT NULL DEFAULT 'matchlife',
  page_path TEXT NOT NULL DEFAULT '/',
  network_signature TEXT NOT NULL,
  device_type TEXT NOT NULL DEFAULT 'other'
);

CREATE INDEX IF NOT EXISTS idx_page_visit_requests_scope_time
  ON public.page_visit_requests (source_host, app_scope, request_at DESC);

CREATE INDEX IF NOT EXISTS idx_page_visit_requests_scope_date
  ON public.page_visit_requests (source_host, app_scope, visit_date DESC);

CREATE OR REPLACE FUNCTION public.record_page_visit(
  p_source_host TEXT,
  p_app_scope TEXT,
  p_network_signature TEXT,
  p_device_type TEXT,
  p_page_path TEXT DEFAULT '/'
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source_host TEXT := COALESCE(NULLIF(TRIM(p_source_host), ''), 'unknown');
  v_app_scope TEXT := COALESCE(NULLIF(TRIM(p_app_scope), ''), 'matchlife');
  v_signature TEXT := COALESCE(NULLIF(TRIM(p_network_signature), ''), 'unknown');
  v_device_type TEXT := COALESCE(NULLIF(TRIM(p_device_type), ''), 'other');
  v_page_path TEXT := COALESCE(NULLIF(TRIM(p_page_path), ''), '/');
BEGIN
  INSERT INTO public.page_visit_requests (
    request_at,
    visit_date,
    source_host,
    app_scope,
    page_path,
    network_signature,
    device_type
  ) VALUES (
    NOW(),
    CURRENT_DATE,
    v_source_host,
    v_app_scope,
    v_page_path,
    v_signature,
    v_device_type
  );

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
    v_signature,
    v_device_type,
    v_source_host,
    v_app_scope,
    NOW(),
    NOW()
  )
  ON CONFLICT (visit_date, network_signature, device_type, source_host, app_scope)
  DO UPDATE SET last_seen_at = NOW();
END;
$$;

REVOKE ALL ON TABLE public.page_visit_requests FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_page_visit(TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_page_visit(TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
