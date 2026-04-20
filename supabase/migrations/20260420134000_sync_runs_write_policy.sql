ALTER TABLE IF EXISTS public.sync_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service write sync_runs" ON public.sync_runs;
CREATE POLICY "Service write sync_runs"
  ON public.sync_runs
  FOR INSERT
  TO service_role, authenticated
  WITH CHECK (TRUE);

DROP POLICY IF EXISTS "Service update sync_runs" ON public.sync_runs;
CREATE POLICY "Service update sync_runs"
  ON public.sync_runs
  FOR UPDATE
  TO service_role, authenticated
  USING (TRUE)
  WITH CHECK (TRUE);

GRANT INSERT, UPDATE, SELECT ON public.sync_runs TO service_role, authenticated;
