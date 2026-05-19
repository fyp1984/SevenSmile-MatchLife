import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

export type PendingPersistRuntimeState = {
  activeCachedCount: number;
  pendingPersistCount: number;
  persistedCount: number;
  staleCount: number;
  lastSourceUpdatedAt: string | null;
  lastCacheSeenAt: string | null;
  lastPersistedAt: string | null;
};

export type StatsGovernanceScope = {
  scopeType: 'tournament' | 'leaderboard';
  scopeKey: string;
  scopeLabel: string;
  scopeSummary: string | null;
  scopeStatus: 'ready' | 'paused';
  isPaused: boolean;
  primaryReasonCode: string | null;
  pauseReason: string | null;
  recoveryHint: string | null;
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

export type LeaderboardGovernanceFilters = {
  sport: string;
  gender: string;
  mode: string;
};

const EMPTY_RUNTIME_STATE: PendingPersistRuntimeState = {
  activeCachedCount: 0,
  pendingPersistCount: 0,
  persistedCount: 0,
  staleCount: 0,
  lastSourceUpdatedAt: null,
  lastCacheSeenAt: null,
  lastPersistedAt: null,
};

export const CACHE_GUARD_UNKNOWN_MESSAGE =
  '暂时无法确认当前数据是否已更新完成，请稍后重试或前往“更新状态”页查看。';

export const STATS_GOVERNANCE_UNKNOWN_MESSAGE =
  '暂时无法确认当前统计是否适合展示，请稍后重试或前往“更新状态”页查看。';

const SCOPE_CACHE_TTL_MS = 10000;

type SyncRuntimeStateRow = {
  active_cached_count?: number | null;
  pending_persist_count?: number | null;
  persisted_count?: number | null;
  stale_count?: number | null;
  last_source_updated_at?: string | null;
  last_cache_seen_at?: string | null;
  last_persisted_at?: string | null;
};

type SyncRunFallbackRow = {
  active_cached_count?: number | null;
  pending_persist_count?: number | null;
  persisted_count?: number | null;
  error_message?: string | null;
  run_at?: string | null;
};

type StatsGovernanceScopeRow = {
  scope_type?: string | null;
  scope_key?: string | null;
  scope_label?: string | null;
  scope_summary?: string | null;
  scope_status?: string | null;
  is_paused?: boolean | null;
  primary_reason_code?: string | null;
  pause_reason?: string | null;
  recovery_hint?: string | null;
  affected_match_count?: number | null;
  active_cached_count?: number | null;
  pending_persist_count?: number | null;
  persist_failed_count?: number | null;
  manual_review_count?: number | null;
  quality_blocked_count?: number | null;
  affected_sources?: string[] | null;
  affected_tournaments?: string[] | null;
  latest_source_updated_at?: string | null;
  last_persisted_at?: string | null;
};

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const record = error as { message?: string; details?: string; hint?: string; error_description?: string };
    return String(record.message || record.details || record.hint || record.error_description || JSON.stringify(error));
  }
  return String(error || '');
}

function mapRuntimeState(row?: SyncRuntimeStateRow | null): PendingPersistRuntimeState {
  return {
    activeCachedCount: Number(row?.active_cached_count ?? 0),
    pendingPersistCount: Number(row?.pending_persist_count ?? 0),
    persistedCount: Number(row?.persisted_count ?? 0),
    staleCount: Number(row?.stale_count ?? 0),
    lastSourceUpdatedAt: row?.last_source_updated_at ?? null,
    lastCacheSeenAt: row?.last_cache_seen_at ?? null,
    lastPersistedAt: row?.last_persisted_at ?? null,
  };
}

function mapGovernanceScope(row?: StatsGovernanceScopeRow | null): StatsGovernanceScope | null {
  if (!row) return null;
  return {
    scopeType: row.scope_type === 'leaderboard' ? 'leaderboard' : 'tournament',
    scopeKey: String(row.scope_key || ''),
    scopeLabel: String(row.scope_label || ''),
    scopeSummary: row.scope_summary ? String(row.scope_summary) : null,
    scopeStatus: row.scope_status === 'paused' ? 'paused' : 'ready',
    isPaused: Boolean(row.is_paused),
    primaryReasonCode: row.primary_reason_code ? String(row.primary_reason_code) : null,
    pauseReason: row.pause_reason ? String(row.pause_reason) : null,
    recoveryHint: row.recovery_hint ? String(row.recovery_hint) : null,
    affectedMatchCount: Number(row.affected_match_count || 0),
    activeCachedCount: Number(row.active_cached_count || 0),
    pendingPersistCount: Number(row.pending_persist_count || 0),
    persistFailedCount: Number(row.persist_failed_count || 0),
    manualReviewCount: Number(row.manual_review_count || 0),
    qualityBlockedCount: Number(row.quality_blocked_count || 0),
    affectedSources: Array.isArray(row.affected_sources) ? row.affected_sources.map(String) : [],
    affectedTournaments: Array.isArray(row.affected_tournaments) ? row.affected_tournaments.map(String) : [],
    latestSourceUpdatedAt: row.latest_source_updated_at ?? null,
    lastPersistedAt: row.last_persisted_at ?? null,
  };
}

function parseRunMetaCount(message: string | null | undefined, key: string) {
  const match = String(message || '').match(new RegExp(`(?:^|;\\s*)${key}=(\\d+)`));
  return match ? Number(match[1]) : 0;
}

function mapRuntimeStateFromSyncRun(row?: SyncRunFallbackRow | null): PendingPersistRuntimeState {
  const runAt = row?.run_at ?? null;
  return {
    activeCachedCount: Number(row?.active_cached_count ?? parseRunMetaCount(row?.error_message, 'activeCached')),
    pendingPersistCount: Number(row?.pending_persist_count ?? parseRunMetaCount(row?.error_message, 'pendingPersist')),
    persistedCount: Number(row?.persisted_count ?? parseRunMetaCount(row?.error_message, 'persisted')),
    staleCount: 0,
    lastSourceUpdatedAt: runAt,
    lastCacheSeenAt: runAt,
    lastPersistedAt: runAt,
  };
}

function isSchemaCacheMiss(error: unknown) {
  const message = getErrorMessage(error);
  return /PGRST205|schema cache|sync_runtime_state|Could not find the table/i.test(message);
}

async function fetchRuntimeStateFallbackFromSyncRuns() {
  const response = await supabase
    .from('sync_runs')
    .select('active_cached_count,pending_persist_count,persisted_count,error_message,run_at')
    .order('run_at', { ascending: false })
    .limit(1);
  if (response.error) throw response.error;
  const row = (response.data?.[0] || null) as SyncRunFallbackRow | null;
  if (!row) {
    throw new Error('缺少可用于回退的同步记录');
  }
  return mapRuntimeStateFromSyncRun(row);
}

export function hasBlockingRealtimeSyncCache(runtimeState: PendingPersistRuntimeState) {
  return runtimeState.activeCachedCount > 0 || runtimeState.pendingPersistCount > 0;
}

export function buildPendingPersistMessage(runtimeState: PendingPersistRuntimeState) {
  const { pendingPersistCount, activeCachedCount } = runtimeState;
  if (pendingPersistCount > 0 && activeCachedCount > 0) {
    return `当前仍有 ${activeCachedCount} 场比赛结果在整理中，其中 ${pendingPersistCount} 场还在更新，统计与排行榜会在结果确认后恢复。`;
  }
  if (pendingPersistCount > 0) {
    return `当前仍有 ${pendingPersistCount} 场比赛结果还在更新，统计与排行榜会在结果确认后恢复。`;
  }
  if (activeCachedCount > 0) {
    return `当前仍有 ${activeCachedCount} 场比赛结果仍在变化，请稍后再查看最新统计结果。`;
  }
  return '当前数据已准备完成，统计与排行榜可正常查看。';
}

export function buildStatsPauseNotice(runtimeState: PendingPersistRuntimeState, guardError?: string | null) {
  if (hasBlockingRealtimeSyncCache(runtimeState)) {
    return buildPendingPersistMessage(runtimeState);
  }
  return guardError ? CACHE_GUARD_UNKNOWN_MESSAGE : null;
}

export function hasScopedStatsPause(scope?: StatsGovernanceScope | null) {
  return Boolean(scope?.isPaused);
}

export function buildScopedStatsPauseNotice(scope?: StatsGovernanceScope | null, guardError?: string | null) {
  if (scope?.isPaused) {
    return scope.pauseReason || `${scope.scopeLabel || '当前范围'}的数据仍在更新，请稍后再看。`;
  }
  return guardError ? STATS_GOVERNANCE_UNKNOWN_MESSAGE : null;
}

async function fetchGovernanceScope(
  rpcName: 'matchlife_get_tournament_stats_readiness' | 'matchlife_get_leaderboard_readiness',
  args: Record<string, unknown>,
) {
  const response = await supabase.rpc(rpcName, args);
  if (response.error) throw response.error;
  const row = Array.isArray(response.data) ? response.data[0] : response.data;
  return mapGovernanceScope((row || null) as StatsGovernanceScopeRow | null);
}

export async function fetchTournamentStatsGovernance(tournamentName: string) {
  const targetTournament = tournamentName.trim();
  if (!targetTournament) {
    return { scope: null as StatsGovernanceScope | null, error: null as string | null };
  }
  try {
    const scope = await fetchGovernanceScope('matchlife_get_tournament_stats_readiness', {
      p_tournament_name: targetTournament,
    });
    return { scope, error: null as string | null };
  } catch (error) {
    return { scope: null as StatsGovernanceScope | null, error: getErrorMessage(error) };
  }
}

export async function fetchLeaderboardGovernance(filters: LeaderboardGovernanceFilters) {
  try {
    const scope = await fetchGovernanceScope('matchlife_get_leaderboard_readiness', {
      p_sport_type: filters.sport,
      p_gender: filters.gender,
      p_mode: filters.mode,
    });
    return { scope, error: null as string | null };
  } catch (error) {
    return { scope: null as StatsGovernanceScope | null, error: getErrorMessage(error) };
  }
}

export function usePendingPersistGuard() {
  const [runtimeState, setRuntimeState] = useState<PendingPersistRuntimeState>(EMPTY_RUNTIME_STATE);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const refreshRuntimeState = useCallback(async (showLoading = false) => {
    if (showLoading) setChecking(true);
    try {
      const response = await supabase.from('sync_runtime_state').select('*').limit(1);
      if (response.error) throw response.error;
      const nextState = mapRuntimeState((response.data?.[0] || null) as SyncRuntimeStateRow | null);
      if (mountedRef.current) {
        setRuntimeState(nextState);
        setError(null);
      }
      return { state: nextState, error: null as string | null };
    } catch (runtimeError) {
      if (isSchemaCacheMiss(runtimeError)) {
        try {
          const fallbackState = await fetchRuntimeStateFallbackFromSyncRuns();
          if (mountedRef.current) {
            setRuntimeState(fallbackState);
            setError(null);
          }
          return { state: fallbackState, error: null as string | null };
        } catch (fallbackError) {
          const fallbackMessage = getErrorMessage(fallbackError);
          if (mountedRef.current) setError(fallbackMessage);
          return { state: EMPTY_RUNTIME_STATE, error: fallbackMessage };
        }
      }
      const message = getErrorMessage(runtimeError);
      if (mountedRef.current) setError(message);
      return { state: EMPTY_RUNTIME_STATE, error: message };
    } finally {
      if (showLoading && mountedRef.current) setChecking(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void refreshRuntimeState(true);
    const refreshIfVisible = () => {
      if (document.hidden) return;
      void refreshRuntimeState(false);
    };
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        void refreshRuntimeState(false);
      }
    };
    const timer = window.setInterval(refreshIfVisible, 30000);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      mountedRef.current = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [refreshRuntimeState]);

  return {
    runtimeState,
    checking,
    error,
    hasBlockingRealtimeSyncCache: hasBlockingRealtimeSyncCache(runtimeState),
    hasPendingPersist: runtimeState.pendingPersistCount > 0,
    refreshRuntimeState,
  };
}

export function useTournamentStatsGovernance(tournamentName: string) {
  const [scope, setScope] = useState<StatsGovernanceScope | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const cachedResultRef = useRef<{
    key: string;
    at: number;
    result: { scope: StatsGovernanceScope | null; error: string | null };
  } | null>(null);
  const inFlightRef = useRef<{
    key: string;
    promise: Promise<{ scope: StatsGovernanceScope | null; error: string | null }>;
  } | null>(null);

  const refreshScope = useCallback(
    async (nextTournamentName?: string, showLoading = false) => {
      const targetTournament = String(nextTournamentName ?? tournamentName).trim();
      if (!targetTournament) {
        if (mountedRef.current) {
          setScope(null);
          setError(null);
          setChecking(false);
        }
        return { scope: null as StatsGovernanceScope | null, error: null as string | null };
      }

      if (showLoading && mountedRef.current) setChecking(true);
      const cacheKey = targetTournament;
      const cachedResult = cachedResultRef.current;
      if (cachedResult && cachedResult.key === cacheKey && Date.now() - cachedResult.at < SCOPE_CACHE_TTL_MS) {
        if (mountedRef.current) {
          setScope(cachedResult.result.scope);
          setError(cachedResult.result.error);
          if (showLoading) setChecking(false);
        }
        return cachedResult.result;
      }

      const inFlight = inFlightRef.current;
      const requestPromise =
        inFlight && inFlight.key === cacheKey
          ? inFlight.promise
          : fetchTournamentStatsGovernance(targetTournament).then((result) => {
              cachedResultRef.current = { key: cacheKey, at: Date.now(), result };
              return result;
            });
      if (!inFlight || inFlight.key !== cacheKey) {
        inFlightRef.current = { key: cacheKey, promise: requestPromise };
      }
      const result = await requestPromise;
      if (inFlightRef.current?.key === cacheKey) {
        inFlightRef.current = null;
      }
      if (mountedRef.current) {
        setScope(result.scope);
        setError(result.error);
        if (showLoading) setChecking(false);
      }
      return result;
    },
    [tournamentName],
  );

  useEffect(() => {
    mountedRef.current = true;
    void refreshScope(undefined, true);
    const refreshIfVisible = () => {
      if (document.hidden) return;
      void refreshScope();
    };
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        void refreshScope();
      }
    };
    const timer = window.setInterval(refreshIfVisible, 30000);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      mountedRef.current = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [refreshScope]);

  return {
    scope,
    checking,
    error,
    hasScopePause: hasScopedStatsPause(scope),
    refreshScope,
  };
}

export function useLeaderboardGovernance(filters: LeaderboardGovernanceFilters) {
  const [scope, setScope] = useState<StatsGovernanceScope | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const cachedResultRef = useRef<{
    key: string;
    at: number;
    result: { scope: StatsGovernanceScope | null; error: string | null };
  } | null>(null);
  const inFlightRef = useRef<{
    key: string;
    promise: Promise<{ scope: StatsGovernanceScope | null; error: string | null }>;
  } | null>(null);

  const refreshScope = useCallback(
    async (nextFilters?: LeaderboardGovernanceFilters, showLoading = false) => {
      const targetFilters = nextFilters ?? filters;
      if (!targetFilters.sport.trim()) {
        if (mountedRef.current) {
          setScope(null);
          setError(null);
          setChecking(false);
        }
        return { scope: null as StatsGovernanceScope | null, error: null as string | null };
      }

      if (showLoading && mountedRef.current) setChecking(true);
      const cacheKey = JSON.stringify(targetFilters);
      const cachedResult = cachedResultRef.current;
      if (cachedResult && cachedResult.key === cacheKey && Date.now() - cachedResult.at < SCOPE_CACHE_TTL_MS) {
        if (mountedRef.current) {
          setScope(cachedResult.result.scope);
          setError(cachedResult.result.error);
          if (showLoading) setChecking(false);
        }
        return cachedResult.result;
      }

      const inFlight = inFlightRef.current;
      const requestPromise =
        inFlight && inFlight.key === cacheKey
          ? inFlight.promise
          : fetchLeaderboardGovernance(targetFilters).then((result) => {
              cachedResultRef.current = { key: cacheKey, at: Date.now(), result };
              return result;
            });
      if (!inFlight || inFlight.key !== cacheKey) {
        inFlightRef.current = { key: cacheKey, promise: requestPromise };
      }
      const result = await requestPromise;
      if (inFlightRef.current?.key === cacheKey) {
        inFlightRef.current = null;
      }
      if (mountedRef.current) {
        setScope(result.scope);
        setError(result.error);
        if (showLoading) setChecking(false);
      }
      return result;
    },
    [filters],
  );

  useEffect(() => {
    mountedRef.current = true;
    void refreshScope(undefined, true);
    const refreshIfVisible = () => {
      if (document.hidden) return;
      void refreshScope();
    };
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        void refreshScope();
      }
    };
    const timer = window.setInterval(refreshIfVisible, 30000);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      mountedRef.current = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [refreshScope]);

  return {
    scope,
    checking,
    error,
    hasScopePause: hasScopedStatsPause(scope),
    refreshScope,
  };
}
