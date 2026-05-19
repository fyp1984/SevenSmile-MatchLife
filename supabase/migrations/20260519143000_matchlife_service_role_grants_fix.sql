GRANT EXECUTE ON FUNCTION public.matchlife_reset_db() TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.matches TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sync_runs TO service_role;
