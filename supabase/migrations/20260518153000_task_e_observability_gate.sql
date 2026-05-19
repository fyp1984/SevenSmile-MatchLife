CREATE OR REPLACE FUNCTION public.matchlife_observability_reason_severity(
  p_reason_code TEXT
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE coalesce(trim(p_reason_code), '')
    WHEN 'manual_review' THEN 'critical'
    WHEN 'quality_blocked' THEN 'critical'
    WHEN 'persist_failed' THEN 'critical'
    WHEN 'source_failing' THEN 'critical'
    WHEN 'source_collection_failed' THEN 'critical'
    WHEN 'pending_persist' THEN 'warning'
    WHEN 'active_cached' THEN 'warning'
    WHEN 'source_degraded' THEN 'warning'
    WHEN 'source_paused' THEN 'info'
    ELSE 'info'
  END;
$$;

CREATE OR REPLACE FUNCTION public.matchlife_observability_recovery_action(
  p_layer TEXT,
  p_reason_code TEXT,
  p_error_code TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN coalesce(trim(p_layer), '') = 'source' AND coalesce(trim(p_error_code), '') IN ('MISSING_RACE_ID', 'BAD_SOURCE_URL', 'UNSUPPORTED_SOURCE_FORMAT')
      THEN '请先修正数据源 URL、format 或 adapter 配置，再重新执行来源同步。'
    WHEN coalesce(trim(p_layer), '') = 'source' AND coalesce(trim(p_error_code), '') IN ('TIMEOUT', 'NETWORK', 'UPSTREAM_5XX', 'RATE_LIMITED')
      THEN '等待自动重试或冷却窗口结束；若持续失败，请检查上游接口、网络与限流策略。'
    WHEN coalesce(trim(p_layer), '') = 'runtime'
      THEN public.matchlife_stats_recovery_hint_text(p_reason_code)
    WHEN coalesce(trim(p_layer), '') = 'governance'
      THEN public.matchlife_stats_recovery_hint_text(p_reason_code)
    WHEN coalesce(trim(p_layer), '') = 'sync_run' AND coalesce(trim(p_reason_code), '') = 'persist_failed'
      THEN '优先检查 persist_ready_active_matches 补偿重试结果；必要时执行人工修复后重新同步。'
    WHEN coalesce(trim(p_layer), '') = 'sync_run' AND coalesce(trim(p_reason_code), '') = 'cache'
      THEN '请检查 stage_live_matches 写入链路、缓存状态机和本次快照结构。'
    WHEN coalesce(trim(p_layer), '') = 'sync_run' AND coalesce(trim(p_reason_code), '') = 'source_collection_failed'
      THEN '请检查本次采集的来源配置、网络连通性与上游接口响应。'
    ELSE '请结合当前告警与运行记录执行自动重试、补偿重试、schema reload 或服务重启。'
  END;
$$;

CREATE OR REPLACE FUNCTION public.matchlife_observability_run_failure_stage(
  p_status TEXT,
  p_error_message TEXT,
  p_result_payload JSONB
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN coalesce(trim(p_status), '') = 'FAILED'
      AND coalesce(p_result_payload ->> 'errorCode', '') IN ('MISSING_RACE_ID', 'BAD_SOURCE_URL', 'UNSUPPORTED_SOURCE_FORMAT')
      THEN 'source'
    WHEN coalesce(trim(p_status), '') = 'FAILED'
      AND coalesce(p_result_payload ->> 'errorCode', '') IN ('TIMEOUT', 'NETWORK', 'UPSTREAM_5XX', 'RATE_LIMITED')
      THEN 'source_collection'
    WHEN coalesce(trim(p_status), '') = 'FAILED'
      AND coalesce(p_error_message, '') ~* '(stage_live_matches|active_match_cache|cache)'
      THEN 'cache'
    WHEN coalesce(trim(p_status), '') = 'FAILED'
      AND coalesce(p_error_message, '') ~* '(persist_ready_active_matches|persist_failed|matches)'
      THEN 'persist'
    WHEN coalesce(NULLIF(p_result_payload ->> 'persistFailedCount', ''), '0')::INT > 0
      THEN 'persist'
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.matchlife_observability_run_reason_code(
  p_status TEXT,
  p_error_message TEXT,
  p_result_payload JSONB
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN coalesce(trim(p_status), '') = 'FAILED'
      AND coalesce(p_result_payload ->> 'errorCode', '') <> ''
      THEN p_result_payload ->> 'errorCode'
    WHEN public.matchlife_observability_run_failure_stage(p_status, p_error_message, p_result_payload) = 'persist'
      THEN 'persist_failed'
    WHEN public.matchlife_observability_run_failure_stage(p_status, p_error_message, p_result_payload) = 'cache'
      THEN 'cache_write_failed'
    WHEN public.matchlife_observability_run_failure_stage(p_status, p_error_message, p_result_payload) = 'source_collection'
      THEN 'source_collection_failed'
    WHEN public.matchlife_observability_run_failure_stage(p_status, p_error_message, p_result_payload) = 'source'
      THEN 'source_config_invalid'
    ELSE NULL
  END;
$$;

CREATE OR REPLACE VIEW public.matchlife_runtime_observability AS
WITH runtime_base AS (
  SELECT
    COUNT(*) FILTER (WHERE cache_status = 'ACTIVE')::INT AS active_cached_count,
    COUNT(*) FILTER (WHERE cache_status = 'READY_TO_PERSIST')::INT AS pending_persist_count,
    COUNT(*) FILTER (WHERE cache_status = 'PERSISTED')::INT AS persisted_count,
    COUNT(*) FILTER (WHERE cache_status = 'STALE')::INT AS stale_count,
    COUNT(*) FILTER (WHERE lifecycle_status = 'persist_failed')::INT AS persist_failed_count,
    COUNT(*) FILTER (WHERE lifecycle_status = 'manual_review')::INT AS manual_review_count,
    COUNT(*) FILTER (WHERE lifecycle_status = 'quality_blocked')::INT AS quality_blocked_count,
    MAX(source_updated_at) AS last_source_updated_at,
    MAX(last_seen_at) AS last_cache_seen_at,
    MAX(persisted_at) AS last_persisted_at
  FROM public.active_match_cache
),
runtime_status AS (
  SELECT
    r.*,
    public.matchlife_stats_primary_reason_code(
      r.active_cached_count,
      r.pending_persist_count,
      r.persist_failed_count,
      r.manual_review_count,
      r.quality_blocked_count
    ) AS blocking_reason_code
  FROM runtime_base r
)
SELECT
  active_cached_count,
  pending_persist_count,
  persisted_count,
  stale_count,
  persist_failed_count,
  manual_review_count,
  quality_blocked_count,
  last_source_updated_at,
  last_cache_seen_at,
  last_persisted_at,
  CASE
    WHEN blocking_reason_code IN ('manual_review', 'quality_blocked', 'persist_failed') THEN 'critical'
    WHEN blocking_reason_code IN ('pending_persist', 'active_cached') OR stale_count > 0 THEN 'warning'
    ELSE 'healthy'
  END AS status_level,
  blocking_reason_code,
  CASE
    WHEN blocking_reason_code IS NOT NULL THEN public.matchlife_stats_pause_reason_text(
      'tournament',
      '全站实时链路',
      blocking_reason_code,
      active_cached_count,
      pending_persist_count,
      persist_failed_count,
      manual_review_count,
      quality_blocked_count
    )
    WHEN stale_count > 0 THEN format('当前存在 %s 条陈旧缓存待清理，请继续观察清理与归档链路。', stale_count)
    ELSE '当前实时缓存与正式落库链路正常。'
  END AS summary,
  CASE
    WHEN blocking_reason_code IS NOT NULL THEN public.matchlife_stats_recovery_hint_text(blocking_reason_code)
    WHEN stale_count > 0 THEN '待缓存清理或归档任务完成后恢复为健康；若长时间不下降，请检查清理作业。'
    ELSE '当前无需人工恢复动作。'
  END AS recovery_action,
  CASE
    WHEN last_source_updated_at IS NULL THEN NULL
    ELSE GREATEST(0, EXTRACT(EPOCH FROM (NOW() - last_source_updated_at))::INT)
  END AS source_lag_seconds,
  CASE
    WHEN last_persisted_at IS NULL THEN NULL
    ELSE GREATEST(0, EXTRACT(EPOCH FROM (NOW() - last_persisted_at))::INT)
  END AS persist_lag_seconds
FROM runtime_status;

GRANT SELECT ON public.matchlife_runtime_observability TO anon, authenticated, service_role;

CREATE OR REPLACE VIEW public.matchlife_source_observability AS
SELECT
  s.id,
  s.name,
  s.type,
  s.url,
  s.format,
  s.adapter_key,
  s.protocol,
  s.enabled,
  s.lifecycle_status,
  s.health_status,
  s.priority,
  s.failure_streak,
  s.timeout_streak,
  s.last_collected_at,
  s.last_succeeded_at,
  s.last_failed_at,
  s.last_error_code,
  s.last_error_message,
  s.next_eligible_at,
  s.circuit_opened_at,
  s.is_due,
  s.updated_at,
  CASE
    WHEN NOT s.enabled OR s.lifecycle_status IN ('paused', 'retired') THEN 'paused'
    WHEN s.health_status = 'failing' THEN 'critical'
    WHEN s.health_status IN ('degraded', 'unknown') THEN 'warning'
    ELSE 'healthy'
  END AS status_level,
  CASE
    WHEN NOT s.enabled OR s.lifecycle_status IN ('paused', 'retired') THEN 'source_paused'
    WHEN s.health_status = 'failing' THEN 'source_failing'
    WHEN s.health_status IN ('degraded', 'unknown') THEN 'source_degraded'
    ELSE 'source_healthy'
  END AS reason_code,
  CASE
    WHEN coalesce(s.last_succeeded_at, s.last_collected_at, s.updated_at) IS NULL THEN NULL
    ELSE GREATEST(0, EXTRACT(EPOCH FROM (NOW() - coalesce(s.last_succeeded_at, s.last_collected_at, s.updated_at)))::INT)
  END AS collection_lag_seconds,
  CASE
    WHEN NOT s.enabled OR s.lifecycle_status IN ('paused', 'retired')
      THEN format('来源“%s”当前处于暂停状态，不参与自动采集。', s.name)
    WHEN s.health_status = 'failing'
      THEN format('来源“%s”连续失败 %s 次，最近错误：%s。', s.name, GREATEST(coalesce(s.failure_streak, 0), 1), coalesce(s.last_error_message, '未知错误'))
    WHEN s.health_status = 'degraded'
      THEN format('来源“%s”处于降级状态，最近错误：%s。', s.name, coalesce(s.last_error_message, '等待自动恢复'))
    WHEN s.health_status = 'unknown'
      THEN format('来源“%s”尚未形成稳定健康样本，请先执行一次采集。', s.name)
    ELSE format('来源“%s”最近一次采集正常。', s.name)
  END AS summary,
  public.matchlife_observability_recovery_action(
    'source',
    CASE
      WHEN s.health_status = 'failing' THEN 'source_failing'
      WHEN s.health_status IN ('degraded', 'unknown') THEN 'source_degraded'
      WHEN NOT s.enabled OR s.lifecycle_status IN ('paused', 'retired') THEN 'source_paused'
      ELSE 'source_healthy'
    END,
    s.last_error_code
  ) AS recovery_action
FROM public.matchlife_source_registry_overview s;

GRANT SELECT ON public.matchlife_source_observability TO anon, authenticated, service_role;

CREATE OR REPLACE VIEW public.matchlife_governance_scope_observability AS
WITH tournament_scopes AS (
  SELECT
    'tournament'::TEXT AS scope_type,
    concat('tournament:', tournament_name) AS scope_key,
    tournament_name AS scope_label,
    public.matchlife_stats_scope_summary('tournament', tournament_name) AS scope_summary,
    count(*)::INT AS affected_match_count,
    count(*) FILTER (WHERE reason_code = 'active_cached')::INT AS active_cached_count,
    count(*) FILTER (WHERE reason_code = 'pending_persist')::INT AS pending_persist_count,
    count(*) FILTER (WHERE reason_code = 'persist_failed')::INT AS persist_failed_count,
    count(*) FILTER (WHERE reason_code = 'manual_review')::INT AS manual_review_count,
    count(*) FILTER (WHERE reason_code = 'quality_blocked')::INT AS quality_blocked_count,
    coalesce(array_agg(DISTINCT source) FILTER (WHERE source IS NOT NULL), '{}'::TEXT[]) AS affected_sources,
    coalesce(array_agg(DISTINCT tournament_name) FILTER (WHERE tournament_name IS NOT NULL), '{}'::TEXT[]) AS affected_tournaments,
    max(source_updated_at) AS latest_source_updated_at
  FROM public.matchlife_stats_governance_impacts
  GROUP BY tournament_name
),
leaderboard_scope AS (
  SELECT
    'leaderboard'::TEXT AS scope_type,
    'leaderboard:all:all:all'::TEXT AS scope_key,
    public.matchlife_leaderboard_scope_label(NULL, 'all', 'all') AS scope_label,
    public.matchlife_stats_scope_summary('leaderboard', public.matchlife_leaderboard_scope_label(NULL, 'all', 'all')) AS scope_summary,
    count(*)::INT AS affected_match_count,
    count(*) FILTER (WHERE reason_code = 'active_cached')::INT AS active_cached_count,
    count(*) FILTER (WHERE reason_code = 'pending_persist')::INT AS pending_persist_count,
    count(*) FILTER (WHERE reason_code = 'persist_failed')::INT AS persist_failed_count,
    count(*) FILTER (WHERE reason_code = 'manual_review')::INT AS manual_review_count,
    count(*) FILTER (WHERE reason_code = 'quality_blocked')::INT AS quality_blocked_count,
    coalesce(array_agg(DISTINCT source) FILTER (WHERE source IS NOT NULL), '{}'::TEXT[]) AS affected_sources,
    coalesce(array_agg(DISTINCT tournament_name) FILTER (WHERE tournament_name IS NOT NULL), '{}'::TEXT[]) AS affected_tournaments,
    max(source_updated_at) AS latest_source_updated_at
  FROM public.matchlife_stats_governance_impacts
),
combined AS (
  SELECT * FROM tournament_scopes
  UNION ALL
  SELECT * FROM leaderboard_scope
)
SELECT
  c.scope_type,
  c.scope_key,
  c.scope_label,
  c.scope_summary,
  CASE WHEN c.affected_match_count > 0 THEN 'paused' ELSE 'ready' END AS scope_status,
  c.affected_match_count > 0 AS is_paused,
  public.matchlife_stats_primary_reason_code(
    c.active_cached_count,
    c.pending_persist_count,
    c.persist_failed_count,
    c.manual_review_count,
    c.quality_blocked_count
  ) AS primary_reason_code,
  public.matchlife_stats_pause_reason_text(
    c.scope_type,
    c.scope_label,
    public.matchlife_stats_primary_reason_code(
      c.active_cached_count,
      c.pending_persist_count,
      c.persist_failed_count,
      c.manual_review_count,
      c.quality_blocked_count
    ),
    c.active_cached_count,
    c.pending_persist_count,
    c.persist_failed_count,
    c.manual_review_count,
    c.quality_blocked_count
  ) AS pause_reason,
  public.matchlife_stats_recovery_hint_text(
    public.matchlife_stats_primary_reason_code(
      c.active_cached_count,
      c.pending_persist_count,
      c.persist_failed_count,
      c.manual_review_count,
      c.quality_blocked_count
    )
  ) AS recovery_action,
  CASE
    WHEN c.affected_match_count = 0 THEN 'healthy'
    WHEN public.matchlife_observability_reason_severity(
      public.matchlife_stats_primary_reason_code(
        c.active_cached_count,
        c.pending_persist_count,
        c.persist_failed_count,
        c.manual_review_count,
        c.quality_blocked_count
      )
    ) = 'critical' THEN 'critical'
    ELSE 'warning'
  END AS status_level,
  c.affected_match_count,
  c.active_cached_count,
  c.pending_persist_count,
  c.persist_failed_count,
  c.manual_review_count,
  c.quality_blocked_count,
  c.affected_sources,
  c.affected_tournaments,
  c.latest_source_updated_at,
  (SELECT last_persisted_at FROM public.matchlife_runtime_observability LIMIT 1) AS last_persisted_at
FROM combined c;

GRANT SELECT ON public.matchlife_governance_scope_observability TO anon, authenticated, service_role;

CREATE OR REPLACE VIEW public.matchlife_sync_run_observability AS
SELECT
  r.id,
  r.run_at,
  r.source,
  r.source_id,
  r.adapter_key,
  r.status,
  r.pulled_count,
  r.upserted_count,
  r.active_cached_count,
  r.pending_persist_count,
  r.persisted_count,
  r.trigger_mode,
  r.attempt_no,
  r.retry_kind,
  r.circuit_state,
  r.isolation_key,
  r.result_payload,
  r.error_message,
  public.matchlife_observability_run_failure_stage(r.status, r.error_message, r.result_payload) AS failure_stage,
  public.matchlife_observability_run_reason_code(r.status, r.error_message, r.result_payload) AS failure_code,
  CASE
    WHEN coalesce(trim(r.status), '') = 'FAILED'
      THEN 'critical'
    WHEN coalesce(NULLIF(r.result_payload ->> 'persistFailedCount', ''), '0')::INT > 0
      THEN 'critical'
    WHEN coalesce(NULLIF(r.result_payload ->> 'pendingPersist', ''), '0')::INT > 0
      THEN 'warning'
    ELSE 'healthy'
  END AS severity,
  CASE
    WHEN coalesce(trim(r.status), '') = 'FAILED'
      THEN coalesce(r.result_payload ->> 'errorMessage', r.error_message, '同步失败')
    WHEN coalesce(NULLIF(r.result_payload ->> 'persistFailedCount', ''), '0')::INT > 0
      THEN format('本次运行有 %s 场比赛正式落库失败。', coalesce(NULLIF(r.result_payload ->> 'persistFailedCount', ''), '0'))
    WHEN coalesce(NULLIF(r.result_payload ->> 'pendingPersist', ''), '0')::INT > 0
      THEN format('本次运行结束后仍有 %s 场比赛待正式落库。', coalesce(NULLIF(r.result_payload ->> 'pendingPersist', ''), '0'))
    ELSE '本次运行无结构化失败信号。'
  END AS summary,
  public.matchlife_observability_recovery_action(
    'sync_run',
    CASE
      WHEN public.matchlife_observability_run_failure_stage(r.status, r.error_message, r.result_payload) = 'persist' THEN 'persist_failed'
      WHEN public.matchlife_observability_run_failure_stage(r.status, r.error_message, r.result_payload) = 'cache' THEN 'cache'
      WHEN public.matchlife_observability_run_failure_stage(r.status, r.error_message, r.result_payload) IN ('source', 'source_collection') THEN 'source_collection_failed'
      ELSE NULL
    END,
    public.matchlife_observability_run_reason_code(r.status, r.error_message, r.result_payload)
  ) AS recovery_action
FROM public.sync_runs r;

GRANT SELECT ON public.matchlife_sync_run_observability TO anon, authenticated, service_role;

CREATE OR REPLACE VIEW public.matchlife_observability_alerts AS
SELECT
  'runtime:global'::TEXT AS alert_key,
  'runtime'::TEXT AS layer,
  'system'::TEXT AS scope_type,
  'runtime:global'::TEXT AS scope_key,
  '全站实时链路'::TEXT AS scope_label,
  r.status_level AS severity,
  r.blocking_reason_code AS status_code,
  r.summary,
  r.recovery_action,
  coalesce(r.last_source_updated_at, r.last_persisted_at, NOW()) AS occurred_at,
  jsonb_build_object(
    'activeCachedCount', r.active_cached_count,
    'pendingPersistCount', r.pending_persist_count,
    'persistFailedCount', r.persist_failed_count,
    'manualReviewCount', r.manual_review_count,
    'qualityBlockedCount', r.quality_blocked_count,
    'sourceLagSeconds', r.source_lag_seconds,
    'persistLagSeconds', r.persist_lag_seconds
  ) AS evidence
FROM public.matchlife_runtime_observability r
WHERE r.status_level <> 'healthy'

UNION ALL

SELECT
  concat('source:', s.id) AS alert_key,
  'source'::TEXT AS layer,
  'source'::TEXT AS scope_type,
  concat('source:', s.id) AS scope_key,
  s.name AS scope_label,
  s.status_level AS severity,
  s.reason_code AS status_code,
  s.summary,
  s.recovery_action,
  coalesce(s.last_failed_at, s.last_collected_at, s.last_succeeded_at, NOW()) AS occurred_at,
  jsonb_build_object(
    'sourceId', s.id,
    'healthStatus', s.health_status,
    'failureStreak', s.failure_streak,
    'timeoutStreak', s.timeout_streak,
    'collectionLagSeconds', s.collection_lag_seconds,
    'lastErrorCode', s.last_error_code,
    'nextEligibleAt', s.next_eligible_at
  ) AS evidence
FROM public.matchlife_source_observability s
WHERE s.status_level <> 'healthy'

UNION ALL

SELECT
  concat(g.scope_key, ':', coalesce(g.primary_reason_code, 'ready')) AS alert_key,
  'governance'::TEXT AS layer,
  g.scope_type,
  g.scope_key,
  g.scope_label,
  g.status_level AS severity,
  g.primary_reason_code AS status_code,
  coalesce(g.pause_reason, '当前范围已恢复。') AS summary,
  g.recovery_action,
  coalesce(g.latest_source_updated_at, g.last_persisted_at, NOW()) AS occurred_at,
  jsonb_build_object(
    'affectedMatchCount', g.affected_match_count,
    'affectedSources', g.affected_sources,
    'affectedTournaments', g.affected_tournaments,
    'pendingPersistCount', g.pending_persist_count,
    'persistFailedCount', g.persist_failed_count,
    'manualReviewCount', g.manual_review_count,
    'qualityBlockedCount', g.quality_blocked_count
  ) AS evidence
FROM public.matchlife_governance_scope_observability g
WHERE g.is_paused

UNION ALL

SELECT
  concat('sync_run:', r.id) AS alert_key,
  'sync_run'::TEXT AS layer,
  'sync_run'::TEXT AS scope_type,
  concat('sync_run:', r.id) AS scope_key,
  coalesce(r.adapter_key, r.source, 'unknown') AS scope_label,
  r.severity,
  coalesce(r.failure_code, 'sync_run_signal') AS status_code,
  r.summary,
  r.recovery_action,
  r.run_at AS occurred_at,
  jsonb_build_object(
    'runId', r.id,
    'failureStage', r.failure_stage,
    'sourceId', r.source_id,
    'triggerMode', r.trigger_mode,
    'attemptNo', r.attempt_no,
    'circuitState', r.circuit_state,
    'status', r.status
  ) AS evidence
FROM public.matchlife_sync_run_observability r
WHERE r.severity <> 'healthy'
  AND r.run_at >= NOW() - INTERVAL '24 hours';

GRANT SELECT ON public.matchlife_observability_alerts TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.matchlife_get_observability_snapshot(
  p_recent_run_limit INT DEFAULT 8,
  p_paused_scope_limit INT DEFAULT 6,
  p_alert_limit INT DEFAULT 12,
  p_source_limit INT DEFAULT 12
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH runtime_row AS (
    SELECT * FROM public.matchlife_runtime_observability LIMIT 1
  ),
  source_counts AS (
    SELECT
      count(*)::INT AS total_count,
      count(*) FILTER (WHERE status_level = 'critical')::INT AS critical_count,
      count(*) FILTER (WHERE status_level = 'warning')::INT AS warning_count,
      count(*) FILTER (WHERE status_level = 'paused')::INT AS paused_count,
      count(*) FILTER (WHERE status_level = 'healthy')::INT AS healthy_count
    FROM public.matchlife_source_observability
  ),
  governance_counts AS (
    SELECT
      count(*) FILTER (WHERE is_paused)::INT AS paused_scope_count,
      count(*) FILTER (WHERE is_paused AND status_level = 'critical')::INT AS critical_paused_scope_count
    FROM public.matchlife_governance_scope_observability
  ),
  alert_counts AS (
    SELECT
      count(*) FILTER (WHERE severity = 'critical')::INT AS critical_alert_count,
      count(*) FILTER (WHERE severity = 'warning')::INT AS warning_alert_count
    FROM public.matchlife_observability_alerts
  ),
  summary AS (
    SELECT
      CASE
        WHEN coalesce(a.critical_alert_count, 0) > 0 THEN 'critical'
        WHEN coalesce(a.warning_alert_count, 0) > 0 THEN 'warning'
        ELSE 'healthy'
      END AS overall_status,
      coalesce(a.critical_alert_count, 0) AS critical_alert_count,
      coalesce(a.warning_alert_count, 0) AS warning_alert_count,
      coalesce(s.total_count, 0) AS source_count,
      coalesce(s.critical_count, 0) + coalesce(s.warning_count, 0) AS unhealthy_source_count,
      coalesce(g.paused_scope_count, 0) AS paused_scope_count,
      coalesce(g.critical_paused_scope_count, 0) AS critical_paused_scope_count
    FROM alert_counts a
    CROSS JOIN source_counts s
    CROSS JOIN governance_counts g
  )
  SELECT jsonb_build_object(
    'generatedAt', NOW(),
    'summary', jsonb_build_object(
      'overallStatus', summary.overall_status,
      'criticalAlertCount', summary.critical_alert_count,
      'warningAlertCount', summary.warning_alert_count,
      'sourceCount', summary.source_count,
      'unhealthySourceCount', summary.unhealthy_source_count,
      'pausedScopeCount', summary.paused_scope_count,
      'criticalPausedScopeCount', summary.critical_paused_scope_count,
      'runtimeStatus', coalesce((SELECT status_level FROM runtime_row), 'healthy'),
      'blockingReasonCode', (SELECT blocking_reason_code FROM runtime_row),
      'runtimeRecoveryAction', (SELECT recovery_action FROM runtime_row)
    ),
    'runtime', coalesce((SELECT to_jsonb(rr) FROM runtime_row rr), '{}'::JSONB),
    'sources', coalesce(
      (
        SELECT jsonb_agg(to_jsonb(src))
        FROM (
          SELECT *
          FROM public.matchlife_source_observability
          ORDER BY
            CASE status_level
              WHEN 'critical' THEN 1
              WHEN 'warning' THEN 2
              WHEN 'paused' THEN 3
              ELSE 4
            END,
            priority ASC,
            last_collected_at DESC NULLS LAST,
            updated_at DESC NULLS LAST
          LIMIT LEAST(GREATEST(coalesce(p_source_limit, 12), 1), 50)
        ) src
      ),
      '[]'::JSONB
    ),
    'governance', jsonb_build_object(
      'pausedScopeCount', (SELECT paused_scope_count FROM governance_counts),
      'pausedScopes', coalesce(
        (
          SELECT jsonb_agg(to_jsonb(scope))
          FROM (
            SELECT *
            FROM public.matchlife_governance_scope_observability
            WHERE is_paused
            ORDER BY
              CASE status_level
                WHEN 'critical' THEN 1
                ELSE 2
              END,
              latest_source_updated_at DESC NULLS LAST,
              scope_label ASC
            LIMIT LEAST(GREATEST(coalesce(p_paused_scope_limit, 6), 1), 30)
          ) scope
        ),
        '[]'::JSONB
      )
    ),
    'alerts', coalesce(
      (
        SELECT jsonb_agg(to_jsonb(alert_row))
        FROM (
          SELECT *
          FROM public.matchlife_observability_alerts
          ORDER BY
            CASE severity
              WHEN 'critical' THEN 1
              WHEN 'warning' THEN 2
              ELSE 3
            END,
            occurred_at DESC
          LIMIT LEAST(GREATEST(coalesce(p_alert_limit, 12), 1), 50)
        ) alert_row
      ),
      '[]'::JSONB
    ),
    'recentRuns', coalesce(
      (
        SELECT jsonb_agg(to_jsonb(run_row))
        FROM (
          SELECT *
          FROM public.matchlife_sync_run_observability
          ORDER BY run_at DESC
          LIMIT LEAST(GREATEST(coalesce(p_recent_run_limit, 8), 1), 50)
        ) run_row
      ),
      '[]'::JSONB
    )
  )
  FROM summary;
$$;

REVOKE ALL ON FUNCTION public.matchlife_get_observability_snapshot(INT, INT, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.matchlife_get_observability_snapshot(INT, INT, INT, INT) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
