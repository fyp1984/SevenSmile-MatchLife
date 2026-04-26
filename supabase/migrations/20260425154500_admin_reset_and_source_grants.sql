GRANT EXECUTE ON FUNCTION public.matchlife_reset_db() TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.matchlife_data_sources TO service_role;
