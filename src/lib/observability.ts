import { supabase } from './supabase';

export type StatusLevel = 'healthy' | 'warning' | 'critical' | 'paused' | 'info';

export type ObservabilitySummary = {
  overallStatus: StatusLevel;
  criticalAlertCount: number;
  warningAlertCount: number;
  sourceCount: number;
  unhealthySourceCount: number;
  pausedScopeCount: number;
  criticalPausedScopeCount: number;
  runtimeStatus: StatusLevel;
  blockingReasonCode: string | null;
  runtimeRecoveryAction: string | null;
};

export type RuntimeObservability = {
  activeCachedCount: number;
  pendingPersistCount: number;
  persistedCount: number;
  staleCount: number;
  persistFailedCount: number;
  manualReviewCount: number;
  qualityBlockedCount: number;
  lastSourceUpdatedAt: string | null;
  lastCacheSeenAt: string | null;
  lastPersistedAt: string | null;
  statusLevel: StatusLevel;
  blockingReasonCode: string | null;
  summary: string | null;
  recoveryAction: string | null;
  sourceLagSeconds: number | null;
  persistLagSeconds: number | null;
};

export type SourceObservability = {
  id: string;
  name: string;
  type: string;
  url: string;
  format: string;
  adapterKey: string | null;
  protocol: string | null;
  enabled: boolean;
  lifecycleStatus: string | null;
  healthStatus: string | null;
  priority: number;
  failureStreak: number;
  timeoutStreak: number;
  lastCollectedAt: string | null;
  lastSucceededAt: string | null;
  lastFailedAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  nextEligibleAt: string | null;
  circuitOpenedAt: string | null;
  isDue: boolean;
  updatedAt: string | null;
  statusLevel: StatusLevel;
  reasonCode: string | null;
  collectionLagSeconds: number | null;
  summary: string | null;
  recoveryAction: string | null;
};

export type GovernanceScopeObservability = {
  scopeType: string;
  scopeKey: string;
  scopeLabel: string;
  scopeSummary: string | null;
  scopeStatus: string;
  isPaused: boolean;
  primaryReasonCode: string | null;
  pauseReason: string | null;
  recoveryAction: string | null;
  statusLevel: StatusLevel;
  affectedMatchCount: number;
  activeCachedCount: number;
  pendingPersistCount: number;
  persistFailedCount: number;
  manualReviewCount: number;
  qualityBlockedCount: number;
  affectedSources: string[];
  affectedTournaments: string[];
  latestSourceUpdatedAt: string | null;
  lastPersistedAt: string | null;
};

export type ObservabilityAlert = {
  alertKey: string;
  layer: string;
  scopeType: string;
  scopeKey: string;
  scopeLabel: string;
  severity: StatusLevel;
  statusCode: string | null;
  summary: string | null;
  recoveryAction: string | null;
  occurredAt: string | null;
  evidence: Record<string, unknown>;
};

export type RecentRunObservability = {
  id: string;
  runAt: string;
  source: string;
  sourceId: string | null;
  adapterKey: string | null;
  status: string;
  pulledCount: number;
  upsertedCount: number;
  activeCachedCount: number | null;
  pendingPersistCount: number | null;
  persistedCount: number | null;
  triggerMode: string | null;
  attemptNo: number;
  retryKind: string | null;
  circuitState: string | null;
  isolationKey: string | null;
  resultPayload: Record<string, unknown>;
  errorMessage: string | null;
  failureStage: string | null;
  failureCode: string | null;
  severity: StatusLevel;
  summary: string | null;
  recoveryAction: string | null;
};

export type ObservabilitySnapshot = {
  generatedAt: string | null;
  summary: ObservabilitySummary;
  runtime: RuntimeObservability;
  sources: SourceObservability[];
  governance: {
    pausedScopeCount: number;
    pausedScopes: GovernanceScopeObservability[];
  };
  alerts: ObservabilityAlert[];
  recentRuns: RecentRunObservability[];
};

const DEFAULT_SUMMARY: ObservabilitySummary = {
  overallStatus: 'healthy',
  criticalAlertCount: 0,
  warningAlertCount: 0,
  sourceCount: 0,
  unhealthySourceCount: 0,
  pausedScopeCount: 0,
  criticalPausedScopeCount: 0,
  runtimeStatus: 'healthy',
  blockingReasonCode: null,
  runtimeRecoveryAction: null,
};

const DEFAULT_RUNTIME: RuntimeObservability = {
  activeCachedCount: 0,
  pendingPersistCount: 0,
  persistedCount: 0,
  staleCount: 0,
  persistFailedCount: 0,
  manualReviewCount: 0,
  qualityBlockedCount: 0,
  lastSourceUpdatedAt: null,
  lastCacheSeenAt: null,
  lastPersistedAt: null,
  statusLevel: 'healthy',
  blockingReasonCode: null,
  summary: null,
  recoveryAction: null,
  sourceLagSeconds: null,
  persistLagSeconds: null,
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asArray<T>(value: unknown, mapItem: (item: unknown) => T): T[] {
  return Array.isArray(value) ? value.map(mapItem) : [];
}

function asNumber(value: unknown, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function asNullableNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function asString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function asNullableString(value: unknown) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text : null;
}

function asBoolean(value: unknown, fallback = false) {
  return typeof value === 'boolean' ? value : fallback;
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item || '')).filter(Boolean) : [];
}

function normalizeStatus(value: unknown, fallback: StatusLevel = 'info'): StatusLevel {
  const text = String(value || '').trim();
  if (text === 'healthy' || text === 'warning' || text === 'critical' || text === 'paused' || text === 'info') {
    return text;
  }
  return fallback;
}

function mapSummary(value: unknown): ObservabilitySummary {
  const record = asRecord(value);
  return {
    overallStatus: normalizeStatus(record.overallStatus, 'healthy'),
    criticalAlertCount: asNumber(record.criticalAlertCount),
    warningAlertCount: asNumber(record.warningAlertCount),
    sourceCount: asNumber(record.sourceCount),
    unhealthySourceCount: asNumber(record.unhealthySourceCount),
    pausedScopeCount: asNumber(record.pausedScopeCount),
    criticalPausedScopeCount: asNumber(record.criticalPausedScopeCount),
    runtimeStatus: normalizeStatus(record.runtimeStatus, 'healthy'),
    blockingReasonCode: asNullableString(record.blockingReasonCode),
    runtimeRecoveryAction: asNullableString(record.runtimeRecoveryAction),
  };
}

function mapRuntime(value: unknown): RuntimeObservability {
  const record = asRecord(value);
  return {
    activeCachedCount: asNumber(record.active_cached_count),
    pendingPersistCount: asNumber(record.pending_persist_count),
    persistedCount: asNumber(record.persisted_count),
    staleCount: asNumber(record.stale_count),
    persistFailedCount: asNumber(record.persist_failed_count),
    manualReviewCount: asNumber(record.manual_review_count),
    qualityBlockedCount: asNumber(record.quality_blocked_count),
    lastSourceUpdatedAt: asNullableString(record.last_source_updated_at),
    lastCacheSeenAt: asNullableString(record.last_cache_seen_at),
    lastPersistedAt: asNullableString(record.last_persisted_at),
    statusLevel: normalizeStatus(record.status_level, 'healthy'),
    blockingReasonCode: asNullableString(record.blocking_reason_code),
    summary: asNullableString(record.summary),
    recoveryAction: asNullableString(record.recovery_action),
    sourceLagSeconds: asNullableNumber(record.source_lag_seconds),
    persistLagSeconds: asNullableNumber(record.persist_lag_seconds),
  };
}

function mapSource(value: unknown): SourceObservability {
  const record = asRecord(value);
  return {
    id: asString(record.id),
    name: asString(record.name),
    type: asString(record.type),
    url: asString(record.url),
    format: asString(record.format),
    adapterKey: asNullableString(record.adapter_key),
    protocol: asNullableString(record.protocol),
    enabled: asBoolean(record.enabled, true),
    lifecycleStatus: asNullableString(record.lifecycle_status),
    healthStatus: asNullableString(record.health_status),
    priority: asNumber(record.priority, 100),
    failureStreak: asNumber(record.failure_streak),
    timeoutStreak: asNumber(record.timeout_streak),
    lastCollectedAt: asNullableString(record.last_collected_at),
    lastSucceededAt: asNullableString(record.last_succeeded_at),
    lastFailedAt: asNullableString(record.last_failed_at),
    lastErrorCode: asNullableString(record.last_error_code),
    lastErrorMessage: asNullableString(record.last_error_message),
    nextEligibleAt: asNullableString(record.next_eligible_at),
    circuitOpenedAt: asNullableString(record.circuit_opened_at),
    isDue: asBoolean(record.is_due),
    updatedAt: asNullableString(record.updated_at),
    statusLevel: normalizeStatus(record.status_level, 'info'),
    reasonCode: asNullableString(record.reason_code),
    collectionLagSeconds: asNullableNumber(record.collection_lag_seconds),
    summary: asNullableString(record.summary),
    recoveryAction: asNullableString(record.recovery_action),
  };
}

function mapGovernanceScope(value: unknown): GovernanceScopeObservability {
  const record = asRecord(value);
  return {
    scopeType: asString(record.scope_type),
    scopeKey: asString(record.scope_key),
    scopeLabel: asString(record.scope_label),
    scopeSummary: asNullableString(record.scope_summary),
    scopeStatus: asString(record.scope_status),
    isPaused: asBoolean(record.is_paused),
    primaryReasonCode: asNullableString(record.primary_reason_code),
    pauseReason: asNullableString(record.pause_reason),
    recoveryAction: asNullableString(record.recovery_action),
    statusLevel: normalizeStatus(record.status_level, 'info'),
    affectedMatchCount: asNumber(record.affected_match_count),
    activeCachedCount: asNumber(record.active_cached_count),
    pendingPersistCount: asNumber(record.pending_persist_count),
    persistFailedCount: asNumber(record.persist_failed_count),
    manualReviewCount: asNumber(record.manual_review_count),
    qualityBlockedCount: asNumber(record.quality_blocked_count),
    affectedSources: asStringArray(record.affected_sources),
    affectedTournaments: asStringArray(record.affected_tournaments),
    latestSourceUpdatedAt: asNullableString(record.latest_source_updated_at),
    lastPersistedAt: asNullableString(record.last_persisted_at),
  };
}

function mapAlert(value: unknown): ObservabilityAlert {
  const record = asRecord(value);
  return {
    alertKey: asString(record.alert_key),
    layer: asString(record.layer),
    scopeType: asString(record.scope_type),
    scopeKey: asString(record.scope_key),
    scopeLabel: asString(record.scope_label),
    severity: normalizeStatus(record.severity, 'info'),
    statusCode: asNullableString(record.status_code),
    summary: asNullableString(record.summary),
    recoveryAction: asNullableString(record.recovery_action),
    occurredAt: asNullableString(record.occurred_at),
    evidence: asRecord(record.evidence),
  };
}

function mapRecentRun(value: unknown): RecentRunObservability {
  const record = asRecord(value);
  return {
    id: asString(record.id),
    runAt: asString(record.run_at),
    source: asString(record.source),
    sourceId: asNullableString(record.source_id),
    adapterKey: asNullableString(record.adapter_key),
    status: asString(record.status),
    pulledCount: asNumber(record.pulled_count),
    upsertedCount: asNumber(record.upserted_count),
    activeCachedCount: asNullableNumber(record.active_cached_count),
    pendingPersistCount: asNullableNumber(record.pending_persist_count),
    persistedCount: asNullableNumber(record.persisted_count),
    triggerMode: asNullableString(record.trigger_mode),
    attemptNo: asNumber(record.attempt_no, 1),
    retryKind: asNullableString(record.retry_kind),
    circuitState: asNullableString(record.circuit_state),
    isolationKey: asNullableString(record.isolation_key),
    resultPayload: asRecord(record.result_payload),
    errorMessage: asNullableString(record.error_message),
    failureStage: asNullableString(record.failure_stage),
    failureCode: asNullableString(record.failure_code),
    severity: normalizeStatus(record.severity, 'info'),
    summary: asNullableString(record.summary),
    recoveryAction: asNullableString(record.recovery_action),
  };
}

export function normalizeObservabilitySnapshot(payload: unknown): ObservabilitySnapshot {
  const record = asRecord(payload);
  const governance = asRecord(record.governance);
  return {
    generatedAt: asNullableString(record.generatedAt),
    summary: mapSummary(record.summary || DEFAULT_SUMMARY),
    runtime: mapRuntime(record.runtime || DEFAULT_RUNTIME),
    sources: asArray(record.sources, mapSource),
    governance: {
      pausedScopeCount: asNumber(governance.pausedScopeCount),
      pausedScopes: asArray(governance.pausedScopes, mapGovernanceScope),
    },
    alerts: asArray(record.alerts, mapAlert),
    recentRuns: asArray(record.recentRuns, mapRecentRun),
  };
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const record = error as { message?: string; details?: string; hint?: string; error_description?: string };
    return String(record.message || record.details || record.hint || record.error_description || JSON.stringify(error));
  }
  return String(error || '');
}

export async function fetchObservabilitySnapshot({
  recentRunLimit = 8,
  pausedScopeLimit = 6,
  alertLimit = 12,
  sourceLimit = 12,
}: {
  recentRunLimit?: number;
  pausedScopeLimit?: number;
  alertLimit?: number;
  sourceLimit?: number;
} = {}) {
  const { data, error } = await supabase.rpc('matchlife_get_observability_snapshot', {
    p_recent_run_limit: recentRunLimit,
    p_paused_scope_limit: pausedScopeLimit,
    p_alert_limit: alertLimit,
    p_source_limit: sourceLimit,
  });
  if (error) throw new Error(getErrorMessage(error));
  return normalizeObservabilitySnapshot(data);
}

export function getStatusLabel(level: StatusLevel) {
  switch (level) {
    case 'critical':
      return '阻塞';
    case 'warning':
      return '关注';
    case 'paused':
      return '暂停';
    case 'healthy':
      return '正常';
    default:
      return '提示';
  }
}

export function getStatusTone(level: StatusLevel) {
  switch (level) {
    case 'critical':
      return 'border-red-200 bg-red-50 text-red-700';
    case 'warning':
      return 'border-amber-200 bg-amber-50 text-amber-800';
    case 'paused':
      return 'border-slate-200 bg-slate-50 text-slate-700';
    case 'healthy':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    default:
      return 'border-sky-200 bg-sky-50 text-sky-700';
  }
}

export function formatSecondsRough(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '-';
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))} 秒`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} 分钟`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} 小时`;
  return `${Math.round(seconds / 86400)} 天`;
}
