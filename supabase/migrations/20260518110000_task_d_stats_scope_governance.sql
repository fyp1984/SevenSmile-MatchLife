CREATE OR REPLACE FUNCTION public.matchlife_stats_record_is_stable(
  p_match_status TEXT,
  p_lifecycle_status TEXT,
  p_persist_version INT,
  p_persisted_from_cache_at TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    coalesce(p_persist_version, 0) > 0
    AND p_persisted_from_cache_at IS NOT NULL
    AND coalesce(p_lifecycle_status, '') IN ('persisted', 'archived')
    AND coalesce(p_match_status, 'UNKNOWN') NOT IN ('LIVE', 'UNKNOWN');
$$;

CREATE OR REPLACE FUNCTION public.matchlife_stats_blocking_state_code(
  p_cache_status TEXT,
  p_lifecycle_status TEXT,
  p_match_status TEXT
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN coalesce(p_lifecycle_status, '') = 'manual_review' THEN 'manual_review'
    WHEN coalesce(p_lifecycle_status, '') = 'quality_blocked' THEN 'quality_blocked'
    WHEN coalesce(p_lifecycle_status, '') = 'persist_failed' THEN 'persist_failed'
    WHEN coalesce(p_lifecycle_status, '') = 'pending_persist'
      OR coalesce(p_cache_status, '') = 'READY_TO_PERSIST' THEN 'pending_persist'
    WHEN coalesce(p_cache_status, '') = 'ACTIVE'
      OR coalesce(p_lifecycle_status, '') IN ('normalized', 'hot_cached')
      OR coalesce(p_match_status, '') = 'LIVE' THEN 'active_cached'
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.matchlife_stats_primary_reason_code(
  p_active_cached_count INT,
  p_pending_persist_count INT,
  p_persist_failed_count INT,
  p_manual_review_count INT,
  p_quality_blocked_count INT
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN coalesce(p_manual_review_count, 0) > 0 THEN 'manual_review'
    WHEN coalesce(p_quality_blocked_count, 0) > 0 THEN 'quality_blocked'
    WHEN coalesce(p_persist_failed_count, 0) > 0 THEN 'persist_failed'
    WHEN coalesce(p_pending_persist_count, 0) > 0 THEN 'pending_persist'
    WHEN coalesce(p_active_cached_count, 0) > 0 THEN 'active_cached'
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.matchlife_stats_scope_summary(
  p_scope_type TEXT,
  p_scope_label TEXT
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN coalesce(p_scope_type, '') = 'tournament'
      THEN '仅影响当前赛事统计，不影响其他赛事、首页检索与详情页。'
    WHEN coalesce(p_scope_type, '') = 'leaderboard'
      THEN '仅影响当前榜单筛选范围，不影响其他筛选条件和全站实时比分。'
    ELSE concat('仅影响当前范围：', coalesce(nullif(trim(p_scope_label), ''), '未命名范围'), '。')
  END;
$$;

CREATE OR REPLACE FUNCTION public.matchlife_stats_pause_reason_text(
  p_scope_type TEXT,
  p_scope_label TEXT,
  p_primary_reason_code TEXT,
  p_active_cached_count INT,
  p_pending_persist_count INT,
  p_persist_failed_count INT,
  p_manual_review_count INT,
  p_quality_blocked_count INT
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE coalesce(p_primary_reason_code, '')
    WHEN 'manual_review' THEN
      format(
        '当前%s“%s”包含 %s 场待人工确认的比赛，统计先暂停，避免未裁定结果进入榜单或汇总。',
        CASE WHEN coalesce(p_scope_type, '') = 'leaderboard' THEN '榜单范围' ELSE '赛事范围' END,
        coalesce(nullif(trim(p_scope_label), ''), '当前范围'),
        greatest(coalesce(p_manual_review_count, 0), 1)
      )
    WHEN 'quality_blocked' THEN
      format(
        '当前%s“%s”包含 %s 场被质量规则拦截的比赛，统计先暂停，避免异常快照污染结果。',
        CASE WHEN coalesce(p_scope_type, '') = 'leaderboard' THEN '榜单范围' ELSE '赛事范围' END,
        coalesce(nullif(trim(p_scope_label), ''), '当前范围'),
        greatest(coalesce(p_quality_blocked_count, 0), 1)
      )
    WHEN 'persist_failed' THEN
      format(
        '当前%s“%s”有 %s 场比赛正式落库失败，统计先暂停，等待补偿重试或人工修复完成。',
        CASE WHEN coalesce(p_scope_type, '') = 'leaderboard' THEN '榜单范围' ELSE '赛事范围' END,
        coalesce(nullif(trim(p_scope_label), ''), '当前范围'),
        greatest(coalesce(p_persist_failed_count, 0), 1)
      )
    WHEN 'pending_persist' THEN
      format(
        '当前%s“%s”仍有 %s 场待正式落库比赛，且另有 %s 场实时缓存仍在处理，统计会在落库完成后恢复。',
        CASE WHEN coalesce(p_scope_type, '') = 'leaderboard' THEN '榜单范围' ELSE '赛事范围' END,
        coalesce(nullif(trim(p_scope_label), ''), '当前范围'),
        greatest(coalesce(p_pending_persist_count, 0), 1),
        greatest(coalesce(p_active_cached_count, 0), 0)
      )
    WHEN 'active_cached' THEN
      format(
        '当前%s“%s”仍有 %s 场比赛处于实时缓存或进行中，统计先只保留稳定正式库数据，不计算该受影响范围。',
        CASE WHEN coalesce(p_scope_type, '') = 'leaderboard' THEN '榜单范围' ELSE '赛事范围' END,
        coalesce(nullif(trim(p_scope_label), ''), '当前范围'),
        greatest(coalesce(p_active_cached_count, 0), 1)
      )
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.matchlife_stats_recovery_hint_text(
  p_primary_reason_code TEXT
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE coalesce(p_primary_reason_code, '')
    WHEN 'manual_review' THEN '待人工确认完成并重新入库后自动恢复；若长时间未恢复，请前往“数据同步状态”页查看待审核项。'
    WHEN 'quality_blocked' THEN '待异常快照清理、质量校验通过并重新进入正式库后恢复。'
    WHEN 'persist_failed' THEN '待补偿重试成功或人工修复后恢复；若失败持续存在，请前往“数据同步状态”页查看失败原因。'
    WHEN 'pending_persist' THEN '待正式落库完成且受影响缓存清空后自动恢复。'
    WHEN 'active_cached' THEN '待比赛结束并从实时缓存推进到正式库后自动恢复。'
    ELSE '当前范围已可直接读取稳定统计数据。'
  END;
$$;

CREATE OR REPLACE FUNCTION public.matchlife_leaderboard_scope_label(
  p_sport_type TEXT,
  p_gender TEXT,
  p_mode TEXT
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT concat_ws(
    ' · ',
    CASE lower(trim(coalesce(p_sport_type, '')))
      WHEN 'badminton' THEN '羽毛球'
      WHEN 'tennis' THEN '网球'
      WHEN 'basketball' THEN '篮球'
      WHEN 'football' THEN '足球'
      WHEN 'tabletennis' THEN '乒乓球'
      WHEN '' THEN '全部项目'
      ELSE coalesce(nullif(trim(p_sport_type), ''), '全部项目')
    END,
    CASE lower(trim(coalesce(p_gender, 'all')))
      WHEN 'male' THEN '男子'
      WHEN 'female' THEN '女子'
      WHEN 'mixed' THEN '混合'
      ELSE '全部性别'
    END,
    CASE lower(trim(coalesce(p_mode, 'all')))
      WHEN 'singles' THEN '单打'
      WHEN 'doubles' THEN '双打'
      WHEN 'team' THEN '团体'
      ELSE '全部形式'
    END
  );
$$;

CREATE OR REPLACE VIEW public.matchlife_stats_governance_impacts AS
SELECT
  c.id,
  c.source,
  c.sport_type,
  coalesce(nullif(trim(c.tournament_name), ''), '未命名赛事') AS tournament_name,
  public.matchlife_infer_gender_bucket_sql(
    c.event_key,
    c.category,
    c.tournament_name,
    NULL
  ) AS gender_bucket,
  public.matchlife_infer_match_mode_sql(
    c.event_key,
    c.category,
    c.players_a,
    c.players_b
  ) AS match_mode,
  c.match_status,
  c.lifecycle_status,
  c.cache_status,
  public.matchlife_stats_blocking_state_code(
    c.cache_status,
    c.lifecycle_status,
    c.match_status
  ) AS reason_code,
  c.source_updated_at
FROM public.active_match_cache c
WHERE public.matchlife_stats_blocking_state_code(
  c.cache_status,
  c.lifecycle_status,
  c.match_status
) IS NOT NULL;

GRANT SELECT ON public.matchlife_stats_governance_impacts TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.matchlife_get_tournament_stats_readiness(
  p_tournament_name TEXT
)
RETURNS TABLE (
  scope_type TEXT,
  scope_key TEXT,
  scope_label TEXT,
  scope_summary TEXT,
  scope_status TEXT,
  is_paused BOOLEAN,
  primary_reason_code TEXT,
  pause_reason TEXT,
  recovery_hint TEXT,
  affected_match_count INT,
  active_cached_count INT,
  pending_persist_count INT,
  persist_failed_count INT,
  manual_review_count INT,
  quality_blocked_count INT,
  affected_sources TEXT[],
  affected_tournaments TEXT[],
  latest_source_updated_at TIMESTAMPTZ,
  last_persisted_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH params AS (
    SELECT coalesce(nullif(trim(p_tournament_name), ''), '未选择赛事') AS scope_label
  ),
  blocking AS (
    SELECT *
    FROM public.matchlife_stats_governance_impacts i
    CROSS JOIN params p
    WHERE i.tournament_name = p.scope_label
  ),
  agg AS (
    SELECT
      count(*)::INT AS affected_match_count,
      count(*) FILTER (WHERE reason_code = 'active_cached')::INT AS active_cached_count,
      count(*) FILTER (WHERE reason_code = 'pending_persist')::INT AS pending_persist_count,
      count(*) FILTER (WHERE reason_code = 'persist_failed')::INT AS persist_failed_count,
      count(*) FILTER (WHERE reason_code = 'manual_review')::INT AS manual_review_count,
      count(*) FILTER (WHERE reason_code = 'quality_blocked')::INT AS quality_blocked_count,
      coalesce(array_agg(DISTINCT source) FILTER (WHERE source IS NOT NULL), '{}'::TEXT[]) AS affected_sources,
      coalesce(array_agg(DISTINCT tournament_name) FILTER (WHERE tournament_name IS NOT NULL), '{}'::TEXT[]) AS affected_tournaments,
      max(source_updated_at) AS latest_source_updated_at
    FROM blocking
  )
  SELECT
    'tournament'::TEXT AS scope_type,
    concat('tournament:', p.scope_label) AS scope_key,
    p.scope_label,
    public.matchlife_stats_scope_summary('tournament', p.scope_label) AS scope_summary,
    CASE WHEN a.affected_match_count > 0 THEN 'paused' ELSE 'ready' END AS scope_status,
    a.affected_match_count > 0 AS is_paused,
    public.matchlife_stats_primary_reason_code(
      a.active_cached_count,
      a.pending_persist_count,
      a.persist_failed_count,
      a.manual_review_count,
      a.quality_blocked_count
    ) AS primary_reason_code,
    public.matchlife_stats_pause_reason_text(
      'tournament',
      p.scope_label,
      public.matchlife_stats_primary_reason_code(
        a.active_cached_count,
        a.pending_persist_count,
        a.persist_failed_count,
        a.manual_review_count,
        a.quality_blocked_count
      ),
      a.active_cached_count,
      a.pending_persist_count,
      a.persist_failed_count,
      a.manual_review_count,
      a.quality_blocked_count
    ) AS pause_reason,
    public.matchlife_stats_recovery_hint_text(
      public.matchlife_stats_primary_reason_code(
        a.active_cached_count,
        a.pending_persist_count,
        a.persist_failed_count,
        a.manual_review_count,
        a.quality_blocked_count
      )
    ) AS recovery_hint,
    a.affected_match_count,
    a.active_cached_count,
    a.pending_persist_count,
    a.persist_failed_count,
    a.manual_review_count,
    a.quality_blocked_count,
    a.affected_sources,
    a.affected_tournaments,
    a.latest_source_updated_at,
    (SELECT last_persisted_at FROM public.sync_runtime_state LIMIT 1) AS last_persisted_at
  FROM params p
  CROSS JOIN agg a;
$$;

CREATE OR REPLACE FUNCTION public.matchlife_get_leaderboard_readiness(
  p_sport_type TEXT DEFAULT NULL,
  p_gender TEXT DEFAULT 'all',
  p_mode TEXT DEFAULT 'all'
)
RETURNS TABLE (
  scope_type TEXT,
  scope_key TEXT,
  scope_label TEXT,
  scope_summary TEXT,
  scope_status TEXT,
  is_paused BOOLEAN,
  primary_reason_code TEXT,
  pause_reason TEXT,
  recovery_hint TEXT,
  affected_match_count INT,
  active_cached_count INT,
  pending_persist_count INT,
  persist_failed_count INT,
  manual_review_count INT,
  quality_blocked_count INT,
  affected_sources TEXT[],
  affected_tournaments TEXT[],
  latest_source_updated_at TIMESTAMPTZ,
  last_persisted_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH params AS (
    SELECT
      nullif(trim(coalesce(p_sport_type, '')), '') AS sport_type,
      lower(trim(coalesce(p_gender, 'all'))) AS gender_bucket,
      lower(trim(coalesce(p_mode, 'all'))) AS match_mode,
      public.matchlife_leaderboard_scope_label(
        p_sport_type,
        p_gender,
        p_mode
      ) AS scope_label
  ),
  blocking AS (
    SELECT i.*
    FROM public.matchlife_stats_governance_impacts i
    CROSS JOIN params p
    WHERE (p.sport_type IS NULL OR i.sport_type = p.sport_type)
      AND (
        p.gender_bucket = 'all'
        OR i.gender_bucket = p.gender_bucket
        OR i.gender_bucket = 'unknown'
      )
      AND (
        p.match_mode = 'all'
        OR i.match_mode = p.match_mode
        OR i.match_mode = 'unknown'
      )
  ),
  agg AS (
    SELECT
      count(*)::INT AS affected_match_count,
      count(*) FILTER (WHERE reason_code = 'active_cached')::INT AS active_cached_count,
      count(*) FILTER (WHERE reason_code = 'pending_persist')::INT AS pending_persist_count,
      count(*) FILTER (WHERE reason_code = 'persist_failed')::INT AS persist_failed_count,
      count(*) FILTER (WHERE reason_code = 'manual_review')::INT AS manual_review_count,
      count(*) FILTER (WHERE reason_code = 'quality_blocked')::INT AS quality_blocked_count,
      coalesce(array_agg(DISTINCT source) FILTER (WHERE source IS NOT NULL), '{}'::TEXT[]) AS affected_sources,
      coalesce(array_agg(DISTINCT tournament_name) FILTER (WHERE tournament_name IS NOT NULL), '{}'::TEXT[]) AS affected_tournaments,
      max(source_updated_at) AS latest_source_updated_at
    FROM blocking
  )
  SELECT
    'leaderboard'::TEXT AS scope_type,
    concat(
      'leaderboard:',
      coalesce(p.sport_type, 'all'),
      ':',
      p.gender_bucket,
      ':',
      p.match_mode
    ) AS scope_key,
    p.scope_label,
    public.matchlife_stats_scope_summary('leaderboard', p.scope_label) AS scope_summary,
    CASE WHEN a.affected_match_count > 0 THEN 'paused' ELSE 'ready' END AS scope_status,
    a.affected_match_count > 0 AS is_paused,
    public.matchlife_stats_primary_reason_code(
      a.active_cached_count,
      a.pending_persist_count,
      a.persist_failed_count,
      a.manual_review_count,
      a.quality_blocked_count
    ) AS primary_reason_code,
    public.matchlife_stats_pause_reason_text(
      'leaderboard',
      p.scope_label,
      public.matchlife_stats_primary_reason_code(
        a.active_cached_count,
        a.pending_persist_count,
        a.persist_failed_count,
        a.manual_review_count,
        a.quality_blocked_count
      ),
      a.active_cached_count,
      a.pending_persist_count,
      a.persist_failed_count,
      a.manual_review_count,
      a.quality_blocked_count
    ) AS pause_reason,
    public.matchlife_stats_recovery_hint_text(
      public.matchlife_stats_primary_reason_code(
        a.active_cached_count,
        a.pending_persist_count,
        a.persist_failed_count,
        a.manual_review_count,
        a.quality_blocked_count
      )
    ) AS recovery_hint,
    a.affected_match_count,
    a.active_cached_count,
    a.pending_persist_count,
    a.persist_failed_count,
    a.manual_review_count,
    a.quality_blocked_count,
    a.affected_sources,
    a.affected_tournaments,
    a.latest_source_updated_at,
    (SELECT last_persisted_at FROM public.sync_runtime_state LIMIT 1) AS last_persisted_at
  FROM params p
  CROSS JOIN agg a;
$$;

CREATE OR REPLACE FUNCTION public.matchlife_list_recent_tournaments(p_limit INT DEFAULT 30)
RETURNS TABLE (
  tournament_name TEXT,
  latest_at TIMESTAMPTZ,
  match_count BIGINT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    m.tournament_name,
    MAX(COALESCE(m.persisted_from_cache_at, m.source_updated_at, m.start_time, NOW())) AS latest_at,
    COUNT(*)::BIGINT AS match_count
  FROM public.matches m
  WHERE public.matchlife_stats_record_is_stable(
    m.match_status,
    m.lifecycle_status,
    m.persist_version,
    m.persisted_from_cache_at
  )
    AND COALESCE(TRIM(m.tournament_name), '') <> ''
  GROUP BY m.tournament_name
  ORDER BY latest_at DESC
  LIMIT GREATEST(COALESCE(p_limit, 30), 1);
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
      COALESCE(m.persisted_from_cache_at, m.match_ended_at, m.source_updated_at, m.updated_at, m.created_at) AS last_active,
      public.matchlife_infer_sport(m.source, m.tournament_name, m.event_key, m.category) AS primary_sport,
      public.matchlife_infer_match_mode_sql(m.event_key, m.category, m.players_a, m.players_b) AS match_mode
    FROM public.matches m
    WHERE m.winner_side IN ('A', 'B')
      AND public.matchlife_stats_record_is_stable(
        m.match_status,
        m.lifecycle_status,
        m.persist_version,
        m.persisted_from_cache_at
      )
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
      AND public.matchlife_stats_record_is_stable(
        m.match_status,
        m.lifecycle_status,
        m.persist_version,
        m.persisted_from_cache_at
      )
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

REVOKE ALL ON FUNCTION public.matchlife_get_tournament_stats_readiness(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.matchlife_get_leaderboard_readiness(TEXT, TEXT, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.matchlife_get_tournament_stats_readiness(TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.matchlife_get_leaderboard_readiness(TEXT, TEXT, TEXT) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
