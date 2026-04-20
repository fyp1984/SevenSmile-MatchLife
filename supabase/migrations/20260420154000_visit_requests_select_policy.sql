ALTER TABLE IF EXISTS public.page_visit_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read page_visit_requests" ON public.page_visit_requests;
CREATE POLICY "Public read page_visit_requests"
  ON public.page_visit_requests
  FOR SELECT
  USING (TRUE);

GRANT SELECT ON public.page_visit_requests TO anon, authenticated, service_role;
