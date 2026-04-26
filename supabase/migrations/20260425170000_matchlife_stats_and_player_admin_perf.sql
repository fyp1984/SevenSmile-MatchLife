CREATE OR REPLACE FUNCTION public.matchlife_infer_match_mode_sql(
  p_event_key TEXT,
  p_category TEXT,
  p_players_a TEXT[],
  p_players_b TEXT[]
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN concat_ws(' ', coalesce(p_event_key, ''), coalesce(p_category, '')) ~ '混双|男双|女双|双打' THEN 'doubles'
    WHEN concat_ws(' ', coalesce(p_event_key, ''), coalesce(p_category, '')) ~ '男单|女单|单打' THEN 'singles'
    WHEN GREATEST(COALESCE(array_length(p_players_a, 1), 0), COALESCE(array_length(p_players_b, 1), 0)) >= 2 THEN 'doubles'
    WHEN GREATEST(COALESCE(array_length(p_players_a, 1), 0), COALESCE(array_length(p_players_b, 1), 0)) = 1 THEN 'singles'
    WHEN concat_ws(' ', coalesce(p_event_key, ''), coalesce(p_category, '')) ~ '团体|团赛' THEN 'team'
    ELSE 'unknown'
  END;
$$;

CREATE OR REPLACE FUNCTION public.matchlife_infer_gender_bucket_sql(
  p_event_key TEXT,
  p_category TEXT,
  p_tournament_name TEXT,
  p_profile_gender TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN concat_ws(' ', coalesce(p_event_key, ''), coalesce(p_category, ''), coalesce(p_tournament_name, '')) ~ '混双|混合' THEN 'mixed'
    WHEN concat_ws(' ', coalesce(p_event_key, ''), coalesce(p_category, ''), coalesce(p_tournament_name, '')) ~ '女' THEN 'female'
    WHEN concat_ws(' ', coalesce(p_event_key, ''), coalesce(p_category, ''), coalesce(p_tournament_name, '')) ~ '男' THEN 'male'
    WHEN lower(trim(coalesce(p_profile_gender, ''))) = 'female' THEN 'female'
    WHEN lower(trim(coalesce(p_profile_gender, ''))) = 'male' THEN 'male'
    ELSE 'unknown'
  END;
$$;

CREATE OR REPLACE FUNCTION public.matchlife_delete_player_profile(
  p_player_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count INT := 0;
BEGIN
  DELETE FROM public.players
  WHERE id = p_player_id;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.matchlife_get_filtered_player_rankings(
  p_sport_type TEXT DEFAULT NULL,
  p_gender TEXT DEFAULT 'all',
  p_mode TEXT DEFAULT 'all',
  p_limit INT DEFAULT 100,
  p_offset INT DEFAULT 0
)
RETURNS TABLE (
  rank BIGINT,
  player_id UUID,
  player_name TEXT,
  avatar_url TEXT,
  total_matches BIGINT,
  wins BIGINT,
  win_rate NUMERIC,
  last_active TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH base_matches AS (
    SELECT
      m.players_a,
      m.players_b,
      m.winner_side,
      m.event_key,
      m.category,
      m.tournament_name,
      m.source,
      COALESCE(m.start_time, m.match_ended_at, m.match_started_at, m.source_updated_at, m.updated_at, m.created_at) AS last_active,
      public.matchlife_infer_sport(m.source, m.tournament_name, m.event_key, m.category) AS primary_sport,
      public.matchlife_infer_match_mode_sql(m.event_key, m.category, m.players_a, m.players_b) AS match_mode
    FROM public.matches m
    WHERE m.winner_side IN ('A', 'B')
  ),
  filtered_matches AS (
    SELECT *
    FROM base_matches
    WHERE (p_sport_type IS NULL OR p_sport_type = '' OR primary_sport = p_sport_type)
      AND (
        coalesce(nullif(lower(trim(p_mode)), ''), 'all') = 'all'
        OR match_mode = lower(trim(p_mode))
      )
  ),
  expanded_players AS (
    SELECT
      trim(players.player_name) AS player_name,
      m.primary_sport,
      m.last_active,
      CASE
        WHEN players.side = m.winner_side THEN 1
        ELSE 0
      END AS is_win,
      profile.avatar_url,
      public.matchlife_infer_gender_bucket_sql(m.event_key, m.category, m.tournament_name, profile.gender) AS gender_bucket
    FROM filtered_matches m
    CROSS JOIN LATERAL (
      SELECT 'A'::TEXT AS side, unnest(m.players_a) AS player_name
      UNION ALL
      SELECT 'B'::TEXT AS side, unnest(m.players_b) AS player_name
    ) players
    LEFT JOIN LATERAL (
      SELECT p.avatar_url, p.gender
      FROM public.players p
      WHERE lower(trim(p.player_name)) = lower(trim(players.player_name))
        AND (
          p_sport_type IS NULL
          OR p_sport_type = ''
          OR lower(trim(coalesce(p.primary_sport, p_sport_type))) = lower(trim(p_sport_type))
        )
      ORDER BY (p.status = 'active') DESC, p.updated_at DESC NULLS LAST, p.created_at DESC NULLS LAST
      LIMIT 1
    ) profile ON TRUE
    WHERE trim(players.player_name) <> ''
      AND (
        coalesce(nullif(lower(trim(p_gender)), ''), 'all') = 'all'
        OR public.matchlife_infer_gender_bucket_sql(m.event_key, m.category, m.tournament_name, profile.gender) = lower(trim(p_gender))
      )
  ),
  aggregated_rankings AS (
    SELECT
      public.matchlife_player_rank_uuid(player_name, primary_sport) AS player_id,
      player_name,
      max(avatar_url) FILTER (WHERE avatar_url IS NOT NULL AND avatar_url <> '') AS avatar_url,
      count(*)::BIGINT AS total_matches,
      sum(is_win)::BIGINT AS wins,
      round((sum(is_win)::NUMERIC / nullif(count(*), 0)) * 100, 1) AS win_rate,
      max(last_active) AS last_active
    FROM expanded_players
    GROUP BY player_name, primary_sport
  )
  SELECT
    row_number() OVER (
      ORDER BY win_rate DESC, wins DESC, total_matches DESC, last_active DESC, player_name ASC
    )::BIGINT AS rank,
    player_id,
    player_name,
    avatar_url,
    total_matches,
    wins,
    win_rate,
    last_active
  FROM aggregated_rankings
  ORDER BY win_rate DESC, wins DESC, total_matches DESC, last_active DESC, player_name ASC
  LIMIT LEAST(GREATEST(coalesce(p_limit, 100), 1), 500)
  OFFSET GREATEST(coalesce(p_offset, 0), 0);
$$;

CREATE OR REPLACE FUNCTION public.matchlife_get_tournament_stats(
  p_tournament_name TEXT
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH target_matches AS (
    SELECT
      m.tournament_name,
      m.category,
      m.event_key,
      m.players_a,
      m.players_b,
      m.winner_side
    FROM public.matches m
    WHERE trim(coalesce(m.tournament_name, '')) = trim(coalesce(p_tournament_name, ''))
  ),
  player_pool AS (
    SELECT DISTINCT trim(player_name) AS player_name
    FROM target_matches m
    CROSS JOIN LATERAL unnest(coalesce(m.players_a, '{}'::TEXT[]) || coalesce(m.players_b, '{}'::TEXT[])) AS player_name
    WHERE trim(player_name) <> ''
  ),
  category_summary AS (
    SELECT
      coalesce(nullif(trim(category), ''), '未识别组别') AS category_name,
      count(*)::INT AS match_count
    FROM target_matches
    GROUP BY 1
  ),
  event_summary AS (
    SELECT
      coalesce(nullif(trim(event_key), ''), '未识别项目') AS event_name,
      count(*)::INT AS match_count,
      count(*) FILTER (WHERE winner_side IN ('A', 'B'))::INT AS finished_count
    FROM target_matches
    GROUP BY 1
  ),
  team_match_rows AS (
    SELECT
      coalesce(nullif(trim(event_key), ''), '未识别项目') AS event_name,
      trim(array_to_string(coalesce(players_a, '{}'::TEXT[]), ' / ')) AS team_name,
      CASE WHEN winner_side = 'A' THEN 1 ELSE 0 END AS wins,
      CASE WHEN winner_side = 'B' THEN 1 ELSE 0 END AS losses
    FROM target_matches
    WHERE winner_side IN ('A', 'B')
      AND trim(array_to_string(coalesce(players_a, '{}'::TEXT[]), ' / ')) <> ''

    UNION ALL

    SELECT
      coalesce(nullif(trim(event_key), ''), '未识别项目') AS event_name,
      trim(array_to_string(coalesce(players_b, '{}'::TEXT[]), ' / ')) AS team_name,
      CASE WHEN winner_side = 'B' THEN 1 ELSE 0 END AS wins,
      CASE WHEN winner_side = 'A' THEN 1 ELSE 0 END AS losses
    FROM target_matches
    WHERE winner_side IN ('A', 'B')
      AND trim(array_to_string(coalesce(players_b, '{}'::TEXT[]), ' / ')) <> ''
  ),
  ranked_teams AS (
    SELECT
      event_name,
      team_name,
      count(*)::INT AS played,
      sum(wins)::INT AS wins,
      sum(losses)::INT AS losses,
      round((sum(wins)::NUMERIC / nullif(count(*), 0)) * 100, 1) AS win_rate
    FROM team_match_rows
    GROUP BY event_name, team_name
  ),
  rankings_by_event AS (
    SELECT
      event_name,
      jsonb_agg(
        jsonb_build_object(
          'team', team_name,
          'played', played,
          'wins', wins,
          'losses', losses,
          'winRate', win_rate
        )
        ORDER BY wins DESC, win_rate DESC, played DESC, team_name ASC
      ) AS ranking_rows
    FROM ranked_teams
    GROUP BY event_name
  )
  SELECT jsonb_build_object(
    'selectedTournament', trim(coalesce(p_tournament_name, '')),
    'totalMatches', (SELECT count(*)::INT FROM target_matches),
    'finishedMatches', (SELECT count(*)::INT FROM target_matches WHERE winner_side IN ('A', 'B')),
    'totalPlayers', (SELECT count(*)::INT FROM player_pool),
    'totalTournaments', (SELECT count(DISTINCT tournament_name)::INT FROM target_matches WHERE trim(coalesce(tournament_name, '')) <> ''),
    'topCategories',
      coalesce(
        (
          SELECT jsonb_agg(
            jsonb_build_object('category', category_name, 'count', match_count)
            ORDER BY match_count DESC, category_name ASC
          )
          FROM (
            SELECT category_name, match_count
            FROM category_summary
            ORDER BY match_count DESC, category_name ASC
            LIMIT 6
          ) top_categories
        ),
        '[]'::JSONB
      ),
    'eventTabs',
      coalesce(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'eventKey', event_name,
              'matchCount', match_count,
              'finishedCount', finished_count
            )
            ORDER BY match_count DESC, event_name ASC
          )
          FROM event_summary
        ),
        '[]'::JSONB
      ),
    'rankingByEvent',
      coalesce(
        (
          SELECT jsonb_object_agg(event_name, ranking_rows)
          FROM rankings_by_event
        ),
        '{}'::JSONB
      )
  );
$$;

CREATE INDEX IF NOT EXISTS idx_matches_tournament_event_winner_recent
  ON public.matches(tournament_name, event_key, winner_side, start_time DESC, source_updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_players_name_sport_lookup
  ON public.players(lower(trim(player_name)), lower(trim(primary_sport)), updated_at DESC);

REVOKE ALL ON FUNCTION public.matchlife_delete_player_profile(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.matchlife_get_filtered_player_rankings(TEXT, TEXT, TEXT, INT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.matchlife_get_tournament_stats(TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.matchlife_delete_player_profile(UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.matchlife_get_filtered_player_rankings(TEXT, TEXT, TEXT, INT, INT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.matchlife_get_tournament_stats(TEXT) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
