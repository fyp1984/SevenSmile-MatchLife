-- Migration: Add pg_cron schedule for refresh_player_rankings
-- Enables automatic refresh of the player rankings materialized view

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Add a cron job to refresh the materialized view every 15 minutes
DO $$
BEGIN
  PERFORM cron.schedule(
    'refresh-player-rankings-history-cache',
    '*/15 * * * *',
    'SELECT public.refresh_player_rankings()'
  );
END
$$;
