import React, { useRef, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Search, Trophy, Calendar, MapPin, Activity, Loader2, RefreshCw, Filter, ChevronDown, ChevronUp, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { format } from 'date-fns';

type MatchRow = {
  id: string;
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

const MATCH_SELECT =
  'id, category, tournament_name, start_time, source_updated_at, match_started_at, match_ended_at, match_time_name, city, location, players_a, players_b, score_text, winner_side, event_key, round_name';

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
  const refreshTimerRef = useRef<number | null>(null);
  const lastMatchesSignatureRef = useRef('');
  const searchCacheRef = useRef<Map<string, MatchRow[]>>(new Map());
  
  const [filterExpanded, setFilterExpanded] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [tournamentFilter, setTournamentFilter] = useState('');
  
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const debounceTimerRef = useRef<number | null>(null);

  const matchTs = (m: MatchRow) => {
    const t1 = m.start_time ? Date.parse(m.start_time) : NaN;
    if (!Number.isNaN(t1)) return t1;
    const t2 = m.source_updated_at ? Date.parse(m.source_updated_at) : NaN;
    if (!Number.isNaN(t2)) return t2;
    return 0;
  };

  const sortMatches = (list: MatchRow[]) => {
    return [...list].sort((a, b) => matchTs(b) - matchTs(a));
  };

  const matchesSignature = (list: MatchRow[]) => {
    return list
      .map((match) => [
        match.id,
        match.source_updated_at || '',
        match.match_started_at || '',
        match.match_ended_at || '',
        match.score_text || '',
        match.winner_side || '',
      ].join('|'))
      .join('||');
  };

  const applyMatches = (list: MatchRow[]) => {
    const next = sortMatches(list);
    const signature = matchesSignature(next);
    if (signature === lastMatchesSignatureRef.current) return;
    lastMatchesSignatureRef.current = signature;
    setMatches(next);
  };

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

  // 初次加载时，拉取最新的几条比赛数据与同步状态
  useEffect(() => {
    fetchLatestMatches();
    fetchSyncStatus();
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

  useEffect(() => {
    if (!autoRefresh) return;
    if (!searchQuery.trim()) return;

    const fallbackTimer: number = window.setInterval(() => {
      if (document.hidden) return;
      handleSearch(undefined, searchQuery, { recordHistory: false, silent: true });
    }, 5000);

    const channel = supabase
      .channel(`ml_home_matches_${Date.now()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'matches' },
        () => {
          if (document.hidden) return;
          if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current);
          refreshTimerRef.current = window.setTimeout(() => {
            handleSearch(undefined, searchQuery, { recordHistory: false, silent: true });
          }, 300);
        }
      )
      .subscribe();

    return () => {
      if (refreshTimerRef.current) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      window.clearInterval(fallbackTimer);
      supabase.removeChannel(channel);
    };
  }, [autoRefresh, searchQuery]);

  const lastSyncFetchAtRef = useRef<number>(0);
  useEffect(() => {
    const channel = supabase
      .channel(`ml_home_sync_${Date.now()}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'sync_runs' },
        () => {
          const now = Date.now();
          if (now - lastSyncFetchAtRef.current < 500) return;
          lastSyncFetchAtRef.current = now;
          fetchSyncStatus();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
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

  const fetchSyncStatus = async () => {
    const { data, error } = await supabase
      .from('sync_runs')
      .select('*')
      .order('run_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      setErrorMsg(error.message);
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
    const request = supabase
      .from('matches')
      .select(MATCH_SELECT)
      .order('source_updated_at', { ascending: false, nullsFirst: false })
      .limit(5);
    const { data, error } = await Promise.race([
      request,
      new Promise<{ data: null; error: Error }>((resolve) => {
        window.setTimeout(() => resolve({ data: null, error: new Error('查询超时，请稍后重试。') }), 30_000);
      }),
    ]);

    if (error) setErrorMsg(error.message);
    if (data) applyMatches(data as MatchRow[]);
    if (options?.silent) {
      setRefreshing(false);
    } else {
      setLoading(false);
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
    const cacheKey = keyword.toLowerCase();
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
      const escaped = keyword.replace(/[%_,]/g, (m) => `\\${m}`);
      let primaryRequest = supabase
        .from('matches')
        .select(MATCH_SELECT)
        .or(
          [
            `tournament_name.ilike.%${escaped}%`,
            `players_text.ilike.%${escaped}%`,
            `event_key.ilike.%${escaped}%`,
          ].join(',')
        );
      
      if (dateFrom) {
        primaryRequest = primaryRequest.gte('start_time', dateFrom);
      }
      if (dateTo) {
        primaryRequest = primaryRequest.lte('start_time', dateTo);
      }
      if (categoryFilter) {
        primaryRequest = primaryRequest.ilike('category', `%${categoryFilter}%`);
      }
      if (tournamentFilter) {
        primaryRequest = primaryRequest.ilike('tournament_name', `%${tournamentFilter}%`);
      }
      
      primaryRequest = primaryRequest.order('source_updated_at', { ascending: false, nullsFirst: false }).limit(20);
      
      const primary = await Promise.race([
        primaryRequest,
        new Promise<{ data: null; error: Error }>((resolve) => {
          window.setTimeout(() => resolve({ data: null, error: new Error('检索超时，请缩短关键词后重试。') }), 5_000);
        }),
      ]);

      if (primary.error) {
        setErrorMsg(primary.error.message);
      } else if (primary.data) {
        const primaryRows = primary.data as MatchRow[];
        if (primaryRows.length >= 8) {
          applyMatches(primaryRows);
          searchCacheRef.current.set(cacheKey, primaryRows);
          return;
        }

        let secondaryRequest = supabase
          .from('matches')
          .select(MATCH_SELECT)
          .or(
            [
              `round_name.ilike.%${escaped}%`,
              `match_time_name.ilike.%${escaped}%`,
              `category.ilike.%${escaped}%`,
              `city.ilike.%${escaped}%`,
              `location.ilike.%${escaped}%`,
            ].join(',')
          );
        
        if (dateFrom) {
          secondaryRequest = secondaryRequest.gte('start_time', dateFrom);
        }
        if (dateTo) {
          secondaryRequest = secondaryRequest.lte('start_time', dateTo);
        }
        if (categoryFilter) {
          secondaryRequest = secondaryRequest.ilike('category', `%${categoryFilter}%`);
        }
        if (tournamentFilter) {
          secondaryRequest = secondaryRequest.ilike('tournament_name', `%${tournamentFilter}%`);
        }
        
        secondaryRequest = secondaryRequest.order('source_updated_at', { ascending: false, nullsFirst: false }).limit(20);
        
        const secondary = await Promise.race([
          secondaryRequest,
          new Promise<{ data: null; error: Error }>((resolve) => {
            window.setTimeout(() => resolve({ data: null, error: new Error('检索超时，请稍后重试。') }), 6_000);
          }),
        ]);
        if (secondary.error) {
          setErrorMsg(secondary.error.message);
          applyMatches(primaryRows);
          searchCacheRef.current.set(cacheKey, primaryRows);
          return;
        }

        const secondaryRows = (secondary.data || []) as MatchRow[];
        const merged = [...primaryRows];
        const seen = new Set(primaryRows.map((item) => item.id));
        for (const row of secondaryRows) {
          if (!seen.has(row.id)) {
            merged.push(row);
            seen.add(row.id);
          }
        }
        applyMatches(merged.slice(0, 20));
        searchCacheRef.current.set(cacheKey, merged.slice(0, 20));
      }
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
    const escaped = q.trim().replace(/[%_,]/g, (m) => `\\${m}`);
    const { data } = await supabase
      .from('matches')
      .select('players_text, tournament_name')
      .or(`players_text.ilike.%${escaped}%,tournament_name.ilike.%${escaped}%`)
      .limit(10);
    
    if (!data) return;
    const seen = new Set<string>();
    const results: string[] = [];
    for (const row of data) {
      if (row.tournament_name && row.tournament_name.toLowerCase().includes(q.toLowerCase())) {
        if (!seen.has(row.tournament_name)) {
          seen.add(row.tournament_name);
          results.push(row.tournament_name);
        }
      }
      if (row.players_text) {
        const parts = row.players_text.split(/\s+vs\s+/i);
        for (const part of parts) {
          const trimmed = part.trim();
          if (trimmed && trimmed.toLowerCase().includes(q.toLowerCase()) && !seen.has(trimmed)) {
            seen.add(trimmed);
            results.push(trimmed);
          }
        }
      }
      if (results.length >= 8) break;
    }
    setSuggestions(results.slice(0, 8));
    setShowSuggestions(results.length > 0);
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
          多平台赛事数据持续接入中
        </div>

        {syncStatus && (
          <div className="text-sm text-brand-gray font-medium">
            最近同步：{format(new Date(syncStatus.run_at), 'yyyy-MM-dd HH:mm')} · {syncStatus.status === 'SUCCESS' ? `成功（入库 ${syncStatus.upserted_count}）` : `失败（${syncStatus.error_message || '未知错误'}）`}
          </div>
        )}
        
        <h1 className="text-3xl sm:text-4xl md:text-6xl font-extrabold text-brand-brown tracking-tight">
          <span className="block mb-2">探索你的</span>
          <span className="bg-gradient-to-br from-orange-500 to-red-600 bg-clip-text text-transparent">
            赛事数据轨迹
          </span>
        </h1>
        
        <p className="max-w-2xl mx-auto text-base font-medium text-brand-gray sm:text-lg">
          面向多赛事、多平台的数据查询与展示平台。
          <br />
          快速检索比赛结果、实时赛况、赛事排名与历史记录。
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
              className={`group relative mr-2 inline-flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full border transition-all duration-300 ${
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
            matches.map((match, idx) => (
              <Link
                key={match.id}
                to={`/matches/${match.id}`}
                className={`rounded-3xl p-6 shadow-sm border flex flex-col md:flex-row md:items-center justify-between gap-4 hover:shadow-md transition-shadow cursor-pointer ${
                  match.winner_side === 'UNKNOWN'
                    ? 'bg-sky-50/60 border-sky-100'
                    : 'bg-white border-orange-50'
                }`}
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="px-3 py-1 bg-orange-100 text-orange-700 rounded-full text-xs font-bold">{match.category}</span>
                    {match.round_name && (
                      <span className="px-3 py-1 bg-amber-100 text-amber-800 rounded-full text-xs font-extrabold">{match.round_name}</span>
                    )}
                    <span className="text-sm text-brand-gray">
                      {match.start_time ? format(new Date(match.start_time), 'yyyy-MM-dd HH:mm') : (match.match_time_name || '-')}
                    </span>
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

                <div className="flex items-center justify-between md:justify-end gap-2 md:gap-6 bg-orange-50/50 px-4 md:px-6 py-4 rounded-2xl w-full md:w-auto">
                  <div className="text-right flex-1 md:flex-none">
                    <div className={`font-bold ${match.winner_side === 'A' ? 'text-orange-600 text-lg' : 'text-brand-brown'}`}>
                      {match.players_a.join(' / ')}
                    </div>
                    {match.winner_side === 'A' && <span className="text-xs text-orange-500 font-medium">Winner</span>}
                  </div>
                  
                  <div className="text-xl md:text-2xl font-extrabold text-brand-brown tracking-wider bg-white px-3 md:px-4 py-1 rounded-xl shadow-sm border border-orange-100 flex-shrink-0">
                    {match.score_text}
                  </div>
                  
                  <div className="text-left flex-1 md:flex-none">
                    <div className={`font-bold ${match.winner_side === 'B' ? 'text-orange-600 text-lg' : 'text-brand-brown'}`}>
                      {match.players_b.join(' / ')}
                    </div>
                    {match.winner_side === 'B' && <span className="text-xs text-orange-500 font-medium">Winner</span>}
                  </div>
                </div>
              </Link>
            ))
          ) : (
            <div className="text-center py-12 bg-white/50 rounded-3xl border border-orange-50">
              <p className="text-brand-gray text-lg">没有找到相关比赛记录</p>
            </div>
          )}
        </div>
      )}

      {!searched && (
        <div className="w-full max-w-5xl mt-24 grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white/80 backdrop-blur-sm rounded-3xl p-6 shadow-sm border border-orange-50 hover:shadow-md transition-shadow">
          <div className="w-12 h-12 rounded-2xl bg-orange-100 flex items-center justify-center text-orange-500 mb-4">
            <Trophy className="w-6 h-6" />
          </div>
          <h3 className="text-xl font-bold text-brand-brown mb-2">平台化扩展</h3>
          <p className="text-brand-gray text-sm">
            从当前已接入赛事出发，持续扩展到更多赛事平台与不同球类数据，一站式查询。
          </p>
        </div>
        
        <div className="bg-white/80 backdrop-blur-sm rounded-3xl p-6 shadow-sm border border-orange-50 hover:shadow-md transition-shadow">
          <div className="w-12 h-12 rounded-2xl bg-yellow-100 flex items-center justify-center text-yellow-500 mb-4">
            <Activity className="w-6 h-6" />
          </div>
          <h3 className="text-xl font-bold text-brand-brown mb-2">实时赛况</h3>
          <p className="text-brand-gray text-sm">
            对正在进行中的比赛持续追踪与更新，帮助你更快掌握比分变化与晋级进展。
          </p>
        </div>
        
        <div className="bg-white/80 backdrop-blur-sm rounded-3xl p-6 shadow-sm border border-orange-50 hover:shadow-md transition-shadow">
          <div className="w-12 h-12 rounded-2xl bg-green-100 flex items-center justify-center text-green-500 mb-4">
            <Calendar className="w-6 h-6" />
          </div>
          <h3 className="text-xl font-bold text-brand-brown mb-2">跨赛事档案</h3>
          <p className="text-brand-gray text-sm">
            沉淀运动员与赛事的历史数据，逐步形成跨赛事、跨项目的长期档案与统计分析。
          </p>
        </div>
      </div>
      )}

    </div>
  );
}
