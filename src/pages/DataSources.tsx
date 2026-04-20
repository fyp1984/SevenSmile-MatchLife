import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Database, FileJson, Link2, Plus, ShieldCheck, Trash2, Upload } from 'lucide-react';
import {
  defaultSources,
  deleteSourceFromDb,
  fetchSourcesFromDb,
  readSourcesFromLocal,
  saveSourcesToLocal,
  type SourceItem,
  upsertSourcesToDb,
} from '../lib/dataSources';

function normalizeImportedSources(payload: unknown): SourceItem[] {
  const list = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object' && Array.isArray((payload as { sources?: unknown[] }).sources)
      ? (payload as { sources: unknown[] }).sources
      : [];

  return list
    .map((item, index) => {
      const row = item as Partial<SourceItem> & { format?: string; url?: string; name?: string };
      if (!row?.name || !row?.url) return null;
      const format = row.format === 'ymq-json' ? 'ymq-json' : 'matchlife-source-json';
      return {
        id: row.id || `imported-${Date.now()}-${index}`,
        name: row.name.trim(),
        type: row.type === 'html' || row.type === 'file' ? row.type : 'api',
        url: row.url.trim(),
        format,
        enabled: row.enabled !== false,
        updatedAt: new Date().toISOString(),
        origin: 'imported',
      } satisfies SourceItem;
    })
    .filter(Boolean) as SourceItem[];
}

export default function DataSources() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [sources, setSources] = useState<SourceItem[]>(() => readSourcesFromLocal());
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [type, setType] = useState<SourceItem['type']>('api');
  const [format, setFormat] = useState<SourceItem['format']>('matchlife-source-json');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const dbItems = await fetchSourcesFromDb();
        if (cancelled) return;
        if (dbItems.length === 0) {
          await upsertSourcesToDb(defaultSources);
          if (cancelled) return;
          setSources(defaultSources);
          saveSourcesToLocal(defaultSources);
        } else {
          setSources(dbItems);
          saveSourcesToLocal(dbItems);
        }
      } catch (e) {
        if (!cancelled) {
          setError(`数据库读取失败，已使用本地草稿：${e instanceof Error ? e.message : String(e)}`);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const persistSources = async (next: SourceItem[]) => {
    setSources(next);
    saveSourcesToLocal(next);
    await upsertSourcesToDb(next);
  };

  const activeCount = useMemo(() => sources.filter((item) => item.enabled).length, [sources]);

  const addSource = () => {
    setError(null);
    setMessage(null);
    if (!name.trim() || !url.trim()) {
      setError('请先填写数据源名称与地址。');
      return;
    }

    const nextItem: SourceItem = {
      id: `source-${Date.now()}`,
      name: name.trim(),
      url: url.trim(),
      type,
      format,
      enabled: true,
      updatedAt: new Date().toISOString(),
      origin: 'manual',
    };

    void persistSources([nextItem, ...sources]).catch((e) =>
      setError(`保存到数据库失败：${e instanceof Error ? e.message : String(e)}`),
    );
    setName('');
    setUrl('');
    setMessage('数据源已保存并持久化入库。');
  };

  const toggleSource = (id: string) => {
    const next = sources.map((item) =>
      item.id === id
        ? { ...item, enabled: !item.enabled, updatedAt: new Date().toISOString() }
        : item,
    );
    void persistSources(next).catch((e) =>
      setError(`更新数据源状态失败：${e instanceof Error ? e.message : String(e)}`),
    );
  };

  const removeSource = (id: string) => {
    const next = sources.filter((item) => item.id !== id);
    setSources(next);
    saveSourcesToLocal(next);
    void deleteSourceFromDb(id).catch((e) =>
      setError(`删除数据源失败：${e instanceof Error ? e.message : String(e)}`),
    );
  };

  const importFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    setMessage(null);

    try {
      const text = await file.text();
      const imported = normalizeImportedSources(JSON.parse(text));
      if (imported.length === 0) {
        throw new Error('未识别到可导入的数据源，请使用已适配的 JSON 配置格式。');
      }

      const merged = [...imported, ...sources].filter(
        (item, index, arr) =>
          arr.findIndex((target) => target.name === item.name && target.url === item.url) === index,
      );

      await upsertSourcesToDb(merged);
      setSources(merged);
      saveSourcesToLocal(merged);
      setMessage(`已导入 ${imported.length} 个数据源配置。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '导入失败，请检查文件格式。');
    } finally {
      event.target.value = '';
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 pb-20 pt-4 sm:pt-6">
      <div className="rounded-[28px] border border-orange-100 bg-white/80 p-5 shadow-sm backdrop-blur-sm sm:p-7">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-2xl font-extrabold text-brand-brown sm:text-3xl">数据源维护</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-brand-gray sm:text-base">
              维护已接入的数据源地址，并支持导入当前已适配的 JSON 配置文件，便于后续扩展更多赛事平台与球类来源。
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:flex sm:items-center">
            <div className="rounded-2xl border border-orange-100 bg-orange-50/70 px-4 py-3 text-center">
              <div className="text-xs font-bold uppercase tracking-wide text-orange-500">已启用</div>
              <div className="mt-1 text-2xl font-extrabold text-brand-brown">{activeCount}</div>
            </div>
            <div className="rounded-2xl border border-orange-100 bg-white px-4 py-3 text-center">
              <div className="text-xs font-bold uppercase tracking-wide text-brand-gray">总配置</div>
              <div className="mt-1 text-2xl font-extrabold text-brand-brown">{sources.length}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-[28px] border border-orange-100 bg-white/80 p-5 shadow-sm backdrop-blur-sm sm:p-7">
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500 to-red-500 text-white shadow-md">
              <Plus className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-extrabold text-brand-brown sm:text-xl">手动新增地址</h2>
              <p className="text-sm text-brand-gray">适用于已确认可接入的平台地址或已整理的数据接口。</p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-sm font-bold text-brand-brown">数据源名称</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="如：北方赛区公开页"
                className="w-full rounded-2xl border border-orange-100 bg-white px-4 py-3 text-sm text-brand-brown outline-none transition focus:border-orange-300"
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-bold text-brand-brown">接入类型</span>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as SourceItem['type'])}
                className="w-full rounded-2xl border border-orange-100 bg-white px-4 py-3 text-sm text-brand-brown outline-none transition focus:border-orange-300"
              >
                <option value="api">接口地址</option>
                <option value="html">页面地址</option>
                <option value="file">文件导入</option>
              </select>
            </label>
          </div>

          <label className="mt-4 block">
            <span className="mb-2 block text-sm font-bold text-brand-brown">数据源地址</span>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/data-feed"
              className="w-full rounded-2xl border border-orange-100 bg-white px-4 py-3 text-sm text-brand-brown outline-none transition focus:border-orange-300"
            />
          </label>

          <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end">
            <label className="block flex-1">
              <span className="mb-2 block text-sm font-bold text-brand-brown">适配格式</span>
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value as SourceItem['format'])}
                className="w-full rounded-2xl border border-orange-100 bg-white px-4 py-3 text-sm text-brand-brown outline-none transition focus:border-orange-300"
              >
                <option value="matchlife-source-json">MatchLife Source JSON</option>
                <option value="ymq-json">YMQ JSON</option>
              </select>
            </label>
            <button
              type="button"
              onClick={addSource}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-gradient-to-r from-orange-500 to-red-500 px-5 text-sm font-bold text-white shadow-md transition hover:from-orange-400 hover:to-red-400 hover:shadow-lg"
            >
              <Plus className="h-4 w-4" />
              保存数据源
            </button>
          </div>

          {message && <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div>}
          {error && <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        </section>

        <section className="rounded-[28px] border border-orange-100 bg-white/80 p-5 shadow-sm backdrop-blur-sm sm:p-7">
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-100 text-orange-500">
              <Upload className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-extrabold text-brand-brown sm:text-xl">上传导入</h2>
              <p className="text-sm text-brand-gray">当前仅支持已适配的 JSON 配置文件导入。</p>
            </div>
          </div>

          <div className="rounded-[28px] border border-dashed border-orange-200 bg-orange-50/40 px-6 py-10 text-center transition hover:border-orange-300 hover:bg-orange-50">
            <input ref={fileInputRef} type="file" accept=".json,application/json" className="hidden" onChange={importFile} />
            <FileJson className="mb-4 h-8 w-8 text-orange-500" />
            <div className="text-sm font-bold text-brand-brown">导入已适配的 JSON 配置</div>
            <div className="mt-2 text-xs leading-6 text-brand-gray">
              支持数组或 <code className="rounded bg-white px-1.5 py-0.5">sources</code> 字段，单条记录需包含名称与地址。
            </div>
            <button
              type="button"
              title="上传已适配的数据源 JSON 配置"
              onClick={() => fileInputRef.current?.click()}
              className="mt-5 inline-flex h-11 items-center justify-center gap-2 rounded-full border border-orange-200 bg-white px-5 text-sm font-bold text-orange-600 transition hover:bg-orange-50 hover:shadow-sm"
            >
              <Upload className="h-4 w-4" />
              选择配置文件
            </button>
          </div>

          <div className="mt-5 rounded-3xl border border-orange-100 bg-white p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-bold text-brand-brown">
              <ShieldCheck className="h-4 w-4 text-orange-500" />
              当前已适配格式
            </div>
            <div className="flex flex-wrap gap-2">
              {['ymq-json', 'matchlife-source-json'].map((tag) => (
                <span key={tag} className="rounded-full border border-orange-100 bg-orange-50 px-3 py-1 text-xs font-bold text-orange-700">
                  {tag}
                </span>
              ))}
            </div>
          </div>
        </section>
      </div>

      <section className="rounded-[28px] border border-orange-100 bg-white/80 p-5 shadow-sm backdrop-blur-sm sm:p-7">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-100 text-orange-500">
            <Database className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-extrabold text-brand-brown sm:text-xl">已维护数据源</h2>
            <p className="text-sm text-brand-gray">当前列表已持久化入库，支持跨设备读取与后续同步策略联动。</p>
          </div>
        </div>

        <div className="grid gap-4">
          {loading && (
            <div className="rounded-2xl border border-orange-100 bg-orange-50/50 px-4 py-3 text-sm text-orange-700">
              正在加载数据库中的数据源配置...
            </div>
          )}
          {sources.map((item) => (
            <div key={item.id} className="flex flex-col gap-4 rounded-[24px] border border-orange-100 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-base font-extrabold text-brand-brown">{item.name}</span>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${item.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                    {item.enabled ? '启用中' : '已停用'}
                  </span>
                  <span className="rounded-full bg-orange-50 px-2.5 py-1 text-xs font-bold text-orange-700">{item.format}</span>
                </div>
                <div className="mt-2 flex items-start gap-2 text-sm text-brand-gray">
                  <Link2 className="h-4 w-4 flex-shrink-0 text-orange-400" />
                  <span className="break-all whitespace-normal leading-5">{item.url}</span>
                </div>
                <div className="mt-2 text-xs text-brand-gray">
                  来源：{item.origin === 'manual' ? '手动维护' : '文件导入'} · 最近更新：{new Date(item.updatedAt).toLocaleString()}
                </div>
              </div>
              <div className="flex items-center gap-2 self-end sm:self-auto">
                <button
                  type="button"
                  title={item.enabled ? '停用数据源' : '启用数据源'}
                  onClick={() => toggleSource(item.id)}
                  className={`inline-flex h-11 w-11 items-center justify-center rounded-full border transition ${item.enabled ? 'border-emerald-200 bg-emerald-50 text-emerald-600 hover:bg-emerald-100' : 'border-orange-200 bg-white text-orange-500 hover:bg-orange-50'}`}
                >
                  <ShieldCheck className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  title="移除数据源"
                  onClick={() => removeSource(item.id)}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-red-100 bg-white text-red-500 transition hover:bg-red-50"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
