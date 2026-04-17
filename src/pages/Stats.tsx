import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Activity, BarChart3, CheckCircle, Medal, Trophy, TrendingUp, Users } from 'lucide-react';

type MatchLite = {
  players_a: string[];
  players_b: string[];
  tournament_name: string;
  category: string;
  winner_side: 'A' | 'B' | 'UNKNOWN';
  event_key: string | null;
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
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [stats, setStats] = useState<StatsModel | null>(null);
  const [activeEventKey, setActiveEventKey] = useState<string>('');

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    setLoading(true);
    setErrorMsg(null);

    const { data: matches, error } = await supabase
      .from('matches')
      .select('players_a, players_b, tournament_name, category, winner_side, event_key');

    if (error) {
      setErrorMsg(error.message);
      setLoading(false);
      return;
    }

    const rows = (matches || []) as MatchLite[];

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
      topCategories,
      eventTabs,
      rankingByEvent,
    };

    setStats(model);
    setActiveEventKey((prev) => prev || eventTabs[0]?.eventKey || '');
    setLoading(false);
  };

  const activeRanking = useMemo(() => {
    if (!stats || !activeEventKey) return [];
    return stats.rankingByEvent[activeEventKey] || [];
  }, [stats, activeEventKey]);

  if (loading) {
    return <div className="p-20 text-center text-orange-500 font-bold">正在生成看板数据...</div>;
  }

  if (errorMsg) {
    return (
      <div className="max-w-5xl mx-auto p-8">
        <div className="bg-red-50 border border-red-200 text-red-700 px-6 py-4 rounded-3xl text-sm font-medium">{errorMsg}</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center pt-6 pb-20 w-full max-w-5xl mx-auto">
      <div className="w-full mb-8">
        <h1 className="text-3xl font-extrabold text-brand-brown mb-2">赛事概览看板</h1>
        <p className="text-brand-gray">基于全量已抓取的数据进行的汇总分析与排名</p>
      </div>

      <div className="w-full grid grid-cols-1 md:grid-cols-4 gap-6 mb-12">
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
            <div className="text-sm font-medium text-brand-gray mb-1">覆盖赛事数量</div>
            <div className="text-3xl font-extrabold text-brand-brown">{stats?.totalTournaments || 0}</div>
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

      <div className="w-full grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
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

      <div className="w-full bg-white/80 backdrop-blur-sm rounded-3xl shadow-sm border border-orange-50 overflow-hidden">
        <div className="px-6 py-5 border-b border-orange-100 bg-orange-50/40">
          <h3 className="text-xl font-bold text-brand-brown flex items-center gap-2">
            <Medal className="w-5 h-5 text-orange-500" /> 比赛详细排名（按组别/项目切换）
          </h3>
          <p className="text-sm text-brand-gray mt-1">当前为“胜场榜”口径（同胜场按胜率、场次排序）。</p>
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
    </div>
  );
}
