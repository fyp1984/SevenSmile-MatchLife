import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { format } from 'date-fns';
import { RefreshCw, CheckCircle, AlertTriangle, Clock } from 'lucide-react';

type SyncRunRow = {
  id: string;
  run_at: string;
  source: string;
  status: 'SUCCESS' | 'FAILED' | string;
  pulled_count: number;
  upserted_count: number;
  error_message: string | null;
};

export default function SyncStatus() {
  const [syncRuns, setSyncRuns] = useState<SyncRunRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [autoSync, setAutoSync] = useState(false);
  const [autoTickAt, setAutoTickAt] = useState<string | null>(null);
  const [hasServiceRoleKey, setHasServiceRoleKey] = useState<boolean | null>(null);

  const isLocalhost = () => {
    const host = window.location.hostname;
    return host === 'localhost' || host === '127.0.0.1';
  };

  useEffect(() => {
    fetchSyncRuns();
    fetch('/api/health')
      .then((r) => r.json())
      .then((j) => setHasServiceRoleKey(Boolean(j?.hasServiceRoleKey)))
      .catch(() => setHasServiceRoleKey(null));
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

  const fetchSyncRuns = async () => {
    setLoading(true);
    setErrorMsg(null);
    const { data, error } = await supabase
      .from('sync_runs')
      .select('*')
      .order('run_at', { ascending: false })
      .limit(10);

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
      try {
        localRes = await fetch(`/api/sync?mode=${mode}`, { method: 'POST' });
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
        if (tryEdge.error) {
          setErrorMsg(`Edge Function 调用失败：${tryEdge.error.message}。请先部署 Supabase Edge Function（sync-ymq）并配置其环境变量。`);
          setSyncing(false);
          return;
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setErrorMsg(`Edge Function 调用失败：${msg}。请先部署 Supabase Edge Function（sync-ymq）。`);
        setSyncing(false);
        return;
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
      res = await fetch('/api/reset', { method: 'POST' });
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
    <div className="flex flex-col items-center pt-6 pb-20 w-full max-w-4xl mx-auto">
      <div className="w-full mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-extrabold text-brand-brown mb-2">数据同步状态</h1>
          <p className="text-brand-gray">监控 ymq 平台数据的自动化拉取与清洗入库记录</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => triggerSync('full')}
            disabled={syncing}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-full shadow-md hover:shadow-lg hover:from-orange-400 hover:to-red-400 transition-all font-bold disabled:opacity-70 disabled:cursor-not-allowed"
          >
            <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
            全量同步
          </button>
          <button
            onClick={resetAndSync}
            disabled={syncing}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-orange-200 text-orange-600 rounded-full shadow-sm hover:shadow-md hover:bg-orange-50 transition-all font-bold disabled:opacity-70 disabled:cursor-not-allowed"
          >
            清空并重建
          </button>
          <button
            onClick={() => setAutoSync((v) => !v)}
            className={`flex items-center gap-2 px-4 py-2 rounded-full shadow-sm transition-all font-bold border ${
              autoSync
                ? 'bg-green-50 border-green-200 text-green-700 hover:bg-green-100'
                : 'bg-white border-orange-200 text-orange-600 hover:bg-orange-50'
            }`}
          >
            {autoSync ? '停止实时(10s)' : '实时同步(10s)'}
          </button>
          <button
            onClick={fetchSyncRuns}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-orange-200 text-orange-600 rounded-full shadow-sm hover:shadow-md hover:bg-orange-50 transition-all font-bold"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            刷新状态
          </button>
        </div>
      </div>

      {autoSync && (
        <div className="w-full mb-4 text-sm text-brand-gray font-medium">
          实时同步已开启，每 10 秒拉取一次（增量模式）。最近一次触发：{autoTickAt ? format(new Date(autoTickAt), 'HH:mm:ss') : '-'}
        </div>
      )}

      {errorMsg && (
        <div className="w-full mb-6 bg-red-50 border border-red-200 text-red-700 px-6 py-4 rounded-3xl text-sm font-medium">
          {errorMsg}
        </div>
      )}

      <div className="w-full bg-white/80 backdrop-blur-sm rounded-3xl shadow-sm border border-orange-50 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-orange-50/50 border-b border-orange-100 text-brand-brown">
                <th className="p-4 font-bold">同步时间</th>
                <th className="p-4 font-bold">数据源</th>
                <th className="p-4 font-bold">状态</th>
                <th className="p-4 font-bold">拉取条数</th>
                <th className="p-4 font-bold">成功入库</th>
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
                    <td className="p-4 font-extrabold text-orange-500">{run.upserted_count}</td>
                    <td className="p-4 text-sm text-brand-gray truncate max-w-xs" title={run.error_message || '-'}>
                      {run.error_message || '-'}
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
