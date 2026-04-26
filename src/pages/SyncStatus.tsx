import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { format } from 'date-fns';
import {
  Activity,
  AlertTriangle,
  CheckCircle,
  Clock,
  Gauge,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { fetchVisitStats, normalizeVisitStatsError, type VisitStats } from '../lib/visitMetrics';
import { fetchSourcesFromDb, getRaceIdFromSource, type SourceItem } from '../lib/dataSources';

type SyncRunRow = {
  id: string;
  run_at: string;
  source: string;
  status: 'SUCCESS' | 'FAILED' | string;
  pulled_count: number;
  upserted_count: number;
  error_message: string | null;
};

function parseRunMeta(msg: string | null) {
  const text = (msg || '').trim();
  if (!text) {
    return {
      kind: null as string | null,
      hotCourts: null as number | null,
      pages: null as number | null,
      inserted: null as number | null,
      updated: null as number | null,
      skipped: null as number | null,
    };
  }
  const kind = text.match(/(?:^|;\s*)kind=([^;]+)/)?.[1]?.trim() || null;
  const hotCourtsRaw = text.match(/(?:^|;\s*)hotCourts=(\d+)/)?.[1] || null;
  const pagesRaw = text.match(/(?:^|;\s*)pages=(\d+)/)?.[1] || null;
  const insertedRaw = text.match(/(?:^|;\s*)inserted=(\d+)/)?.[1] || null;
  const updatedRaw = text.match(/(?:^|;\s*)updated=(\d+)/)?.[1] || null;
  const skippedRaw = text.match(/(?:^|;\s*)skipped=(\d+)/)?.[1] || null;
  return {
    kind,
    hotCourts: hotCourtsRaw ? Number(hotCourtsRaw) : null,
    pages: pagesRaw ? Number(pagesRaw) : null,
    inserted: insertedRaw ? Number(insertedRaw) : null,
    updated: updatedRaw ? Number(updatedRaw) : null,
    skipped: skippedRaw ? Number(skippedRaw) : null,
  };
}

type ActionIconButtonProps = {
  title: string;
  onClick: () => void;
  icon: React.ReactNode;
  disabled?: boolean;
  active?: boolean;
  danger?: boolean;
  loading?: boolean;
  gradient?: boolean;
};

function ActionIconButton({
  title,
  onClick,
  icon,
  disabled,
  active,
  danger,
  loading,
  gradient,
}: ActionIconButtonProps) {
  return (
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
  );
}

export default function SyncStatus() {
  const [syncRuns, setSyncRuns] = useState<SyncRunRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [autoSync, setAutoSync] = useState(false);
  const [autoTickAt, setAutoTickAt] = useState<string | null>(null);
  const [hasServiceRoleKey, setHasServiceRoleKey] = useState<boolean | null>(null);
  const [visitStats, setVisitStats] = useState<VisitStats | null>(null);
  const [visitStatsError, setVisitStatsError] = useState<string | null>(null);
  const [sources, setSources] = useState<SourceItem[]>([]);
  const [activeSource, setActiveSource] = useState<SourceItem | null>(null);
  const apiBase = `${import.meta.env.BASE_URL}api`.replace(/\/{2,}/g, '/');
  const manualSyncUrl = `${apiBase}/wechat/manual-sync`;

  const isLocalhost = () => {
    const host = window.location.hostname;
    return host === 'localhost' || host === '127.0.0.1';
  };

  useEffect(() => {
    fetchSyncRuns();
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
  }, [apiBase]);

  const loadActiveSource = async () => {
    try {
      const list = await fetchSourcesFromDb();
      setSources(list);
      const enabled = list.filter((item) => item.enabled);
      setActiveSource(enabled[0] || list[0] || null);
    } catch {
      setSources([]);
      setActiveSource(null);
    }
  };

  const buildRaceIdsHeader = () => {
    const raceIds = sources
      .filter((item) => item.enabled)
      .map((item) => getRaceIdFromSource(item.url))
      .filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0);
    if (!raceIds.length) return null;
    return Array.from(new Set(raceIds)).join(',');
  };

  useEffect(() => {
    const handler = () => {
      loadVisitStats();
    };
    window.addEventListener('matchlife:visit-recorded', handler);
    return () => {
      window.removeEventListener('matchlife:visit-recorded', handler);
    };
  }, []);

  useEffect(() => {
    let timer: number | null = null;
    const channel = supabase
      .channel(`ml_sync_runs_${Date.now()}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'sync_runs' },
        () => {
          if (timer) window.clearTimeout(timer);
          timer = window.setTimeout(() => {
            fetchSyncRuns();
          }, 300);
        }
      )
      .subscribe();

    return () => {
      if (timer) window.clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    if (!autoSync) return;

    const timer = window.setInterval(async () => {
      setAutoTickAt(new Date().toISOString());
      await triggerSync('fast');
    }, 10_000);

    return () => {
      window.clearInterval(timer);
    };
  }, [autoSync]);

  const loadVisitStats = async () => {
    try {
      setVisitStatsError(null);
      const stats = await fetchVisitStats(supabase);
      setVisitStats(stats);
    } catch (error) {
      setVisitStatsError(normalizeVisitStatsError(error));
    }
  };

  const fetchSyncRuns = async () => {
    setLoading(true);
    setErrorMsg(null);
    const { data, error } = await supabase
      .from('sync_runs')
      .select('*')
      .order('run_at', { ascending: false })
      .limit(5);

    if (error) {
      setErrorMsg(error.message);
      setLoading(false);
      return;
    }
    
    if (data) setSyncRuns(data as SyncRunRow[]);
    setLoading(false);
  };

  const triggerSync = async (mode: 'full' | 'fast' = 'full') => {
    setSyncing(true);
    setErrorMsg(null);

    if (isLocalhost()) {
      let localRes: Response;
      const localRaceIds = buildRaceIdsHeader();
      const localRaceId = activeSource ? getRaceIdFromSource(activeSource.url) : null;
      try {
        localRes = await fetch(`${apiBase}/sync?mode=${mode}`, {
          method: 'POST',
          headers: {
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
        const j: unknown = await localRes.json().catch(() => ({}));
        const parsed = (typeof j === 'object' && j !== null ? (j as Record<string, unknown>) : {}) as Record<string, unknown>;
        const localHint =
          hasServiceRoleKey === false
            ? '请在 `.env.local` 填写 SUPABASE_SERVICE_ROLE_KEY（仅本地，不提交）。'
            : '请检查本地开发服务器日志。';
        setErrorMsg(`本地同步失败：${String(parsed.error ?? localRes.status)}。${localHint}`);
        setSyncing(false);
        return;
      }
    } else {
      try {
        const tryEdge = await supabase.functions.invoke('sync-ymq', { method: 'POST', body: { mode } });
        if (!tryEdge.error) {
          await fetchSyncRuns();
          setSyncing(false);
          return;
        }

        const fallbackRes = await fetch(`${manualSyncUrl}?mode=${mode}`, {
          method: 'POST',
          credentials: 'include',
          headers: {
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
            ...(activeSource ? (() => {
              const raceId = getRaceIdFromSource(activeSource.url);
              return raceId ? { 'x-matchlife-race-id': String(raceId) } : {};
            })() : {}),
          },
        });
        if (fallbackRes.status === 409) {
          // A sync job is already running on server; treat as an in-progress state instead of hard error.
          await fetchSyncRuns();
          setSyncing(false);
          return;
        }
        if (!fallbackRes.ok) {
          const j: unknown = await fallbackRes.json().catch(() => ({}));
          const parsed =
            typeof j === 'object' && j !== null ? (j as Record<string, unknown>) : {};
          setErrorMsg(
            `Edge Function 调用失败：${tryEdge.error.message}；后备通道失败：${String(parsed.error ?? fallbackRes.status)}`
          );
          setSyncing(false);
          return;
        }
      } catch (e: unknown) {
        try {
          const fallbackRes = await fetch(`${manualSyncUrl}?mode=${mode}`, {
            method: 'POST',
            credentials: 'include',
            headers: {
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
              ...(activeSource ? (() => {
                const raceId = getRaceIdFromSource(activeSource.url);
                return raceId ? { 'x-matchlife-race-id': String(raceId) } : {};
              })() : {}),
            },
          });
          if (fallbackRes.status === 409) {
            await fetchSyncRuns();
            setSyncing(false);
            return;
          }
          if (!fallbackRes.ok) {
            const j: unknown = await fallbackRes.json().catch(() => ({}));
            const parsed =
              typeof j === 'object' && j !== null ? (j as Record<string, unknown>) : {};
            const msg = e instanceof Error ? e.message : String(e);
            setErrorMsg(
              `Edge Function 调用失败：${msg}；后备通道失败：${String(parsed.error ?? fallbackRes.status)}`
            );
            setSyncing(false);
            return;
          }
        } catch (fallbackError: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          const fb = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
          setErrorMsg(`Edge Function 调用失败：${msg}；后备通道失败：${fb}`);
          setSyncing(false);
          return;
        }
      }
    }

    await fetchSyncRuns();
    setSyncing(false);
  };

  const resetAndSync = async () => {
    setSyncing(true);
    setErrorMsg(null);
    if (!isLocalhost()) {
      setErrorMsg('清空并重建仅在本机调试环境提供（需要本机服务端密钥）。线上请使用已部署的同步服务。');
      setSyncing(false);
      return;
    }
    let res: Response;
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
      const j: unknown = await res.json().catch(() => ({}));
      const parsed = (typeof j === 'object' && j !== null ? (j as Record<string, unknown>) : {}) as Record<string, unknown>;
      const localHint =
        hasServiceRoleKey === false
          ? '需要在 `.env.local` 配置 SUPABASE_SERVICE_ROLE_KEY 才能清空重建（仅本地，不提交）。'
          : '';
      setErrorMsg(`清空数据失败：${String(parsed.error ?? res.status)}。${localHint}`);
      setSyncing(false);
      return;
    }
    await triggerSync('full');
    setSyncing(false);
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col items-center pb-20 pt-4 sm:pt-6">
      <div className="mb-8 flex w-full flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="mb-2 text-2xl font-extrabold text-brand-brown sm:text-3xl">数据同步状态</h1>
          <p className="max-w-2xl text-sm leading-6 text-brand-gray sm:text-base">
            监控赛事数据的自动抓取、入库表现与最近更新状态，便于快速确认当前系统的数据活跃度。
          </p>
        </div>
        <div className="flex items-center gap-2 self-start rounded-full border border-orange-100 bg-white/85 px-2 py-2 shadow-sm backdrop-blur-sm">
          <ActionIconButton
            title="全量同步"
            onClick={() => triggerSync('full')}
            disabled={syncing}
            loading={syncing}
            gradient
            icon={<RefreshCw className="h-4 w-4" />}
          />
          <ActionIconButton
            title="清空并重建"
            onClick={resetAndSync}
            disabled={syncing}
            danger
            icon={<Trash2 className="h-4 w-4" />}
          />
          <ActionIconButton
            title={autoSync ? '停止页面触发(10s)' : '页面触发(10s)'}
            onClick={() => setAutoSync((v) => !v)}
            active={autoSync}
            icon={<Sparkles className="h-4 w-4" />}
          />
          <ActionIconButton
            title="刷新状态"
            onClick={() => {
              fetchSyncRuns();
              loadVisitStats();
            }}
            loading={loading}
            icon={<RotateCcw className="h-4 w-4" />}
          />
        </div>
      </div>

      {autoSync && (
        <div className="mb-4 w-full rounded-2xl border border-emerald-100 bg-emerald-50/60 px-4 py-3 text-sm font-medium text-emerald-700">
          页面触发已开启，每 10 秒执行一次（用于本地手动测试）。最近一次触发：{autoTickAt ? format(new Date(autoTickAt), 'HH:mm:ss') : '-'}
        </div>
      )}

      {activeSource && (
        <div className="mb-4 w-full rounded-2xl border border-sky-100 bg-sky-50/60 px-4 py-3 text-sm text-sky-700">
          当前同步数据源：<span className="font-bold">{activeSource.name}</span> · {activeSource.url}
        </div>
      )}

      {errorMsg && (
        <div className="w-full mb-6 bg-red-50 border border-red-200 text-red-700 px-6 py-4 rounded-3xl text-sm font-medium">
          {errorMsg}
        </div>
      )}

      <div className="w-full overflow-hidden rounded-3xl border border-orange-50 bg-white/80 shadow-sm backdrop-blur-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-orange-50/50 border-b border-orange-100 text-brand-brown">
                <th className="p-4 font-bold">同步时间</th>
                <th className="p-4 font-bold">数据源</th>
                <th className="p-4 font-bold">状态</th>
                <th className="p-4 font-bold">拉取条数</th>
                <th className="p-4 font-bold">成功入库(含已存在)</th>
                <th className="p-4 font-bold">备注/错误</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-orange-500">加载中...</td>
                </tr>
              ) : syncRuns.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-brand-gray">暂无同步记录</td>
                </tr>
              ) : (
                syncRuns.map((run) => (
                  <tr key={run.id} className="border-b border-orange-50 hover:bg-orange-50/30 transition-colors">
                    <td className="p-4 text-brand-brown font-medium">
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-brand-gray" />
                        {format(new Date(run.run_at), 'yyyy-MM-dd HH:mm:ss')}
                      </div>
                    </td>
                    <td className="p-4">
                      <span className="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded-md font-bold">{run.source}</span>
                    </td>
                    <td className="p-4">
                      {run.status === 'SUCCESS' ? (
                        <span className="inline-flex items-center gap-1 text-green-600 font-bold bg-green-50 px-2 py-1 rounded-md text-sm">
                          <CheckCircle className="w-4 h-4" /> 成功
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-red-600 font-bold bg-red-50 px-2 py-1 rounded-md text-sm">
                          <AlertTriangle className="w-4 h-4" /> 失败
                        </span>
                      )}
                    </td>
                    <td className="p-4 font-extrabold text-brand-brown">{run.pulled_count}</td>
                    <td className="p-4 font-extrabold text-orange-500">
                      {run.upserted_count}
                    </td>
                    <td className="p-4 text-sm text-brand-gray truncate max-w-xs" title={run.error_message || '-'}>
                      {(() => {
                        const meta = parseRunMeta(run.error_message);
                        return (
                          <div className="flex items-center gap-2">
                            {meta.kind ? (
                              <span className="px-2 py-0.5 bg-sky-50 text-sky-700 text-xs rounded-md font-bold">
                                {meta.kind}
                              </span>
                            ) : null}
                            {typeof meta.hotCourts === 'number' ? (
                              <span className="px-2 py-0.5 bg-gray-50 text-gray-700 text-xs rounded-md font-bold">
                                活跃场地 {meta.hotCourts}
                              </span>
                            ) : null}
                            {typeof meta.inserted === 'number' || typeof meta.updated === 'number' || typeof meta.skipped === 'number' ? (
                              <span className="px-2 py-0.5 bg-orange-50 text-orange-700 text-xs rounded-md font-bold">
                                新增{meta.inserted || 0}/更新{meta.updated || 0}/复用{meta.skipped || 0}
                              </span>
                            ) : null}
                            <span className="truncate">{run.error_message || '-'}</span>
                          </div>
                        );
                      })()}
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
              访问量统计
            </h2>
            <p className="mt-1 text-sm text-brand-gray">
              按同一网络与终端类型进行周期去重，展示本系统的访问覆盖情况。
            </p>
          </div>
          <div className="rounded-full bg-orange-50 px-3 py-1 text-xs font-bold text-orange-700">
            系统级去重统计
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
