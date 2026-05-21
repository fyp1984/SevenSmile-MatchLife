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
          ? '本次已改为完整更新。'
          : '已开始重新整理，请稍后查看结果。'
        : '已开始更新，请稍后查看结果。';
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
        setErrorMsg(`本地更新失败，请稍后重试。${localHint}`);
        setSyncing(false);
        return;
      }

      if (!localRes.ok) {
        const parsed = await parseActionResponse(localRes);
        const localHint =
          hasServiceRoleKey === false
            ? '请在 `.env.local` 填写 SUPABASE_SERVICE_ROLE_KEY（仅本地，不提交）。'
            : '请检查本地开发服务器日志。';
        setErrorMsg(`本地更新失败，请稍后重试。${localHint}`);
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
          setActionMsg({ tone: 'warning', text: '已有更新正在进行中，请稍后再看。' });
          scheduleObservabilityRefresh();
          setSyncing(false);
          return;
        }
        if (!fallbackRes.ok) {
          const parsed = await parseActionResponse(fallbackRes);
          setErrorMsg(`这次更新没有成功开始，请稍后重试。${parsed.error ? ` ${String(parsed.error)}` : ''}`);
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
            setActionMsg({ tone: 'warning', text: '已有更新正在进行中，请稍后再看。' });
            scheduleObservabilityRefresh();
            setSyncing(false);
            return;
          }
          if (!fallbackRes.ok) {
            const parsed = await parseActionResponse(fallbackRes);
            setErrorMsg(`这次更新没有成功开始，请稍后重试。${parsed.error ? ` ${String(parsed.error)}` : ''}`);
            setSyncing(false);
            return;
          }
          const parsed = await parseActionResponse(fallbackRes);
          updateActionMessage('update', parsed);
        } catch (fallbackError: unknown) {
          const fb = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
          setErrorMsg(`这次更新没有成功开始，请稍后重试。${fb ? ` ${fb}` : ''}`);
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
          setActionMsg({ tone: 'warning', text: '已有更新正在进行中，请稍后再看。' });
          scheduleObservabilityRefresh();
          setSyncing(false);
          return;
        }
        if (!remoteRes.ok) {
          const parsed = await parseActionResponse(remoteRes);
          setErrorMsg(`重新整理没有成功开始，请稍后重试。${parsed.error ? ` ${String(parsed.error)}` : ''}`);
          setSyncing(false);
          return;
        }
        const parsed = await parseActionResponse(remoteRes);
        updateActionMessage('reset', parsed);
        scheduleObservabilityRefresh();
        setSyncing(false);
        return;
      } catch (error) {
        setErrorMsg(`重新整理没有成功开始，请稍后重试。${error instanceof Error ? ` ${error.message}` : ''}`);
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
      setErrorMsg(`重新整理前的清空失败，请稍后重试。${localHint}`);
      setSyncing(false);
      return;
    }
    if (!res.ok) {
      parsed = await parseActionResponse(res);
      const localHint =
        hasServiceRoleKey === false
          ? '需要在 `.env.local` 配置 SUPABASE_SERVICE_ROLE_KEY 才能清空重建（仅本地，不提交）。'
          : '';
      setErrorMsg(`重新整理前的清空失败，请稍后重试。${localHint}`);
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
    return () => {
      for (const timer of refreshTimersRef.current) {
        window.clearTimeout(timer);
      }
      refreshTimersRef.current = [];
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
    <div className="mx-auto flex w-full max-w-5xl flex-col items-center pb-16 pt-4 sm:pt-6">
      <div className="mb-6 flex w-full flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="mb-2 text-2xl font-extrabold text-brand-brown sm:text-3xl">更新状态</h1>
          <p className="max-w-2xl text-sm leading-6 text-brand-gray sm:text-base">
            这里可以快速看最近更新是否顺利、哪些内容还在整理。
          </p>
        </div>
        <div className="flex items-center gap-2 self-start rounded-full border border-orange-100 bg-white/85 px-2 py-2 shadow-sm backdrop-blur-sm">
          <ActionIconButton
            title="立即更新"
            hint="立即查看当前赛事的最新结果。"
            onClick={() => triggerSync('full')}
            disabled={syncing}
            loading={syncing}
            gradient
            icon={<RefreshCw className="h-4 w-4" />}
          />
          <ActionIconButton
            title="重新整理"
            hint="从头再整理一次当前数据。"
            onClick={resetAndSync}
            disabled={syncing}
            danger
            icon={<Trash2 className="h-4 w-4" />}
          />
          <ActionIconButton
            title={autoSync ? '停止自动查看' : '自动查看'}
            hint={autoSync ? '已开启自动查看，每 30 秒更新一次。' : '开启后每 30 秒自动更新一次。'}
            onClick={() => setAutoSync((v) => !v)}
            active={autoSync}
            icon={<Sparkles className="h-4 w-4" />}
          />
          <ActionIconButton
            title="刷新状态"
            hint="只更新当前页面显示，不会重新开始整理。"
            onClick={() => {
              void loadObservability();
            }}
            loading={loading}
            icon={<RotateCcw className="h-4 w-4" />}
          />
        </div>
      </div>

      {autoSync && (
        <div className="mb-4 w-full rounded-2xl border border-emerald-100 bg-emerald-50/60 px-4 py-3 text-sm font-medium text-emerald-700">
          自动刷新已开启，每 30 秒检查一次。最近一次：{autoTickAt ? format(new Date(autoTickAt), 'HH:mm:ss') : '-'}
        </div>
      )}

      {activeSource && (
        <div className="mb-4 w-full rounded-2xl border border-sky-100 bg-sky-50/60 px-4 py-3 text-sm text-sky-700">
          当前更新对象：<span className="font-bold">{activeSource.name}</span>
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
            hint: runtime ? runtime.summary || '当前状态正常' : '正在准备',
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
            hint: runtime?.summary || '等待最新结果',
            tone: 'text-sky-600 bg-sky-100 border-sky-200',
            icon: <Activity className="h-5 w-5" />,
          },
          {
            label: '待处理比赛',
            value: (runtime?.pendingPersistCount ?? 0) + (runtime?.manualReviewCount ?? 0),
            hint: runtime ? `当前延迟：${formatSecondsRough(runtime.sourceLagSeconds)}` : '-',
            tone: 'text-amber-600 bg-amber-100 border-amber-200',
            icon: <Gauge className="h-5 w-5" />,
          },
          {
            label: '更新失败',
            value: runtime?.persistFailedCount ?? 0,
            hint: runtime?.recoveryAction || '当前没有额外问题',
            tone:
              (runtime?.persistFailedCount || 0) > 0
                ? 'text-red-700 bg-red-50 border-red-200'
                : 'text-emerald-600 bg-emerald-100 border-emerald-200',
            icon: <Database className="h-5 w-5" />,
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

      <div className="w-full overflow-hidden rounded-3xl border border-orange-50 bg-white/80 shadow-sm backdrop-blur-sm">
        <div className="border-b border-orange-100 px-6 py-5">
          <h2 className="flex items-center gap-2 text-lg font-extrabold text-brand-brown sm:text-xl">
            <Clock className="h-5 w-5 text-orange-500" />
            最近更新记录
          </h2>
          <p className="mt-1 text-sm text-brand-gray">快速查看最近几次更新结果。</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-orange-100 bg-orange-50/50 text-brand-brown">
                <th className="p-4 font-bold">时间</th>
                <th className="p-4 font-bold">来源</th>
                <th className="p-4 font-bold">状态</th>
                <th className="p-4 font-bold">说明</th>
                <th className="p-4 font-bold">结果</th>
                <th className="p-4 font-bold">建议</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-orange-500">正在加载...</td>
                </tr>
              ) : recentRuns.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-brand-gray">暂时还没有更新记录</td>
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

    </div>
  );
}
