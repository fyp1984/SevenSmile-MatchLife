import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { format } from 'date-fns';
import {
  Activity,
  AlertTriangle,
  CheckCircle,
  Clock,
  Database,
  Gauge,
  RefreshCw,
  RotateCcw,
  Server,
  ShieldAlert,
  Sparkles,
  Trash2,
  Wrench,
} from 'lucide-react';
import { fetchVisitStats, normalizeVisitStatsError, type VisitStats } from '../lib/visitMetrics';
import { fetchSourcesFromDb, getRaceIdFromSource, type SourceItem } from '../lib/dataSources';
import {
  fetchObservabilitySnapshot,
  formatSecondsRough,
  getStatusLabel,
  getStatusTone,
  type ObservabilitySnapshot,
  type StatusLevel,
} from '../lib/observability';
import PressHint from '../components/PressHint';

type ActionIconButtonProps = {
  title: string;
  hint: string;
  onClick: () => void;
  icon: React.ReactNode;
  disabled?: boolean;
  active?: boolean;
  danger?: boolean;
  loading?: boolean;
  gradient?: boolean;
};

type ActionResponsePayload = {
  ok?: boolean;
  error?: string | null;
  warning?: string | null;
  resetApplied?: boolean;
  mode?: string;
  pid?: number | null;
  raceId?: number | null;
  tournamentName?: string | null;
};

const OBSERVABILITY_REFRESH_MS = 30000;
const AUTO_SYNC_REFRESH_MS = 30000;

function ActionIconButton({
  title,
  hint,
  onClick,
  icon,
  disabled,
  active,
  danger,
  loading,
  gradient,
}: ActionIconButtonProps) {
  return (
    <PressHint message={hint}>
      <button
        type="button"
        title={title}
        aria-label={title}
        onClick={onClick}
        disabled={disabled}
        className={`inline-flex h-11 w-11 items-center justify-center rounded-full border transition-all duration-200 ${
          gradient
            ? 'border-transparent bg-gradient-to-r from-orange-500 to-red-500 text-white shadow-md hover:from-orange-400 hover:to-red-400 hover:shadow-lg'
            : danger
              ? 'border-red-100 bg-white text-red-500 hover:bg-red-50'
              : active
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                : 'border-orange-200 bg-white text-orange-600 hover:bg-orange-50 hover:shadow-md'
        } ${disabled ? 'cursor-not-allowed opacity-60 shadow-none hover:bg-white' : ''}`}
      >
        <span className={loading ? 'animate-spin' : ''}>{icon}</span>
      </button>
    </PressHint>
  );
}

export default function SyncStatus() {
  const [snapshot, setSnapshot] = useState<ObservabilitySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [autoSync, setAutoSync] = useState(false);
  const [autoTickAt, setAutoTickAt] = useState<string | null>(null);
  const [hasServiceRoleKey, setHasServiceRoleKey] = useState<boolean | null>(null);
  const [visitStats, setVisitStats] = useState<VisitStats | null>(null);
  const [visitStatsError, setVisitStatsError] = useState<string | null>(null);
  const [syncSources, setSyncSources] = useState<SourceItem[]>([]);
  const [activeSource, setActiveSource] = useState<SourceItem | null>(null);
  const [actionMsg, setActionMsg] = useState<{ tone: 'success' | 'warning'; text: string } | null>(null);
  const refreshTimersRef = useRef<number[]>([]);
  const apiBase = `${import.meta.env.BASE_URL}api`.replace(/\/{2,}/g, '/');
  const manualSyncUrl = `${apiBase}/wechat/manual-sync`;

  const isLocalhost = () => {
    const host = window.location.hostname;
    return host === 'localhost' || host === '127.0.0.1';
  };

  const loadActiveSource = async () => {
    try {
      const list = await fetchSourcesFromDb();
      setSyncSources(list);
      const enabled = list.filter((item) => item.enabled);
      setActiveSource(enabled[0] || list[0] || null);
    } catch {
      setSyncSources([]);
      setActiveSource(null);
    }
  };

  const buildRaceIdsHeader = useCallback(() => {
    const raceIds = syncSources
      .filter((item) => item.enabled)
      .map((item) => getRaceIdFromSource(item.url))
      .filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0);
    if (!raceIds.length) return null;
    return Array.from(new Set(raceIds)).join(',');
  }, [syncSources]);

  const buildRemoteSyncHeaders = useCallback(
    (mode: 'full' | 'fast' = 'full') => ({
      'x-matchlife-sync': '1',
      ...(activeSource ? { 'x-matchlife-source-url': activeSource.url } : {}),
      ...(activeSource?.name
        ? { 'x-matchlife-source-name': encodeURIComponent(activeSource.name) }
        : {}),
      ...(mode === 'full'
        ? (() => {
            const raceIds = buildRaceIdsHeader();
            return raceIds ? { 'x-matchlife-race-ids': raceIds } : {};
          })()
        : {}),
      ...(activeSource
        ? (() => {
            const raceId = getRaceIdFromSource(activeSource.url);
            return raceId ? { 'x-matchlife-race-id': String(raceId) } : {};
          })()
        : {}),
    }),
    [activeSource, buildRaceIdsHeader],
  );

  const loadVisitStats = async () => {
    try {
      setVisitStatsError(null);
      const stats = await fetchVisitStats(supabase);
      setVisitStats(stats);
    } catch (error) {
      setVisitStatsError(normalizeVisitStatsError(error));
    }
  };

  const loadObservability = useCallback(async () => {
    setLoading(true);
    try {
      setErrorMsg(null);
      const nextSnapshot = await fetchObservabilitySnapshot({
        recentRunLimit: 8,
        pausedScopeLimit: 8,
        alertLimit: 12,
        sourceLimit: 12,
      });
      setSnapshot(nextSnapshot);
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, []);

  const scheduleObservabilityRefresh = useCallback(() => {
    for (const timer of refreshTimersRef.current) {
      window.clearTimeout(timer);
    }
    refreshTimersRef.current = [];
    void loadObservability();
    for (const delay of [1500, 6000]) {
      const timer = window.setTimeout(() => {
        void loadObservability();
      }, delay);
      refreshTimersRef.current.push(timer);
    }
  }, [loadObservability]);

  const parseActionResponse = async (response: Response) => {
    const json: unknown = await response.json().catch(() => ({}));
    return (typeof json === 'object' && json !== null ? json : {}) as ActionResponsePayload;
  };

  const updateActionMessage = useCallback((kind: 'update' | 'reset', payload?: ActionResponsePayload) => {
    const warning = String(payload?.warning || '').trim();
    const base =
      kind === 'reset'
        ? payload?.resetApplied === false
          ? '本次已改为执行全量更新。'
          : '已发起清空后重载，请稍后查看下方最新结果。'
        : '已发起本次更新，请稍后查看下方最新结果。';
    setActionMsg({
      tone: warning ? 'warning' : 'success',
      text: warning ? `${base}${warning}` : base,
    });
  }, []);

  const triggerSync = useCallback(async (mode: 'full' | 'fast' = 'full') => {
    setSyncing(true);
    setErrorMsg(null);
    setActionMsg(null);

    if (isLocalhost()) {
      let localRes: Response;
      const localRaceIds = buildRaceIdsHeader();
      const localRaceId = activeSource ? getRaceIdFromSource(activeSource.url) : null;
      try {
        localRes = await fetch(`${apiBase}/sync?mode=${mode}`, {
          method: 'POST',
          headers: {
            ...(activeSource ? { 'x-matchlife-source-url': activeSource.url } : {}),
            ...(activeSource?.name
              ? { 'x-matchlife-source-name': encodeURIComponent(activeSource.name) }
              : {}),
            ...(mode === 'full' && localRaceIds ? { 'x-matchlife-race-ids': localRaceIds } : {}),
            ...(localRaceId ? { 'x-matchlife-race-id': String(localRaceId) } : {}),
          },
        });
      } catch (e: unknown) {
        const localHint =
          hasServiceRoleKey === false
            ? '请在 `.env.local` 填写 SUPABASE_SERVICE_ROLE_KEY（仅本地，不提交）。'
            : '请检查本地开发服务器日志。';
        setErrorMsg(`本地同步失败：${String(e)}。${localHint}`);
        setSyncing(false);
        return;
      }

      if (!localRes.ok) {
        const parsed = await parseActionResponse(localRes);
        const localHint =
          hasServiceRoleKey === false
            ? '请在 `.env.local` 填写 SUPABASE_SERVICE_ROLE_KEY（仅本地，不提交）。'
            : '请检查本地开发服务器日志。';
        setErrorMsg(`本地同步失败：${String(parsed.error ?? localRes.status)}。${localHint}`);
        setSyncing(false);
        return;
      }
      updateActionMessage('update');
    } else {
      try {
        const tryEdge = await supabase.functions.invoke('sync-ymq', { method: 'POST', body: { mode } });
        if (!tryEdge.error) {
          updateActionMessage('update');
          scheduleObservabilityRefresh();
          setSyncing(false);
          return;
        }

        const fallbackRes = await fetch(`${manualSyncUrl}?mode=${mode}`, {
          method: 'POST',
          credentials: 'include',
          headers: buildRemoteSyncHeaders(mode),
        });
        if (fallbackRes.status === 409) {
          // A sync job is already running on server; treat as an in-progress state instead of hard error.
          setActionMsg({ tone: 'warning', text: '已有更新任务正在执行中，请稍后刷新下方结果。' });
          scheduleObservabilityRefresh();
          setSyncing(false);
          return;
        }
        if (!fallbackRes.ok) {
          const parsed = await parseActionResponse(fallbackRes);
          setErrorMsg(`未能发起本次更新，请稍后重试。${parsed.error ? `原因：${String(parsed.error)}` : ''}`);
          setSyncing(false);
          return;
        }
        const parsed = await parseActionResponse(fallbackRes);
        updateActionMessage('update', parsed);
      } catch (e: unknown) {
        try {
          const fallbackRes = await fetch(`${manualSyncUrl}?mode=${mode}`, {
            method: 'POST',
            credentials: 'include',
            headers: buildRemoteSyncHeaders(mode),
          });
          if (fallbackRes.status === 409) {
            setActionMsg({ tone: 'warning', text: '已有更新任务正在执行中，请稍后刷新下方结果。' });
            scheduleObservabilityRefresh();
            setSyncing(false);
            return;
          }
          if (!fallbackRes.ok) {
            const parsed = await parseActionResponse(fallbackRes);
            const msg = e instanceof Error ? e.message : String(e);
            setErrorMsg(`未能发起本次更新，请稍后重试。${parsed.error ? `原因：${String(parsed.error)}` : ''}`);
            setSyncing(false);
            return;
          }
          const parsed = await parseActionResponse(fallbackRes);
          updateActionMessage('update', parsed);
        } catch (fallbackError: unknown) {
          const fb = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
          setErrorMsg(`未能发起本次更新，请稍后重试。${fb ? `原因：${fb}` : ''}`);
          setSyncing(false);
          return;
        }
      }
    }

    scheduleObservabilityRefresh();
    setSyncing(false);
  }, [activeSource, apiBase, buildRaceIdsHeader, buildRemoteSyncHeaders, hasServiceRoleKey, manualSyncUrl, scheduleObservabilityRefresh, updateActionMessage]);

  const resetAndSync = async () => {
    setSyncing(true);
    setErrorMsg(null);
    setActionMsg(null);
    if (!isLocalhost()) {
      try {
        const remoteRes = await fetch(`${manualSyncUrl}?mode=full&reset=1`, {
          method: 'POST',
          credentials: 'include',
          headers: buildRemoteSyncHeaders('full'),
        });
        if (remoteRes.status === 409) {
          setActionMsg({ tone: 'warning', text: '已有更新任务正在执行中，请稍后刷新下方结果。' });
          scheduleObservabilityRefresh();
          setSyncing(false);
          return;
        }
        if (!remoteRes.ok) {
          const parsed = await parseActionResponse(remoteRes);
          setErrorMsg(`未能发起清空后重载，请稍后重试。${parsed.error ? `原因：${String(parsed.error)}` : ''}`);
          setSyncing(false);
          return;
        }
        const parsed = await parseActionResponse(remoteRes);
        updateActionMessage('reset', parsed);
        scheduleObservabilityRefresh();
        setSyncing(false);
        return;
      } catch (error) {
        setErrorMsg(`未能发起清空后重载，请稍后重试。${error instanceof Error ? `原因：${error.message}` : ''}`);
        setSyncing(false);
        return;
      }
    }
    let res: Response;
    let parsed: ActionResponsePayload = {};
    try {
      res = await fetch(`${apiBase}/reset`, { method: 'POST' });
    } catch (e: unknown) {
      const localHint =
        hasServiceRoleKey === false
          ? '需要在 `.env.local` 配置 SUPABASE_SERVICE_ROLE_KEY 才能清空重建（仅本地，不提交）。'
          : '';
      setErrorMsg(`清空数据失败：${String(e)}。${localHint}`);
      setSyncing(false);
      return;
    }
    if (!res.ok) {
      parsed = await parseActionResponse(res);
      const localHint =
        hasServiceRoleKey === false
          ? '需要在 `.env.local` 配置 SUPABASE_SERVICE_ROLE_KEY 才能清空重建（仅本地，不提交）。'
          : '';
      setErrorMsg(`清空数据失败：${String(parsed.error ?? res.status)}。${localHint}`);
      setSyncing(false);
      return;
    }
    parsed = await parseActionResponse(res);
    if (parsed.warning || parsed.resetApplied === false) {
      updateActionMessage('reset', parsed);
    }
    await triggerSync('full');
    setSyncing(false);
  };

  useEffect(() => {
    void loadObservability();
    loadVisitStats();
    void loadActiveSource();
    if (!isLocalhost()) {
      setHasServiceRoleKey(null);
      return;
    }
    fetch(`${apiBase}/health`)
      .then((r) => r.json())
      .then((j) => setHasServiceRoleKey(Boolean(j?.hasServiceRoleKey)))
      .catch(() => setHasServiceRoleKey(null));
  }, [apiBase, loadObservability]);

  useEffect(() => {
    const handler = () => {
      loadVisitStats();
    };
    window.addEventListener('matchlife:visit-recorded', handler);
    return () => {
      for (const timer of refreshTimersRef.current) {
        window.clearTimeout(timer);
      }
      refreshTimersRef.current = [];
      window.removeEventListener('matchlife:visit-recorded', handler);
    };
  }, []);

  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.hidden) return;
      void loadObservability();
    };
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        void loadObservability();
      }
    };
    const timer = window.setInterval(refreshIfVisible, OBSERVABILITY_REFRESH_MS);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [loadObservability]);

  useEffect(() => {
    if (!autoSync) return;

    const timer = window.setInterval(async () => {
      setAutoTickAt(new Date().toISOString());
      await triggerSync('fast');
    }, AUTO_SYNC_REFRESH_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [autoSync, triggerSync]);

  const summary = snapshot?.summary;
  const runtime = snapshot?.runtime;
  const sourceHealth = useMemo(() => snapshot?.sources || [], [snapshot?.sources]);
  const alerts = snapshot?.alerts || [];
  const pausedScopes = snapshot?.governance.pausedScopes || [];
  const recentRuns = snapshot?.recentRuns || [];

  const unhealthySources = useMemo(
    () => sourceHealth.filter((item) => item.statusLevel === 'warning' || item.statusLevel === 'critical'),
    [sourceHealth],
  );

  const formatDateTime = (value?: string | null) => {
    if (!value) return '-';
    const time = new Date(value);
    return Number.isNaN(time.getTime()) ? '-' : format(time, 'yyyy-MM-dd HH:mm:ss');
  };

  const getRunBadge = (status: string, severity: StatusLevel) => {
    if (status === 'FAILED' || severity === 'critical') {
      return 'border-red-200 bg-red-50 text-red-700';
    }
    if (severity === 'warning') {
      return 'border-amber-200 bg-amber-50 text-amber-800';
    }
    return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col items-center pb-20 pt-4 sm:pt-6">
      <div className="mb-8 flex w-full flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="mb-2 text-2xl font-extrabold text-brand-brown sm:text-3xl">更新状态</h1>
          <p className="max-w-2xl text-sm leading-6 text-brand-gray sm:text-base">
            查看最近一次更新是否顺利、哪些赛事还在整理中，以及建议处理方式。
          </p>
        </div>
        <div className="flex items-center gap-2 self-start rounded-full border border-orange-100 bg-white/85 px-2 py-2 shadow-sm backdrop-blur-sm">
          <ActionIconButton
            title="立即更新"
            hint="立即刷新当前已启用赛事，获取最新比赛结果。"
            onClick={() => triggerSync('full')}
            disabled={syncing}
            loading={syncing}
            gradient
            icon={<RefreshCw className="h-4 w-4" />}
          />
          <ActionIconButton
            title="清空后重载"
            hint="先清空当前数据，再重新完整更新一次。"
            onClick={resetAndSync}
            disabled={syncing}
            danger
            icon={<Trash2 className="h-4 w-4" />}
          />
          <ActionIconButton
            title={autoSync ? '停止自动刷新(30s)' : '自动刷新(30s)'}
            hint={autoSync ? '已开启自动刷新，每 30 秒拉取一次最新结果。' : '开启后每 30 秒自动刷新一次结果。'}
            onClick={() => setAutoSync((v) => !v)}
            active={autoSync}
            icon={<Sparkles className="h-4 w-4" />}
          />
          <ActionIconButton
            title="刷新状态"
            hint="重新读取最新状态和访问统计，不会触发新的更新任务。"
            onClick={() => {
              void loadObservability();
              loadVisitStats();
            }}
            loading={loading}
            icon={<RotateCcw className="h-4 w-4" />}
          />
        </div>
      </div>

      {autoSync && (
        <div className="mb-4 w-full rounded-2xl border border-emerald-100 bg-emerald-50/60 px-4 py-3 text-sm font-medium text-emerald-700">
          自动刷新已开启，每 30 秒检查一次最新结果。最近一次刷新：{autoTickAt ? format(new Date(autoTickAt), 'HH:mm:ss') : '-'}
        </div>
      )}

      {activeSource && (
        <div className="mb-4 w-full rounded-2xl border border-sky-100 bg-sky-50/60 px-4 py-3 text-sm text-sky-700">
          当前更新赛事：<span className="font-bold">{activeSource.name}</span>
        </div>
      )}

      {actionMsg && (
        <div
          className={`mb-4 w-full rounded-2xl border px-4 py-3 text-sm font-medium ${
            actionMsg.tone === 'warning'
              ? 'border-amber-200 bg-amber-50 text-amber-800'
              : 'border-emerald-200 bg-emerald-50 text-emerald-700'
          }`}
        >
          {actionMsg.text}
        </div>
      )}

      {snapshot && (
        <div className="mb-4 w-full rounded-2xl border border-orange-100 bg-white/85 px-4 py-3 text-sm text-brand-gray">
          最近更新时间：<span className="font-bold text-brand-brown">{formatDateTime(snapshot.generatedAt)}</span>
        </div>
      )}

      <div className="mb-6 grid w-full gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: '当前状态',
            value: summary ? getStatusLabel(summary.overallStatus) : '-',
            hint: runtime ? runtime.summary || '暂无告警' : '等待加载',
            tone: summary ? getStatusTone(summary.overallStatus) : 'text-brand-brown bg-orange-50 border-orange-100',
            icon: <ShieldAlert className="h-5 w-5" />,
          },
          {
            label: '更新提醒',
            value: summary ? `${summary.unhealthySourceCount}/${summary.sourceCount}` : '0/0',
            hint: unhealthySources[0]?.summary || '当前来源均可正常更新',
            tone:
              unhealthySources.length > 0
                ? getStatusTone(unhealthySources.some((item) => item.statusLevel === 'critical') ? 'critical' : 'warning')
                : getStatusTone('healthy'),
            icon: <Server className="h-5 w-5" />,
          },
          {
            label: '最近更新',
            value: formatDateTime(runtime?.lastPersistedAt || runtime?.lastSourceUpdatedAt),
            hint: runtime?.summary || '等待最新更新结果',
            tone: 'text-sky-600 bg-sky-100 border-sky-200',
            icon: <Activity className="h-5 w-5" />,
          },
          {
            label: '待处理比赛',
            value: (runtime?.pendingPersistCount ?? 0) + (runtime?.manualReviewCount ?? 0),
            hint: runtime ? `数据刷新延迟：${formatSecondsRough(runtime.sourceLagSeconds)}` : '-',
            tone: 'text-amber-600 bg-amber-100 border-amber-200',
            icon: <Gauge className="h-5 w-5" />,
          },
          {
            label: '更新失败',
            value: runtime?.persistFailedCount ?? 0,
            hint: runtime?.recoveryAction || '当前没有需要额外处理的问题',
            tone:
              (runtime?.persistFailedCount || 0) > 0
                ? 'text-red-700 bg-red-50 border-red-200'
                : 'text-emerald-600 bg-emerald-100 border-emerald-200',
            icon: <Database className="h-5 w-5" />,
          },
          {
            label: '需要确认',
            value: runtime?.manualReviewCount ?? 0,
            hint: `需要进一步确认 ${runtime?.qualityBlockedCount ?? 0} 场`,
            tone:
              (runtime?.manualReviewCount || 0) > 0 || (runtime?.qualityBlockedCount || 0) > 0
                ? 'text-red-700 bg-red-50 border-red-200'
                : 'text-emerald-600 bg-emerald-100 border-emerald-200',
            icon: <Wrench className="h-5 w-5" />,
          },
          {
            label: '受影响范围',
            value: summary?.pausedScopeCount ?? 0,
            hint: pausedScopes[0]?.pauseReason || '当前没有受影响的统计范围',
            tone:
              (summary?.pausedScopeCount || 0) > 0
                ? getStatusTone((summary?.criticalPausedScopeCount || 0) > 0 ? 'critical' : 'warning')
                : getStatusTone('healthy'),
            icon: <AlertTriangle className="h-5 w-5" />,
          },
        ].map((item) => (
          <div key={item.label} className="rounded-[26px] border border-orange-100 bg-white/85 p-5 shadow-sm backdrop-blur-sm">
            <div className={`mb-4 flex h-11 w-11 items-center justify-center rounded-2xl border ${item.tone}`}>
              {item.icon}
            </div>
            <div className="text-sm font-medium text-brand-gray">{item.label}</div>
            <div className="mt-2 text-3xl font-extrabold text-brand-brown">{item.value}</div>
            <div className="mt-2 line-clamp-3 text-xs text-brand-gray">{item.hint}</div>
          </div>
        ))}
      </div>

      {errorMsg && (
        <div className="w-full mb-6 bg-red-50 border border-red-200 text-red-700 px-6 py-4 rounded-3xl text-sm font-medium">
          {errorMsg}
        </div>
      )}

      {runtime && (
        <div className={`mb-6 w-full rounded-3xl border px-6 py-5 ${getStatusTone(runtime.statusLevel)}`}>
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 h-5 w-5 flex-shrink-0" />
            <div>
              <div className="font-bold">
                当前状态：{getStatusLabel(runtime.statusLevel)}
              </div>
              <div className="mt-1 leading-6">{runtime.summary || '当前实时链路状态正常。'}</div>
              {runtime.recoveryAction && <div className="mt-2 leading-6">建议处理：{runtime.recoveryAction}</div>}
              <div className="mt-2 text-xs">
                数据延迟 {formatSecondsRough(runtime.sourceLagSeconds)} · 最近确认更新 {formatDateTime(runtime.lastPersistedAt)}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="mb-6 w-full rounded-3xl border border-orange-50 bg-white/80 shadow-sm backdrop-blur-sm">
        <div className="border-b border-orange-100 px-6 py-5">
          <h2 className="flex items-center gap-2 text-lg font-extrabold text-brand-brown sm:text-xl">
            <AlertTriangle className="h-5 w-5 text-orange-500" />
            当前提醒
          </h2>
          <p className="mt-1 text-sm text-brand-gray">集中展示当前最需要关注的问题和建议处理方式。</p>
        </div>
        <div className="space-y-3 p-5">
          {loading ? (
            <div className="rounded-2xl border border-orange-100 bg-orange-50/50 px-4 py-3 text-sm text-orange-600">加载中...</div>
          ) : alerts.length === 0 ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">当前没有阻塞或关注级告警。</div>
          ) : (
            alerts.map((alert) => (
              <div key={alert.alertKey} className={`rounded-2xl border px-4 py-4 ${getStatusTone(alert.severity)}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-current/20 px-3 py-1 text-xs font-bold">{getStatusLabel(alert.severity)}</span>
                  <span className="text-sm font-bold">{alert.scopeLabel}</span>
                </div>
                <div className="mt-2 text-sm leading-6">{alert.summary || '暂无摘要'}</div>
                {alert.recoveryAction && <div className="mt-2 text-sm leading-6">建议处理：{alert.recoveryAction}</div>}
                <div className="mt-2 text-xs opacity-80">最近发生：{formatDateTime(alert.occurredAt)}</div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="mb-6 w-full rounded-3xl border border-orange-50 bg-white/80 shadow-sm backdrop-blur-sm">
        <div className="border-b border-orange-100 px-6 py-5">
          <h2 className="flex items-center gap-2 text-lg font-extrabold text-brand-brown sm:text-xl">
            <Server className="h-5 w-5 text-orange-500" />
            更新来源情况
          </h2>
          <p className="mt-1 text-sm text-brand-gray">查看各更新来源是否正常、最近更新时间和建议处理方式。</p>
        </div>
        <div className="space-y-3 p-5">
          {loading ? (
            <div className="rounded-2xl border border-orange-100 bg-orange-50/50 px-4 py-3 text-sm text-orange-600">加载中...</div>
          ) : sourceHealth.length === 0 ? (
            <div className="rounded-2xl border border-orange-100 bg-white px-4 py-3 text-sm text-brand-gray">暂无来源健康样本。</div>
          ) : (
            sourceHealth.map((source) => (
              <div key={source.id} className="rounded-2xl border border-orange-100 bg-white px-4 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full border px-3 py-1 text-xs font-bold ${getStatusTone(source.statusLevel)}`}>
                    {getStatusLabel(source.statusLevel)}
                  </span>
                  <span className="text-sm font-bold text-brand-brown">{source.name}</span>
                  {!source.isDue && source.nextEligibleAt && (
                    <span className="text-xs text-amber-700">稍后重试 {formatDateTime(source.nextEligibleAt)}</span>
                  )}
                </div>
                <div className="mt-2 text-sm leading-6 text-brand-gray">{source.summary || '暂无摘要'}</div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-brand-gray">
                  <span>更新延迟：{formatSecondsRough(source.collectionLagSeconds)}</span>
                  <span>连续失败：{source.failureStreak}</span>
                  <span>最近成功：{formatDateTime(source.lastSucceededAt)}</span>
                </div>
                {source.lastErrorMessage && (
                  <div className="mt-2 rounded-2xl bg-orange-50/70 px-3 py-2 text-xs text-brand-gray">
                    最近问题：{source.lastErrorMessage}
                  </div>
                )}
                {source.recoveryAction && <div className="mt-2 text-xs text-brand-brown">建议处理：{source.recoveryAction}</div>}
              </div>
            ))
          )}
        </div>
      </div>

      <div className="mb-6 w-full rounded-3xl border border-orange-50 bg-white/80 shadow-sm backdrop-blur-sm">
        <div className="border-b border-orange-100 px-6 py-5">
          <h2 className="flex items-center gap-2 text-lg font-extrabold text-brand-brown sm:text-xl">
            <Gauge className="h-5 w-5 text-orange-500" />
            受影响的赛事范围
          </h2>
          <p className="mt-1 text-sm text-brand-gray">当结果仍在更新时，这里会提示哪些赛事统计需要稍后再看。</p>
        </div>
        <div className="space-y-3 p-5">
          {loading ? (
            <div className="rounded-2xl border border-orange-100 bg-orange-50/50 px-4 py-3 text-sm text-orange-600">加载中...</div>
          ) : pausedScopes.length === 0 ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">当前没有受影响的赛事范围。</div>
          ) : (
            pausedScopes.map((scope) => (
              <div key={scope.scopeKey} className={`rounded-2xl border px-4 py-4 ${getStatusTone(scope.statusLevel)}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-current/20 px-3 py-1 text-xs font-bold">{scope.scopeType === 'leaderboard' ? '排行榜' : '赛事统计'}</span>
                  <span className="text-sm font-bold">{scope.scopeLabel}</span>
                </div>
                <div className="mt-2 text-sm leading-6">{scope.pauseReason || scope.scopeSummary || '当前范围暂停'}</div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs opacity-90">
                  <span>影响比赛：{scope.affectedMatchCount}</span>
                  <span>待处理：{scope.pendingPersistCount}</span>
                  <span>更新失败：{scope.persistFailedCount}</span>
                  <span>需要确认：{scope.manualReviewCount}</span>
                </div>
                {scope.affectedSources.length > 0 && (
                  <div className="mt-2 text-xs">影响来源：{scope.affectedSources.join('、')}</div>
                )}
                {scope.recoveryAction && <div className="mt-2 text-xs">建议处理：{scope.recoveryAction}</div>}
              </div>
            ))
          )}
        </div>
      </div>

      <div className="w-full overflow-hidden rounded-3xl border border-orange-50 bg-white/80 shadow-sm backdrop-blur-sm">
        <div className="border-b border-orange-100 px-6 py-5">
          <h2 className="flex items-center gap-2 text-lg font-extrabold text-brand-brown sm:text-xl">
            <Clock className="h-5 w-5 text-orange-500" />
            最近更新记录
          </h2>
          <p className="mt-1 text-sm text-brand-gray">展示最近一次次更新结果，方便确认是否正常完成。</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-orange-100 bg-orange-50/50 text-brand-brown">
                <th className="p-4 font-bold">同步时间</th>
                <th className="p-4 font-bold">来源</th>
                <th className="p-4 font-bold">状态</th>
                <th className="p-4 font-bold">异常环节</th>
                <th className="p-4 font-bold">更新量</th>
                <th className="p-4 font-bold">处理建议</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-orange-500">加载中...</td>
                </tr>
              ) : recentRuns.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-brand-gray">暂无运行记录</td>
                </tr>
              ) : (
                recentRuns.map((run) => (
                  <tr key={run.id} className="border-b border-orange-50 transition-colors hover:bg-orange-50/30">
                    <td className="p-4 text-brand-brown">
                      <div className="font-medium">{formatDateTime(run.runAt)}</div>
                      <div className="mt-1 text-xs text-brand-gray">{run.triggerMode || '-'}</div>
                    </td>
                    <td className="p-4">
                      <div className="font-bold text-brand-brown">{run.adapterKey || run.source}</div>
                    </td>
                    <td className="p-4">
                      <span className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm font-bold ${getRunBadge(run.status, run.severity)}`}>
                        {run.status === 'FAILED' || run.severity === 'critical' ? (
                          <AlertTriangle className="h-4 w-4" />
                        ) : (
                          <CheckCircle className="h-4 w-4" />
                        )}
                        {run.status === 'FAILED' ? '失败' : getStatusLabel(run.severity)}
                      </span>
                    </td>
                    <td className="p-4">
                      <div className="text-sm font-bold text-brand-brown">
                        {run.failureStage || (run.severity === 'healthy' ? '无异常' : '运行信号')}
                      </div>
                      <div className="mt-1 text-xs text-brand-gray">
                        {run.failureCode || run.summary || run.errorMessage || '-'}
                      </div>
                    </td>
                    <td className="p-4 text-sm text-brand-gray">
                      拉取 {run.pulledCount} · 更新 {run.upsertedCount}
                      <div className="mt-1 text-xs">
                        处理中 {run.activeCachedCount ?? 0} · 待处理 {run.pendingPersistCount ?? 0} · 已完成 {run.persistedCount ?? 0}
                      </div>
                    </td>
                    <td className="p-4 text-sm text-brand-gray">
                      <div>{run.recoveryAction || '当前无需额外处理'}</div>
                      {run.summary && <div className="mt-1 text-xs">{run.summary}</div>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-8 w-full rounded-3xl border border-orange-100 bg-white/85 p-5 shadow-sm backdrop-blur-sm sm:p-6">
        <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-extrabold text-brand-brown sm:text-xl">
              <Gauge className="h-5 w-5 text-orange-500" />
              使用情况
            </h2>
            <p className="mt-1 text-sm text-brand-gray">
              按同一网络与终端类型做周期去重，帮助查看页面覆盖情况。
            </p>
          </div>
          <div className="rounded-full bg-orange-50 px-3 py-1 text-xs font-bold text-orange-700">
            去重统计
          </div>
        </div>

        {visitStatsError ? (
          <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            {visitStatsError}
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: '今日访问', value: visitStats?.today ?? 0, icon: <Clock className="h-5 w-5" />, tone: 'text-orange-500 bg-orange-100' },
            { label: '本周访问', value: visitStats?.week ?? 0, icon: <Activity className="h-5 w-5" />, tone: 'text-sky-600 bg-sky-100' },
            { label: '本月访问', value: visitStats?.month ?? 0, icon: <Sparkles className="h-5 w-5" />, tone: 'text-emerald-600 bg-emerald-100' },
            { label: '累计访问', value: visitStats?.all ?? 0, icon: <CheckCircle className="h-5 w-5" />, tone: 'text-brand-brown bg-orange-50' },
          ].map((item) => (
            <div key={item.label} className="rounded-[26px] border border-orange-100 bg-gradient-to-br from-orange-50/70 to-white p-5">
              <div className={`mb-4 flex h-11 w-11 items-center justify-center rounded-2xl ${item.tone}`}>
                {item.icon}
              </div>
              <div className="text-sm font-medium text-brand-gray">{item.label}</div>
              <div className="mt-2 text-3xl font-extrabold text-brand-brown">{item.value}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
