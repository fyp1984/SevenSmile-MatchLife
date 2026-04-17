-- Public read policies for MVP (no-login)

ALTER TABLE IF EXISTS public.matches ADD COLUMN IF NOT EXISTS players_text TEXT;
ALTER TABLE IF EXISTS public.matches ADD COLUMN IF NOT EXISTS raw JSONB;
ALTER TABLE IF EXISTS public.matches ADD COLUMN IF NOT EXISTS court_num INT;
ALTER TABLE IF EXISTS public.matches ADD COLUMN IF NOT EXISTS match_no INT;
ALTER TABLE IF EXISTS public.matches ADD COLUMN IF NOT EXISTS match_time_name TEXT;

UPDATE public.matches
SET players_text = NULLIF(TRIM(array_to_string(players_a || players_b, ' ')), '')
WHERE players_text IS NULL;

ALTER TABLE IF EXISTS public.matches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read matches" ON public.matches;
CREATE POLICY "Public read matches" ON public.matches
  FOR SELECT
  TO anon
  USING (true);

ALTER TABLE IF EXISTS public.sync_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read sync_runs" ON public.sync_runs;
CREATE POLICY "Public read sync_runs" ON public.sync_runs
  FOR SELECT
  TO anon
  USING (true);

