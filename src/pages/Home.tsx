import React, { useRef, useState, useEffect } from 'react';
import { Search, Trophy, MapPin, Activity, Loader2, RefreshCw, Filter, ChevronDown, ChevronUp, X, Share2 } from 'lucide-react';
import { getFriendlySupabaseErrorMessage, retrySupabaseOperation, supabase } from '../lib/supabase';
import { format } from 'date-fns';
import { DATA_SOURCE_CONTACT_HINT } from '../lib/dataSourceHints';
import { buildSourceLabelByRaceId, defaultSources, fetchSourcesFromDb, resolveTournamentDisplayName } from '../lib/dataSources';
import {
  buildMatchDetailPath,
  getPreferredMatchDetailRef,
  getMatchCardClass,
  isPollingPreferred,
} from '../lib/matchReadModel';
import ShareModal from '../components/ShareModal';
import PressHint from '../components/PressHint';
import type { MatchShareData } from '../lib/shareCard';

type MatchRow = {
  id: string;
  detail_match_id: string | null;
  detail_match_ref: string | null;
  canonical_match_id: string | null;
  source_match_id: string | null;
  category: string;
  tournament_name: string;
  start_time: string | null;
  source_updated_at: string | null;
  match_started_at: string | null;
  match_ended_at: string | null;
  round_name: string | null;
  match_time_name: string | null;
  city: string | null;
  location: string | null;
  players_a: string[];
  players_b: string[];
  score_text: string | null;
  winner_side: 'A' | 'B' | 'UNKNOWN' | null;
  event_key: string | null;
  data_stage: string | null;
  match_status: string | null;
  lifecycle_status: string | null;
  snapshot_version: number | null;
  stage_label: string | null;
  stage_hint: string | null;
  is_realtime: boolean | null;
  is_fallback: boolean | null;
};

type SyncRunRow = {
  id: string;
  run_at: string;
  source: string;
  status: 'SUCCESS' | 'FAILED' | string;
  pulled_count: number;
  upserted_count: number;
  error_message: string | null;
};

const MAX_CACHE_SIZE = 100;

type SuggestionRpcRow = {
  suggestion: string;
  suggestion_type: string;
};

type OpenShareModalDetail = MatchShareData;

type OpenShareModalEvent = CustomEvent<OpenShareModalDetail>;

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const record = error as { message?: string; details?: string; hint?: string; error_description?: string };
    return String(record.message || record.details || record.hint || record.error_description || JSON.stringify(error));
  }
  return String(error || '');
}

function isMissingSearchRpcError(error: unknown) {
  const message = getErrorMessage(error);
  return /matchlife_search_matches/i.test(message) && /(schema cache|does not exist|Could not find the function)/i.test(message);
}

function createLRUCache<K, V>(maxSize: number) {
  const cache = new Map<K, V>();
  return {
    get(key: K): V | undefined {
      const value = cache.get(key);
      if (value !== undefined) {
        cache.delete(key);
        cache.set(key, value);
      }
      return value;
    },
    set(key: K, value: V) {
      if (cache.has(key)) {
        cache.delete(key);
      } else if (cache.size >= maxSize) {
        const firstKey = cache.keys().next().value;
        if (firstKey !== undefined) cache.delete(firstKey);
      }
      cache.set(key, value);
    },
    size: cache.size,
  };
}

export default function Home() {
  const [searchQuery, setSearchQuery] = useState('');
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [searched, setSearched] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncRunRow | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [recentQueries, setRecentQueries] = useState<string[]>([]);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const inFlightRef = useRef(false);
  const lastMatchesSignatureRef = useRef('');
  const searchCacheRef = useRef(createLRUCache<string, MatchRow[]>(MAX_CACHE_SIZE));

  const [filterExpanded, setFilterExpanded] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [tournamentFilter, setTournamentFilter] = useState('');
  const [sourceLabelByRaceId, setSourceLabelByRaceId] = useState<Record<string, string>>({});
  
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const debounceTimerRef = useRef<number | null>(null);

  const [shareData, setShareData] = useState<MatchShareData | null>(null);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);

  useEffect(() => {
    const handleOpenShare = (e: Event) => {
      const customEvent = e as OpenShareModalEvent;
      if (!customEvent.detail) return;
      setShareData(customEvent.detail);
      setIsShareModalOpen(true);
    };
    window.addEventListener('open-share-modal', handleOpenShare as EventListener);
    return () => window.removeEventListener('open-share-modal', handleOpenShare as EventListener);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadSourceLabels = async () => {
      try {
        const dbSources = await fetchSourcesFromDb();
        if (cancelled) return;
        setSourceLabelByRaceId(buildSourceLabelByRaceId(dbSources.length ? dbSources : defaultSources));
      } catch {
        if (cancelled) return;
        setSourceLabelByRaceId(buildSourceLabelByRaceId(defaultSources));
      }
    };

    void loadSourceLabels();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        window.clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const matchesSignature = (list: MatchRow[]) => {
    return list
      .map((match) => [
        match.id,
        match.tournament_name || '',
        match.detail_match_id || '',
        match.detail_match_ref || '',
        match.canonical_match_id || '',
        match.source_updated_at || '',
        match.match_started_at || '',
        match.match_ended_at || '',
        match.score_text || '',
        match.winner_side || '',
        match.data_stage || '',
        match.match_status || '',
        match.lifecycle_status || '',
        String(match.snapshot_version ?? ''),
        match.stage_label || '',
        match.stage_hint || '',
        String(match.is_fallback ?? ''),
      ].join('|'))
      .join('||');
  };

  const applyMatches = (list: MatchRow[]) => {
    const next = list.map((match) => ({
      ...match,
      tournament_name: resolveTournamentDisplayName(match.tournament_name, sourceLabelByRaceId),
    }));
    const signature = matchesSignature(next);
    if (signature === lastMatchesSignatureRef.current) return;
    lastMatchesSignatureRef.current = signature;
    setMatches(next);
  };

  useEffect(() => {
    if (!matches.length) return;
    const next = matches.map((match) => ({
      ...match,
      tournament_name: resolveTournamentDisplayName(match.tournament_name, sourceLabelByRaceId),
    }));
    const signature = matchesSignature(next);
    if (signature === lastMatchesSignatureRef.current) return;
    lastMatchesSignatureRef.current = signature;
    setMatches(next);
  }, [sourceLabelByRaceId, matches]);

  const fmtDate = (iso: string | null) => {
    if (!iso) return null;
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return null;
    return format(new Date(t), 'yyyy-MM-dd');
  };

  const fmtTime = (iso: string | null) => {
    if (!iso) return null;
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return null;
    return format(new Date(t), 'HH:mm:ss');
  };

  const ongoingMeta = (m: MatchRow) => {
    const dateBase = m.match_started_at || m.start_time || null;
    return {
      date: fmtDate(dateBase),
      startedAt: fmtTime(m.match_started_at),
      endedAt: fmtTime(m.match_ended_at),
    };
  };

  const getDetailMatchRef = (match: MatchRow) => getPreferredMatchDetailRef(match);

  const openMatchDetail = (match: MatchRow) => {
    const detailRef = getDetailMatchRef(match);
    if (!detailRef) return;
    window.location.href = buildMatchDetailPath(detailRef);
  };

  // 初次加载时，拉取最新的几条比赛数据与同步状态
  useEffect(() => {
    fetchLatestMatches();
    void fetchSyncStatus({ silent: true });
    try {
      const raw = localStorage.getItem('matchlife_recent_queries');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setRecentQueries(parsed.filter((v) => typeof v === 'string').slice(0, 3));
        }
      }
    } catch {
      setRecentQueries([]);
    }
  }, []);

  useEffect(() => {
    if (!searchQuery.trim()) {
      if (autoRefresh) setAutoRefresh(false);
      return;
    }
  }, [searchQuery]);

  const hasPollingCandidate = matches.some((match) => isPollingPreferred(match));

  useEffect(() => {
    if (!searchQuery.trim() || !hasPollingCandidate) return;
    const refreshIfVisible = () => {
      if (document.hidden) return;
      void handleSearch(undefined, searchQuery, { recordHistory: false, silent: true });
    };
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        void handleSearch(undefined, searchQuery, { recordHistory: false, silent: true });
      }
    };
    const timer = window.setInterval(refreshIfVisible, autoRefresh ? 10000 : 30000);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [autoRefresh, hasPollingCandidate, matches, searchQuery]);

  useEffect(() => {
    if (searchQuery.trim()) return;
    const refreshIfVisible = () => {
      if (document.hidden) return;
      void fetchLatestMatches({ silent: true });
    };
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        void fetchLatestMatches({ silent: true });
      }
    };
    const timer = window.setInterval(refreshIfVisible, 30000);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [searchQuery]);

  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.hidden) return;
      void fetchSyncStatus({ silent: true });
    };
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        void fetchSyncStatus({ silent: true });
      }
    };
    const timer = window.setInterval(refreshIfVisible, 60000);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const persistRecentQueries = (next: string[]) => {
    const trimmed = next.map((s) => s.trim()).filter(Boolean);
    const uniq: string[] = [];
    for (const item of trimmed) {
      if (!uniq.includes(item)) uniq.push(item);
      if (uniq.length >= 3) break;
    }
    setRecentQueries(uniq);
    localStorage.setItem('matchlife_recent_queries', JSON.stringify(uniq));
  };

  const canAutoRefresh = Boolean(searchQuery.trim());

  const buildSearchCacheKey = (keyword: string) =>
    [
      keyword.trim().toLowerCase(),
      dateFrom || '',
      dateTo || '',
      categoryFilter.trim().toLowerCase(),
      tournamentFilter.trim().toLowerCase(),
    ].join('::');

  const fetchSyncStatus = async (options?: { silent?: boolean }) => {
    const { data, error } = await supabase
      .from('sync_runs')
      .select('*')
      .order('run_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      if (!options?.silent && !syncStatus) {
        setErrorMsg(getFriendlySupabaseErrorMessage(error));
      }
      return;
    }
    setSyncStatus((data as SyncRunRow | null) ?? null);
  };

  const fetchLatestMatches = async (options?: { silent?: boolean }) => {
    if (options?.silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    try {
      const rpc = await retrySupabaseOperation(() =>
        supabase.rpc('matchlife_search_matches', {
          p_keyword: null,
          p_date_from: null,
          p_date_to: null,
          p_category_filter: null,
          p_tournament_filter: null,
          p_limit: 5,
        }),
      );

      if (!rpc.error) {
        applyMatches((rpc.data || []) as MatchRow[]);
      } else {
        if (!isMissingSearchRpcError(rpc.error)) {
          setErrorMsg(getFriendlySupabaseErrorMessage(rpc.error));
        }
      }
    } catch (error) {
      setErrorMsg(getFriendlySupabaseErrorMessage(error));
    } finally {
      if (options?.silent) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
    }
  };

  const handleSearch = async (
    e?: React.FormEvent,
    q?: string,
    options?: { recordHistory?: boolean; silent?: boolean }
  ) => {
    if (e) e.preventDefault();
    const keyword = (q ?? searchQuery).trim();
    setErrorMsg(null);
    if (!keyword) {
      setSearched(false);
      fetchLatestMatches(options);
      return;
    }

    if (options?.recordHistory !== false) {
      persistRecentQueries([keyword, ...recentQueries]);
    }
    const cacheKey = buildSearchCacheKey(keyword);
    const cached = searchCacheRef.current.get(cacheKey);
    if (cached?.length) {
      applyMatches(cached);
      setSearched(true);
      if (options?.silent) {
        setRefreshing(false);
        return;
      }
    }

    if (inFlightRef.current) return;
    inFlightRef.current = true;
    if (options?.silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
      setSearched(true);
    }
    try {
      const rpc = await retrySupabaseOperation(() =>
        supabase.rpc('matchlife_search_matches', {
          p_keyword: keyword,
          p_date_from: dateFrom || null,
          p_date_to: dateTo || null,
          p_category_filter: categoryFilter || null,
          p_tournament_filter: tournamentFilter || null,
          p_limit: 20,
        }),
      );

      if (!rpc.error) {
        const rows = (rpc.data || []) as MatchRow[];
        searchCacheRef.current.set(cacheKey, rows);
        applyMatches(rows);
      } else {
        if (!isMissingSearchRpcError(rpc.error)) {
          setErrorMsg(getFriendlySupabaseErrorMessage(rpc.error));
        }
      }
    } catch (error) {
      setErrorMsg(getFriendlySupabaseErrorMessage(error));
    } finally {
      inFlightRef.current = false;
      if (options?.silent) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
    }
  };

  const clearFilters = () => {
    setDateFrom('');
    setDateTo('');
    setCategoryFilter('');
    setTournamentFilter('');
  };

  const hasActiveFilters = Boolean(dateFrom || dateTo || categoryFilter || tournamentFilter);

  const fetchSuggestions = async (q: string) => {
    if (!q.trim() || q.trim().length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    const keyword = q.trim();
    const rpc = await supabase.rpc('matchlife_search_suggestions', {
      p_keyword: keyword,
      p_limit: 8,
    });

    if (!rpc.error) {
      const results = Array.from(
        new Set(
          ((rpc.data || []) as SuggestionRpcRow[])
            .map((item) => String(item.suggestion || '').trim())
            .filter(Boolean),
        ),
      ).slice(0, 8);
      setSuggestions(results);
      setShowSuggestions(results.length > 0);
    }
  };

  const handleSearchInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchQuery(val);
    if (debounceTimerRef.current) window.clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = window.setTimeout(() => {
      void fetchSuggestions(val);
    }, 300);
  };

  const handleSuggestionClick = (suggestion: string) => {
    setSearchQuery(suggestion);
    setShowSuggestions(false);
    setSuggestions([]);
    handleSearch(undefined, suggestion);
  };

  return (
    <div className="flex flex-col items-center pt-10 pb-20">

      <div className="w-full max-w-3xl text-center space-y-8 mt-10">
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/60 border border-orange-200 text-orange-600 text-sm font-bold shadow-sm backdrop-blur-sm mb-4">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-orange-500"></span>
          </span>
          热门赛事持续更新中
        </div>

        {syncStatus && (
          <div className="text-sm text-brand-gray font-medium">
            最近更新：{format(new Date(syncStatus.run_at), 'yyyy-MM-dd HH:mm')} · {syncStatus.status === 'SUCCESS' ? `已更新 ${syncStatus.upserted_count} 场` : `更新失败（${syncStatus.error_message || '未知错误'}）`}
          </div>
        )}
        
        <h1 className="text-3xl sm:text-4xl md:text-6xl font-extrabold text-brand-brown tracking-tight">
          <span className="block mb-2">探索你的</span>
          <span className="bg-gradient-to-br from-orange-500 to-red-600 bg-clip-text text-transparent">
            赛事数据轨迹
          </span>
        </h1>
        
        <p className="max-w-2xl mx-auto text-base font-medium text-brand-gray sm:text-lg">
          更快查看比赛结果、比分变化和赛事进展。
          <br />
          支持检索比赛结果、赛事排名与历史记录。
        </p>

        <form onSubmit={handleSearch} className="relative mt-8 group">
          <div className="absolute inset-0 bg-gradient-to-r from-orange-400 to-red-500 rounded-full blur opacity-20 group-hover:opacity-40 transition duration-500"></div>
          <div className="relative bg-white rounded-full shadow-lg border border-orange-100 p-2 flex items-center">
            <div className="pl-4 text-orange-400">
              <Search className="w-6 h-6" />
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={handleSearchInputChange}
              onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
              placeholder="搜索赛事名称、运动员名称、赛事日期..."
              className="w-full border-none bg-transparent px-4 py-3 text-base font-medium text-brand-brown outline-none placeholder-orange-300 focus:ring-0 sm:text-lg"
            />
            <PressHint
              message={
                canAutoRefresh
                  ? autoRefresh
                    ? '正在每 10 秒自动刷新当前检索结果，点击可关闭自动刷新。'
                    : hasPollingCandidate
                      ? '当前有比赛结果仍在变化，页面默认每 30 秒刷新；开启后会加速到每 10 秒。'
                      : '开启后会每 10 秒自动刷新当前检索结果，适合盯比分时使用。'
                  : '请先输入检索内容，再开启自动刷新。'
              }
              className="mr-2"
            >
              <button
                type="button"
                aria-label={
                  canAutoRefresh
                    ? `${autoRefresh ? '关闭' : '开启'}自动刷新比分`
                    : '请输入检索内容后开启自动刷新'
                }
                aria-pressed={autoRefresh}
                title={
                  canAutoRefresh
                    ? `${autoRefresh ? '自动刷新进行中，点击关闭' : '点击开启自动刷新比分'}`
                    : '请输入检索内容后开启自动刷新'
                }
                disabled={!canAutoRefresh}
                onClick={() => setAutoRefresh((v) => !v)}
                className={`relative inline-flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full border transition-all duration-300 ${
                  canAutoRefresh
                    ? autoRefresh
                      ? 'border-orange-200 bg-gradient-to-br from-orange-500 to-red-500 text-white shadow-lg shadow-orange-200/70'
                      : 'border-orange-200 bg-white text-orange-500 shadow-sm hover:-translate-y-0.5 hover:border-orange-300 hover:bg-orange-50 hover:shadow-md'
                    : 'cursor-not-allowed border-gray-200 bg-gray-50 text-gray-300 shadow-none'
                }`}
              >
                <span
                  className={`pointer-events-none absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full ${
                    autoRefresh ? 'bg-emerald-300 shadow-[0_0_0_3px_rgba(255,255,255,0.18)]' : 'bg-gray-200'
                  }`}
                />
                <RefreshCw
                  className={`h-5 w-5 transition-transform duration-300 ${
                    autoRefresh ? 'animate-spin' : 'rotate-0'
                  } ${refreshing && autoRefresh ? 'scale-110' : ''}`}
                />
                <span className="sr-only">
                  {autoRefresh ? '自动刷新已开启' : '自动刷新已关闭'}
                </span>
              </button>
            </PressHint>
            <button 
              type="submit"
              title="提交检索"
              aria-label="提交检索"
              disabled={loading}
              className="bg-gradient-to-r from-orange-500 to-red-500 text-white px-8 py-3 rounded-full font-bold shadow-md hover:shadow-lg hover:from-orange-400 hover:to-red-400 transition-all active:scale-95 disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center min-w-[120px]"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : '检索'}
            </button>
          </div>
          
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-2xl shadow-lg border border-orange-100 overflow-hidden z-50">
              {suggestions.map((suggestion, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleSuggestionClick(suggestion)}
                  className="w-full px-6 py-3 text-left hover:bg-orange-50 transition-colors border-b border-orange-50 last:border-b-0 text-brand-brown font-medium"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          )}
        </form>

        <div className="w-full max-w-3xl mt-6">
          <button
            type="button"
            onClick={() => setFilterExpanded(!filterExpanded)}
            className="w-full flex items-center justify-between px-6 py-3 bg-white/80 backdrop-blur-sm rounded-2xl border border-orange-100 hover:border-orange-300 transition-all shadow-sm"
          >
            <div className="flex items-center gap-2">
              <Filter className="w-5 h-5 text-orange-500" />
              <span className="font-bold text-brand-brown">高级筛选</span>
              {hasActiveFilters && (
                <span className="px-2 py-0.5 bg-orange-500 text-white text-xs rounded-full font-bold">
                  {[dateFrom, dateTo, categoryFilter, tournamentFilter].filter(Boolean).length}
                </span>
              )}
            </div>
            {filterExpanded ? (
              <ChevronUp className="w-5 h-5 text-brand-gray" />
            ) : (
              <ChevronDown className="w-5 h-5 text-brand-gray" />
            )}
          </button>

          {filterExpanded && (
            <div className="mt-4 p-6 bg-white/80 backdrop-blur-sm rounded-2xl border border-orange-100 shadow-sm space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-brand-brown mb-2">
                    开始日期
                  </label>
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="w-full px-4 py-2 rounded-xl border border-orange-100 bg-white text-brand-brown outline-none focus:border-orange-300"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-brand-brown mb-2">
                    结束日期
                  </label>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="w-full px-4 py-2 rounded-xl border border-orange-100 bg-white text-brand-brown outline-none focus:border-orange-300"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-brand-brown mb-2">
                  U组别筛选
                </label>
                <input
                  type="text"
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  placeholder="例如：U12、U14"
                  className="w-full px-4 py-2 rounded-xl border border-orange-100 bg-white text-brand-brown outline-none focus:border-orange-300 placeholder-orange-300"
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-brand-brown mb-2">
                  赛事名称筛选
                </label>
                <input
                  type="text"
                  value={tournamentFilter}
                  onChange={(e) => setTournamentFilter(e.target.value)}
                  placeholder="例如：北方赛区"
                  className="w-full px-4 py-2 rounded-xl border border-orange-100 bg-white text-brand-brown outline-none focus:border-orange-300 placeholder-orange-300"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    handleSearch();
                  }}
                  className="flex-1 px-6 py-2 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl font-bold shadow-md hover:shadow-lg hover:from-orange-400 hover:to-red-400 transition-all"
                >
                  应用筛选
                </button>
                {hasActiveFilters && (
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="px-6 py-2 bg-white border border-orange-200 text-orange-600 rounded-xl font-bold hover:bg-orange-50 transition-all flex items-center gap-2"
                  >
                    <X className="w-4 h-4" />
                    清除
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap justify-center gap-3 mt-6">
          <button onClick={() => { const q = ''; setSearchQuery(q); handleSearch(undefined, q); }} className="px-4 py-2 rounded-2xl bg-white/80 text-brand-gray text-sm border border-orange-50 hover:border-orange-300 hover:text-orange-600 cursor-pointer transition-colors shadow-sm backdrop-blur-sm">
            📅 近期比赛
          </button>
          {recentQueries.map((q) => (
            <div key={q} className="inline-flex items-center rounded-2xl bg-white/80 border border-orange-50 shadow-sm backdrop-blur-sm overflow-hidden">
              <button
                onClick={() => {
                  setSearchQuery(q);
                  handleSearch(undefined, q);
                }}
                className="px-4 py-2 text-brand-gray text-sm hover:text-orange-600 transition-colors"
              >
                {q}
              </button>
              <button
                onClick={() => persistRecentQueries(recentQueries.filter((x) => x !== q))}
                className="px-3 py-2 text-brand-gray/70 hover:text-red-500 transition-colors"
                aria-label={`删除检索历史 ${q}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </div>

      {errorMsg && (
        <div className="w-full max-w-3xl mt-10 bg-red-50 border border-red-200 text-red-700 px-6 py-4 rounded-3xl text-sm font-medium">
          {errorMsg}
        </div>
      )}

      {searched && (
        <div className="w-full max-w-5xl mt-16 flex flex-col gap-4">
          <h2 className="text-2xl font-bold text-brand-brown mb-4">检索结果</h2>
          
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
            </div>
          ) : matches.length > 0 ? (
            matches.map((match) => (
              <div
                key={match.id}
                className={`rounded-3xl p-6 shadow-sm border flex flex-col md:flex-row md:items-center justify-between gap-4 hover:shadow-md transition-shadow ${getMatchCardClass(match)}`}
              >
                <div
                  className={`flex-1 ${getDetailMatchRef(match) ? 'cursor-pointer' : 'cursor-default'}`}
                  onClick={() => openMatchDetail(match)}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="px-3 py-1 bg-orange-100 text-orange-700 rounded-full text-xs font-bold">{match.category}</span>
                    {match.round_name && (
                      <span className="px-3 py-1 bg-amber-100 text-amber-800 rounded-full text-xs font-extrabold">{match.round_name}</span>
                    )}
                    {match.start_time ? (
                      <span className="px-3 py-1 rounded-full bg-white text-brand-gray border border-orange-100 text-xs font-bold">
                        比赛日期 {format(new Date(match.start_time), 'yyyy-MM-dd')}
                      </span>
                    ) : null}
                  </div>
                  <h3 className="text-lg font-bold text-brand-brown">{match.tournament_name}</h3>
                  {match.winner_side === 'UNKNOWN' && (
                    <div className="flex flex-wrap items-center gap-3 text-xs text-sky-700/80 mt-2 font-medium">
                      {(() => {
                        const m = ongoingMeta(match);
                        return (
                          <>
                            {m.date ? <span>日期 {m.date}</span> : null}
                            {m.startedAt ? <span>开始 {m.startedAt}</span> : null}
                            {m.endedAt ? <span>结束 {m.endedAt}</span> : null}
                          </>
                        );
                      })()}
                    </div>
                  )}
                  <div className="flex items-center gap-1 text-sm text-brand-gray mt-1">
                    <MapPin className="w-4 h-4" />
                    <span>{match.city || match.location || '未知场地'}</span>
                  </div>
                </div>

                <div className="flex flex-col items-end gap-3">
                  <div
                    className={`flex items-center justify-between md:justify-end gap-2 md:gap-6 bg-orange-50/50 px-4 md:px-6 py-4 rounded-2xl w-full md:w-auto ${
                      getDetailMatchRef(match) ? 'cursor-pointer' : 'cursor-default'
                    }`}
                    onClick={() => openMatchDetail(match)}
                  >
                    <div className="text-right flex-1 md:flex-none">
                      <div className={`font-bold ${match.winner_side === 'A' ? 'text-orange-600 text-lg' : 'text-brand-brown'}`}>
                        {match.players_a?.join(' / ')}
                      </div>
                      {match.winner_side === 'A' && <span className="text-xs text-orange-500 font-medium">Winner</span>}
                    </div>
                    
                    <div className="text-xl md:text-2xl font-extrabold text-brand-brown tracking-wider bg-white px-3 md:px-4 py-1 rounded-xl shadow-sm border border-orange-100 flex-shrink-0">
                      {match.score_text || (match.is_realtime ? '比赛进行中' : '-')}
                    </div>
                    
                    <div className="text-left flex-1 md:flex-none">
                      <div className={`font-bold ${match.winner_side === 'B' ? 'text-orange-600 text-lg' : 'text-brand-brown'}`}>
                        {match.players_b?.join(' / ')}
                      </div>
                      {match.winner_side === 'B' && <span className="text-xs text-orange-500 font-medium">Winner</span>}
                    </div>
                  </div>
                  
                  <button
                    type="button"
                    disabled={!getDetailMatchRef(match)}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const detailRef = getDetailMatchRef(match);
                      if (!detailRef) return;
                      window.dispatchEvent(
                        new CustomEvent<OpenShareModalDetail>('open-share-modal', {
                          detail: {
                            type: 'match',
                            tournamentName: match.tournament_name,
                            playerA: match.players_a?.join(' / ') || '',
                            playerB: match.players_b?.join(' / ') || '',
                            score: match.score_text || '',
                            date: match.start_time ? format(new Date(match.start_time), 'yyyy-MM-dd') : '',
                            eventKey: match.category,
                            winnerSide: match.winner_side || 'UNKNOWN',
                            qrCodeUrl: `${window.location.origin}${buildMatchDetailPath(detailRef)}`,
                          },
                        }),
                      );
                    }}
                    className="flex items-center gap-1.5 px-4 py-2 bg-orange-100 hover:bg-orange-200 text-orange-700 rounded-xl text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
                  >
                    <Share2 className="w-3.5 h-3.5" />
                    {getDetailMatchRef(match) ? '分享比赛' : '详情待就绪'}
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="text-center py-12 bg-white/50 rounded-3xl border border-orange-50">
              <p className="text-brand-gray text-lg">没有找到相关比赛记录</p>
              <p className="mt-2 text-sm text-brand-gray">{DATA_SOURCE_CONTACT_HINT}</p>
            </div>
          )}
        </div>
      )}

      {!searched && (
        <div className="mt-24 w-full max-w-5xl rounded-[32px] border border-orange-100 bg-white/80 p-6 shadow-sm backdrop-blur-sm sm:p-8">
          <div className="mb-6 text-center">
            <h2 className="text-2xl font-extrabold text-brand-brown">更快找到你关心的比赛</h2>
            <p className="mt-2 text-sm text-brand-gray sm:text-base">
              支持按赛事、选手和日期检索结果，优先把最有用的信息直接展示给你。
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="rounded-3xl border border-orange-100 bg-gradient-to-br from-orange-50/80 to-white p-6 shadow-sm">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-100 text-orange-500">
                <Trophy className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-brand-brown">快速查看结果</h3>
              <p className="mt-2 text-sm text-brand-gray">
                赛事名称、参赛选手、比分和场地信息集中展示，减少来回翻找。
              </p>
            </div>
            <div className="rounded-3xl border border-orange-100 bg-gradient-to-br from-amber-50/80 to-white p-6 shadow-sm">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-500">
                <Activity className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-brand-brown">及时了解进展</h3>
              <p className="mt-2 text-sm text-brand-gray">
                比赛进行中时优先展示关键时间和比分变化，方便你快速判断当前进度。
              </p>
            </div>
          </div>
      </div>
      )}

      {shareData && (
        <ShareModal
          isOpen={isShareModalOpen}
          onClose={() => setIsShareModalOpen(false)}
          data={shareData}
          shareUrl={shareData.qrCodeUrl}
          shareTitle={`比赛战况：${shareData.tournamentName}`}
          shareDesc={`${shareData.playerA} vs ${shareData.playerB}，比分 ${shareData.score}`}
        />
      )}
    </div>
  );
}
