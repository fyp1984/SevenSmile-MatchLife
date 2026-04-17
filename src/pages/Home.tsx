import React, { useState, useEffect } from 'react';
import { Search, Trophy, Calendar, MapPin, Activity, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { format } from 'date-fns';

type MatchRow = {
  id: string;
  category: string;
  tournament_name: string;
  start_time: string | null;
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

export default function Home() {
  const [searchQuery, setSearchQuery] = useState('');
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncRunRow | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [recentQueries, setRecentQueries] = useState<string[]>([]);
  const [autoRefresh, setAutoRefresh] = useState(false);

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

    const timer = window.setInterval(() => {
      handleSearch(undefined, searchQuery, { recordHistory: false });
    }, 5000);

    return () => {
      window.clearInterval(timer);
    };
  }, [autoRefresh, searchQuery]);

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

  const fetchSyncStatus = async () => {
    const { data, error } = await supabase
      .from('sync_runs')
      .select('*')
      .order('run_at', { ascending: false })
      .limit(1)
      .single();
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    if (data) setSyncStatus(data as SyncRunRow);
  };

  const fetchLatestMatches = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('matches')
      .select('*')
      .order('start_time', { ascending: false })
      .limit(5);

    if (error) setErrorMsg(error.message);
    if (data) setMatches(data as MatchRow[]);
    setLoading(false);
  };

  const handleSearch = async (
    e?: React.FormEvent,
    q?: string,
    options?: { recordHistory?: boolean }
  ) => {
    if (e) e.preventDefault();
    const keyword = (q ?? searchQuery).trim();
    setErrorMsg(null);
    if (!keyword) {
      setSearched(false);
      fetchLatestMatches();
      return;
    }

    if (options?.recordHistory !== false) {
      persistRecentQueries([keyword, ...recentQueries]);
    }

    setLoading(true);
    setSearched(true);
    
    const escaped = keyword.replace(/[%_,]/g, (m) => `\\${m}`);
    const { data, error } = await supabase
      .from('matches')
      .select('*')
      .or(
        [
          `tournament_name.ilike.%${escaped}%`,
          `city.ilike.%${escaped}%`,
          `location.ilike.%${escaped}%`,
          `match_time_name.ilike.%${escaped}%`,
          `players_text.ilike.%${escaped}%`,
          `score_text.ilike.%${escaped}%`,
          `category.ilike.%${escaped}%`,
          `event_key.ilike.%${escaped}%`,
        ].join(',')
      )
      .order('start_time', { ascending: false })
      .limit(20);

    if (error) setErrorMsg(error.message);
    if (data) {
      setMatches(data as MatchRow[]);
    }
    setLoading(false);
  };

  return (
    <div className="flex flex-col items-center pt-10 pb-20">

      <div className="w-full max-w-3xl text-center space-y-8 mt-10">
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/60 border border-orange-200 text-orange-600 text-sm font-bold shadow-sm backdrop-blur-sm mb-4">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-orange-500"></span>
          </span>
          U系列比赛数据实时更新中
        </div>

        {syncStatus && (
          <div className="text-sm text-brand-gray font-medium">
            最近同步：{format(new Date(syncStatus.run_at), 'yyyy-MM-dd HH:mm')} · {syncStatus.status === 'SUCCESS' ? `成功（入库 ${syncStatus.upserted_count}）` : `失败（${syncStatus.error_message || '未知错误'}）`}
          </div>
        )}
        
        <h1 className="text-4xl md:text-6xl font-extrabold text-brand-brown tracking-tight">
          <span className="block mb-2">探索你的</span>
          <span className="bg-gradient-to-br from-orange-500 to-red-600 bg-clip-text text-transparent">
            比赛生涯轨迹
          </span>
        </h1>
        
        <p className="text-lg text-brand-gray max-w-2xl mx-auto font-medium">
          极简、纯粹的体育赛事数据查询工具。
          <br />
          快速检索选手成绩、近期赛况与排名分析等。
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
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索赛事名称、运动员名称、赛事日期..."
              className="w-full px-4 py-3 text-lg bg-transparent border-none focus:ring-0 outline-none text-brand-brown placeholder-orange-300 font-medium"
            />
            <label className={`flex items-center gap-2 px-3 py-2 rounded-full border ${
              searchQuery.trim()
                ? 'border-orange-200 text-orange-700 hover:bg-orange-50'
                : 'border-gray-200 text-gray-400 cursor-not-allowed'
            } transition-colors mr-2 select-none`}
            >
              <input
                type="checkbox"
                checked={autoRefresh}
                disabled={!searchQuery.trim()}
                onChange={(e) => setAutoRefresh(e.target.checked)}
              />
              <span className="text-sm font-bold">自动刷新</span>
            </label>
            <button 
              type="submit"
              disabled={loading}
              className="bg-gradient-to-r from-orange-500 to-red-500 text-white px-8 py-3 rounded-full font-bold shadow-md hover:shadow-lg hover:from-orange-400 hover:to-red-400 transition-all active:scale-95 disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center min-w-[120px]"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : '检索'}
            </button>
          </div>
        </form>

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
              <div key={match.id} className="bg-white rounded-3xl p-6 shadow-sm border border-orange-50 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:shadow-md transition-shadow">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="px-3 py-1 bg-orange-100 text-orange-700 rounded-full text-xs font-bold">{match.category}</span>
                    <span className="text-sm text-brand-gray">
                      {match.start_time ? format(new Date(match.start_time), 'yyyy-MM-dd HH:mm') : (match.match_time_name || '-')}
                    </span>
                  </div>
                  <h3 className="text-lg font-bold text-brand-brown">{match.tournament_name}</h3>
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
              </div>
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
          <h3 className="text-xl font-bold text-brand-brown mb-2">全面覆盖</h3>
          <p className="text-brand-gray text-sm">
            从 U 系列开始，逐步涵盖各类专业与业余羽毛球赛事数据，一站式查询。
          </p>
        </div>
        
        <div className="bg-white/80 backdrop-blur-sm rounded-3xl p-6 shadow-sm border border-orange-50 hover:shadow-md transition-shadow">
          <div className="w-12 h-12 rounded-2xl bg-yellow-100 flex items-center justify-center text-yellow-500 mb-4">
            <Activity className="w-6 h-6" />
          </div>
          <h3 className="text-xl font-bold text-brand-brown mb-2">实时赛况</h3>
          <p className="text-brand-gray text-sm">
            正在进行中的比赛成绩实时同步，不错过任何一个关键比分和晋级时刻。
          </p>
        </div>
        
        <div className="bg-white/80 backdrop-blur-sm rounded-3xl p-6 shadow-sm border border-orange-50 hover:shadow-md transition-shadow">
          <div className="w-12 h-12 rounded-2xl bg-green-100 flex items-center justify-center text-green-500 mb-4">
            <Calendar className="w-6 h-6" />
          </div>
          <h3 className="text-xl font-bold text-brand-brown mb-2">生涯记录</h3>
          <p className="text-brand-gray text-sm">
            沉淀个人历史参赛数据，形成专属的运动生涯档案与胜率统计分析。
          </p>
        </div>
      </div>
      )}

    </div>
  );
}
