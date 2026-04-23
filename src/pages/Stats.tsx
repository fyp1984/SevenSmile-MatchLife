import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Activity, BarChart3, CheckCircle, Medal, Search, Trophy, TrendingUp, Users, Download, Share2 } from 'lucide-react';
import ShareModal from '../components/ShareModal';
import type { StatsShareData } from '../lib/shareCard';

type MatchLite = {
  players_a: string[];
  players_b: string[];
  tournament_name: string;
  category: string;
  winner_side: 'A' | 'B' | 'UNKNOWN';
  event_key: string | null;
  start_time: string | null;
  source_updated_at: string | null;
};

type TeamStat = {
  team: string;
  played: number;
  wins: number;
  losses: number;
  winRate: number;
};

type StatsModel = {
  totalMatches: number;
  finishedMatches: number;
  totalPlayers: number;
  totalTournaments: number;
  selectedTournament: string;
  topCategories: Array<[string, number]>;
  eventTabs: Array<{ eventKey: string; matchCount: number; finishedCount: number }>;
  rankingByEvent: Record<string, TeamStat[]>;
};

function normalizeEventLabel(eventKey: string) {
  return eventKey.replace(/^([0-9]{1,2})岁\1岁/, '$1岁');
}

function toTeamName(list: string[] | null | undefined) {
  return (list || []).filter(Boolean).join(' / ').trim();
}

export default function Stats() {
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [stats, setStats] = useState<StatsModel | null>(null);
  const [activeEventKey, setActiveEventKey] = useState<string>('');
  const [allRows, setAllRows] = useState<MatchLite[]>([]);
  const [tournamentQuery, setTournamentQuery] = useState('');
  const [selectedTournament, setSelectedTournament] = useState('');
  const [recentTournaments, setRecentTournaments] = useState<Array<{ tournament_name: string; latest_at: string; match_count: number }>>([]);
  const [loadingRecent, setLoadingRecent] = useState(true);
  const [selectedForLoad, setSelectedForLoad] = useState('');
  const [loadedTournament, setLoadedTournament] = useState('');
  const [loadingProgress, setLoadingProgress] = useState<{ loaded: number; total: number } | null>(null);
  const refreshTimerRef = useRef<number | null>(null);
  const lastRefreshAtRef = useRef<number>(0);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);

  useEffect(() => {
    fetchRecentTournaments();
  }, []);

  const fetchRecentTournaments = async () => {
    setLoadingRecent(true);
    const { data, error } = await supabase.rpc('matchlife_list_recent_tournaments', { p_limit: 40 });
    if (error) {
      setErrorMsg(error.message);
      setLoadingRecent(false);
      return;
    }
    const rows = (data || []) as Array<{ tournament_name: string; latest_at: string; match_count: number }>;
    setRecentTournaments(rows);
    if (!selectedForLoad && rows[0]?.tournament_name) {
      setSelectedForLoad(rows[0].tournament_name);
    }
    setLoadingRecent(false);
  };

  const fetchStatsSource = async (forcedTournament?: string) => {
    const targetTournament = (forcedTournament || selectedForLoad || selectedTournament || '').trim();
    if (!targetTournament) {
      setErrorMsg('请先选择赛事后再点击"加载统计"。');
      return;
    }
    setLoading(true);
    setErrorMsg(null);
    setLoadingProgress(null);

    const BATCH_SIZE = 200;

    try {
      const firstRequest = supabase
        .from('matches')
        .select('players_a,players_b,tournament_name,category,winner_side,event_key,start_time,source_updated_at')
        .eq('tournament_name', targetTournament)
        .order('start_time', { ascending: false, nullsFirst: false })
        .range(0, BATCH_SIZE - 1);

      const firstResponse = await firstRequest;
      if (firstResponse.error) throw new Error(`加载统计失败：${firstResponse.error.message}`);

      const firstBatch = firstResponse.data as MatchLite[];
      const { count: totalCount } = await supabase
        .from('matches')
        .select('*', { count: 'exact', head: true })
        .eq('tournament_name', targetTournament);
      const total = totalCount ?? 0;

      setAllRows(firstBatch);
      setSelectedTournament(targetTournament);
      setLoadedTournament(targetTournament);
      setLoadingProgress({ loaded: firstBatch.length, total });

      if (total > BATCH_SIZE) {
        const remainingBatches = Math.ceil((total - BATCH_SIZE) / BATCH_SIZE);
        const allRows = [...firstBatch];

        const batchPromises: Promise<void>[] = [];
        for (let i = 0; i < remainingBatches; i++) {
          const from = BATCH_SIZE + i * BATCH_SIZE;
          const to = BATCH_SIZE + (i + 1) * BATCH_SIZE - 1;

          batchPromises.push(
            (async () => {
              const batchRequest = supabase
                .from('matches')
                .select('players_a,players_b,tournament_name,category,winner_side,event_key,start_time,source_updated_at')
                .eq('tournament_name', targetTournament)
                .order('start_time', { ascending: false, nullsFirst: false })
                .range(from, to);

              const batchResponse = await batchRequest;
              if (!batchResponse.error && batchResponse.data) {
                allRows.push(...batchResponse.data);
              }
            })()
          );
        }

        await Promise.all(batchPromises);
        setAllRows([...allRows]);
        setLoadingProgress({ loaded: allRows.length, total });
      }

      setLoadingProgress(null);
      setLoading(false);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setErrorMsg(msg);
      setLoading(false);
      setLoadingProgress(null);
    }
  };

  useEffect(() => {
    if (allRows.length === 0) {
      setStats(null);
      return;
    }

    const sortedTournamentNames = recentTournaments.map((row) => row.tournament_name);

    const normalizedQuery = tournamentQuery.trim().toLowerCase();
    const matchedTournamentNames = normalizedQuery
      ? sortedTournamentNames.filter((name) => name.toLowerCase().includes(normalizedQuery))
      : sortedTournamentNames;

    const effectiveTournament =
      matchedTournamentNames.includes(selectedTournament)
        ? selectedTournament
        : matchedTournamentNames[0] || sortedTournamentNames[0] || '';

    if (effectiveTournament !== selectedTournament) setSelectedTournament(effectiveTournament);

    const rows = effectiveTournament
      ? allRows.filter((row) => row.tournament_name === effectiveTournament)
      : allRows;

    const totalMatches = rows.length;
    const playersSet = new Set<string>();
    const tournamentsSet = new Set<string>();

    const categoryCount: Record<string, number> = {};
    const eventCount: Record<string, number> = {};
    const eventFinishedCount: Record<string, number> = {};

    const rankMap: Record<string, Record<string, { wins: number; losses: number }>> = {};

    let finishedMatches = 0;

    for (const m of rows) {
      for (const p of m.players_a || []) playersSet.add(p);
      for (const p of m.players_b || []) playersSet.add(p);
      if (m.tournament_name) tournamentsSet.add(m.tournament_name);

      if (m.category) categoryCount[m.category] = (categoryCount[m.category] || 0) + 1;

      const eventKey = m.event_key || '未识别项目';
      eventCount[eventKey] = (eventCount[eventKey] || 0) + 1;

      const a = toTeamName(m.players_a);
      const b = toTeamName(m.players_b);
      if (!a || !b) continue;

      if (m.winner_side === 'A' || m.winner_side === 'B') {
        finishedMatches += 1;
        eventFinishedCount[eventKey] = (eventFinishedCount[eventKey] || 0) + 1;
        rankMap[eventKey] ||= {};
        rankMap[eventKey][a] ||= { wins: 0, losses: 0 };
        rankMap[eventKey][b] ||= { wins: 0, losses: 0 };
        if (m.winner_side === 'A') {
          rankMap[eventKey][a].wins += 1;
          rankMap[eventKey][b].losses += 1;
        } else {
          rankMap[eventKey][b].wins += 1;
          rankMap[eventKey][a].losses += 1;
        }
      }
    }

    const topCategories = Object.entries(categoryCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6) as Array<[string, number]>;

    const eventTabs = Object.entries(eventCount)
      .map(([eventKey, matchCount]) => ({
        eventKey,
        matchCount,
        finishedCount: eventFinishedCount[eventKey] || 0,
      }))
      .sort((a, b) => b.matchCount - a.matchCount);

    const rankingByEvent: StatsModel['rankingByEvent'] = {};
    for (const [eventKey, teams] of Object.entries(rankMap)) {
      const list: TeamStat[] = Object.entries(teams).map(([team, wl]) => {
        const played = wl.wins + wl.losses;
        return {
          team,
          played,
          wins: wl.wins,
          losses: wl.losses,
          winRate: played > 0 ? wl.wins / played : 0,
        };
      });
      list.sort((a, b) => {
        if (b.wins !== a.wins) return b.wins - a.wins;
        if (b.winRate !== a.winRate) return b.winRate - a.winRate;
        if (b.played !== a.played) return b.played - a.played;
        return a.team.localeCompare(b.team);
      });
      rankingByEvent[eventKey] = list;
    }

    const model: StatsModel = {
      totalMatches,
      finishedMatches,
      totalPlayers: playersSet.size,
      totalTournaments: tournamentsSet.size,
      selectedTournament: effectiveTournament,
      topCategories,
      eventTabs,
      rankingByEvent,
    };

    setStats(model);
    setActiveEventKey((prev) => prev || eventTabs[0]?.eventKey || '');
  }, [allRows, tournamentQuery, selectedTournament, recentTournaments]);

  const tournamentOptions = useMemo(() => {
    const allNames = recentTournaments.map((row) => row.tournament_name);

    const q = tournamentQuery.trim().toLowerCase();
    return q ? allNames.filter((name) => name.toLowerCase().includes(q)) : allNames;
  }, [recentTournaments, tournamentQuery]);

  useEffect(() => {
    if (!loadedTournament) return;
    const channel = supabase
      .channel(`ml_stats_${Date.now()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'matches' },
        (payload: unknown) => {
          const now = Date.now();
          if (now - lastRefreshAtRef.current < 2000) return;

          const p = (typeof payload === 'object' && payload !== null) ? (payload as Record<string, unknown>) : {};
          const eventType = p['eventType'];
          if (eventType === 'UPDATE') {
            const nextRow = (typeof p['new'] === 'object' && p['new'] !== null) ? (p['new'] as Record<string, unknown>) : {};
            const prevRow = (typeof p['old'] === 'object' && p['old'] !== null) ? (p['old'] as Record<string, unknown>) : {};
            const nextWinner = nextRow['winner_side'];
            const prevWinner = prevRow['winner_side'];
            if (nextWinner === prevWinner) return;
            if (nextWinner !== 'A' && nextWinner !== 'B') return;
          }

          if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current);
          refreshTimerRef.current = window.setTimeout(() => {
            lastRefreshAtRef.current = Date.now();
            fetchStatsSource(loadedTournament);
          }, 600);
        }
      )
      .subscribe();

    return () => {
      if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current);
      supabase.removeChannel(channel);
    };
  }, [loadedTournament]);

  const activeRanking = useMemo(() => {
    if (!stats || !activeEventKey) return [];
    return stats.rankingByEvent[activeEventKey] || [];
  }, [stats, activeEventKey]);

  const exportToCSV = () => {
    if (!stats || activeRanking.length === 0) return;
    
    const headers = ['排名', '选手/组合', '胜', '负', '场次', '胜率'];
    const rows = activeRanking.map((r, idx) => [
      idx + 1,
      r.team,
      r.wins,
      r.losses,
      r.played,
      `${(r.winRate * 100).toFixed(1)}%`
    ]);
    
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');
    
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
    
    link.setAttribute('href', url);
    link.setAttribute('download', `matchlife-stats-${today}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const baseUrl = import.meta.env.BASE_URL || '/';
  const fullUrl = `${window.location.origin}${baseUrl}stats?sport=badminton`.replace(/([^:]\/)\/+/g, '$1');
  
  const shareData: StatsShareData | null = stats ? {
    type: 'stats',
    tournamentName: stats.selectedTournament,
    topPlayers: activeRanking.slice(0, 3).map(r => ({
      name: r.team,
      wins: r.wins,
      winRate: r.winRate * 100,
    })),
    totalMatches: stats.totalMatches,
    qrCodeUrl: fullUrl,
  } : null;

  const shareUrl = fullUrl;
  const shareTitle = stats ? `${stats.selectedTournament} 排行榜 - 七笑果 MatchLife` : '赛事排行榜';
  const shareDesc = stats ? `总场次：${stats.totalMatches} | 参赛人数：${stats.totalPlayers}` : '查看最新赛事排行榜';

  if (loadingRecent) {
    return <div className="p-20 text-center text-orange-500 font-bold">正在加载赛事列表...</div>;
  }

  return (
    <div className="flex flex-col items-center pt-6 pb-20 w-full max-w-5xl mx-auto">
      <div className="w-full mb-8">
        <h1 className="mb-2 text-2xl font-extrabold text-brand-brown sm:text-3xl">赛事概览看板</h1>
        <p className="text-sm text-brand-gray sm:text-base">先选择目标赛事并手动点击“加载统计”，系统不会在页面加载时预先计算完整统计。</p>
      </div>
      {errorMsg && (
        <div className="w-full mb-6 bg-red-50 border border-red-200 text-red-700 px-6 py-4 rounded-3xl text-sm font-medium">
          {errorMsg}
        </div>
      )}
      {loadingProgress && (
        <div className="w-full mb-6 bg-blue-50 border border-blue-200 text-blue-700 px-6 py-4 rounded-3xl text-sm font-medium flex items-center gap-3">
          <BarChart3 className="w-4 h-4 animate-pulse" />
          <span>正在加载数据：{loadingProgress.loaded} / {loadingProgress.total} 条记录</span>
        </div>
      )}

      <div className="w-full bg-white/70 backdrop-blur-sm rounded-3xl border border-orange-100 p-5 mb-8">
        <div className="flex flex-col lg:flex-row lg:items-center gap-4">
          <div className="flex-1">
            <div className="text-sm font-bold text-brand-brown mb-2">指定赛事名称后再统计</div>
            <div className="relative">
              <Search className="w-4 h-4 text-orange-400 absolute left-4 top-1/2 -translate-y-1/2" />
              <input
                value={tournamentQuery}
                onChange={(e) => setTournamentQuery(e.target.value)}
                placeholder="模糊搜索赛事名称，如：U12-14北方赛区羽毛球比赛"
                className="w-full pl-10 pr-4 py-3 rounded-2xl border border-orange-100 bg-white text-brand-brown outline-none focus:border-orange-300"
              />
            </div>
          </div>
          <div className="text-sm text-brand-gray min-w-[220px]">
            当前统计对象：
            <div className="mt-1 font-bold text-brand-brown">{loadedTournament || '尚未加载'}</div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {tournamentOptions.slice(0, 8).map((name) => (
            <button
              key={name}
              type="button"
              aria-pressed={name === selectedForLoad}
              onClick={() => setSelectedForLoad(name)}
              className={
                name === selectedForLoad
                  ? 'px-4 py-2 rounded-full bg-gradient-to-r from-orange-500 to-red-500 text-white font-bold shadow-sm ring-2 ring-orange-300'
                  : 'px-4 py-2 rounded-full bg-white border border-orange-200 text-orange-700 font-bold hover:bg-orange-50 hover:border-orange-300'
              }
            >
              {name}
            </button>
          ))}
          {tournamentOptions.length === 0 && (
            <div className="text-sm text-brand-gray">没有找到匹配的赛事名称</div>
          )}
        </div>
        <div className="mt-4">
          <button
            type="button"
            onClick={() => {
              void fetchStatsSource(selectedForLoad);
            }}
            disabled={loading}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-gradient-to-r from-orange-500 to-red-500 px-5 text-sm font-bold text-white shadow-md transition hover:from-orange-400 hover:to-red-400 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-70"
          >
            <BarChart3 className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            {loading ? '加载中...' : '加载统计'}
          </button>
        </div>
      </div>

      {!stats ? (
        <div className="w-full rounded-3xl border border-orange-100 bg-white/80 p-8 text-center text-brand-gray">
          {loading ? '正在生成看板数据...' : '请选择赛事后点击“加载统计”。'}
        </div>
      ) : (
      <div className={`w-full grid grid-cols-1 md:grid-cols-4 gap-6 mb-12 ${loading ? 'opacity-70' : ''}`}>
        <div className="bg-white/80 backdrop-blur-sm rounded-3xl p-6 shadow-sm border border-orange-50 flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-orange-100 flex items-center justify-center text-orange-500 flex-shrink-0">
            <Activity className="w-7 h-7" />
          </div>
          <div>
            <div className="text-sm font-medium text-brand-gray mb-1">收录比赛总场次</div>
            <div className="text-3xl font-extrabold text-brand-brown">{stats?.totalMatches || 0}</div>
          </div>
        </div>

        <div className="bg-white/80 backdrop-blur-sm rounded-3xl p-6 shadow-sm border border-orange-50 flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-yellow-100 flex items-center justify-center text-yellow-600 flex-shrink-0">
            <Users className="w-7 h-7" />
          </div>
          <div>
            <div className="text-sm font-medium text-brand-gray mb-1">参赛运动员人数</div>
            <div className="text-3xl font-extrabold text-brand-brown">{stats?.totalPlayers || 0}</div>
          </div>
        </div>

        <div className="bg-white/80 backdrop-blur-sm rounded-3xl p-6 shadow-sm border border-orange-50 flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-blue-100 flex items-center justify-center text-blue-600 flex-shrink-0">
            <Trophy className="w-7 h-7" />
          </div>
          <div>
            <div className="text-sm font-medium text-brand-gray mb-1">当前统计赛事</div>
            <div className="text-lg font-extrabold text-brand-brown line-clamp-2">{stats?.selectedTournament || '-'}</div>
          </div>
        </div>

        <div className="bg-white/80 backdrop-blur-sm rounded-3xl p-6 shadow-sm border border-orange-50 flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-green-100 flex items-center justify-center text-green-600 flex-shrink-0">
            <CheckCircle className="w-7 h-7" />
          </div>
          <div>
            <div className="text-sm font-medium text-brand-gray mb-1">已完赛场次</div>
            <div className="text-3xl font-extrabold text-brand-brown">{stats?.finishedMatches || 0}</div>
          </div>
        </div>
      </div>
      )}
      {stats && (
      <div className={`w-full grid grid-cols-1 md:grid-cols-2 gap-6 mb-12 ${loading ? 'opacity-70' : ''}`}>
        <div className="bg-white/60 backdrop-blur-md rounded-3xl p-8 border border-orange-50">
          <h3 className="text-xl font-bold text-brand-brown mb-6 flex items-center gap-2">
            <TrendingUp className="text-orange-500 w-5 h-5" /> 热门比赛组别分布
          </h3>
          <div className="space-y-4">
            {stats?.topCategories?.map(([cat, count], i) => (
              <div key={cat} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="w-6 h-6 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center text-xs font-bold">{i + 1}</span>
                  <span className="text-brand-brown font-medium">{cat}</span>
                </div>
                <div className="flex items-center gap-3 w-1/2">
                  <div className="flex-1 h-2 bg-orange-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-orange-400 to-red-500 rounded-full"
                      style={{ width: `${(count / (stats?.totalMatches || 1)) * 100}%` }}
                    />
                  </div>
                  <span className="text-sm text-brand-gray font-bold w-10 text-right">{count}场</span>
                </div>
              </div>
            ))}
            {(!stats?.topCategories || stats.topCategories.length === 0) && (
              <div className="text-center text-brand-gray py-4">暂无分类数据</div>
            )}
          </div>
        </div>

        <div className="bg-white/60 backdrop-blur-md rounded-3xl p-10 border border-orange-50 text-center border-dashed border-2 border-orange-200 flex flex-col items-center justify-center">
          <BarChart3 className="w-16 h-16 text-orange-200 mb-4" />
          <h3 className="text-xl font-bold text-brand-brown mb-2">更多图表开发中</h3>
          <p className="text-brand-gray text-sm max-w-xs">敬请期待积分规则、区域榜单与选手主页等能力。</p>
        </div>
      </div>
      )}

      {stats && (
      <div className="w-full bg-white/80 backdrop-blur-sm rounded-3xl shadow-sm border border-orange-50 overflow-hidden relative">
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60 text-sm font-bold text-orange-600 backdrop-blur-[1px]">
            正在更新下方统计表...
          </div>
        )}
        <div className="px-6 py-5 border-b border-orange-100 bg-orange-50/40">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="text-xl font-bold text-brand-brown flex items-center gap-2">
                <Medal className="w-5 h-5 text-orange-500" /> 比赛详细排名（按组别/项目切换）
              </h3>
              <p className="text-sm text-brand-gray mt-1">当前为“胜场榜”口径（同胜场按胜率、场次排序）。</p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setIsShareModalOpen(true)}
                disabled={!stats}
                className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-orange-500 to-red-500 px-4 py-2 text-sm font-bold text-white shadow-md transition hover:from-orange-400 hover:to-red-400 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Share2 className="w-4 h-4" />
                分享排名
              </button>
              <button
                type="button"
                onClick={exportToCSV}
                disabled={activeRanking.length === 0}
                className="inline-flex items-center gap-2 rounded-full bg-white border-2 border-orange-500 text-orange-600 px-4 py-2 text-sm font-bold shadow-md transition hover:bg-orange-50 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Download className="w-4 h-4" />
                导出CSV
              </button>
            </div>
          </div>
        </div>

        <div className="px-4 sm:px-6 py-4 border-b border-orange-50 overflow-x-auto">
          <div className="flex items-center gap-2 min-w-max">
            {(stats?.eventTabs || []).slice(0, 20).map((t) => (
              <button
                key={t.eventKey}
                onClick={() => setActiveEventKey(t.eventKey)}
                className={
                  t.eventKey === activeEventKey
                    ? 'px-4 py-2 rounded-full bg-gradient-to-r from-orange-500 to-red-500 text-white font-bold shadow-sm'
                    : 'px-4 py-2 rounded-full bg-white border border-orange-200 text-orange-700 font-bold hover:bg-orange-50'
                }
              >
                {normalizeEventLabel(t.eventKey)} <span className="opacity-80 text-xs">({t.matchCount})</span>
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-orange-100 text-brand-brown">
                <th className="p-4 font-bold w-16">排名</th>
                <th className="p-4 font-bold">选手/组合</th>
                <th className="p-4 font-bold">胜</th>
                <th className="p-4 font-bold">负</th>
                <th className="p-4 font-bold">场次</th>
                <th className="p-4 font-bold">胜率</th>
              </tr>
            </thead>
            <tbody>
              {activeRanking.map((r, idx) => (
                <tr key={`${activeEventKey}-${r.team}`} className="border-b border-orange-50 hover:bg-orange-50/30 transition-colors">
                  <td className="p-4 font-extrabold text-brand-brown">{idx + 1}</td>
                  <td className="p-4 font-bold text-brand-brown">{r.team}</td>
                  <td className="p-4 font-extrabold text-orange-600">{r.wins}</td>
                  <td className="p-4 font-extrabold text-brand-gray">{r.losses}</td>
                  <td className="p-4 font-extrabold text-brand-brown">{r.played}</td>
                  <td className="p-4 font-extrabold text-brand-brown">{(r.winRate * 100).toFixed(1)}%</td>
                </tr>
              ))}
              {activeRanking.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-10 text-center text-brand-gray">该组别暂无可计算排名的数据</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {shareData && (
        <ShareModal
          isOpen={isShareModalOpen}
          onClose={() => setIsShareModalOpen(false)}
          data={shareData}
          shareUrl={shareUrl}
          shareTitle={shareTitle}
          shareDesc={shareDesc}
        />
      )}
    </div>
  );
}
