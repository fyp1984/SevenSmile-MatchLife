import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Activity, Calendar, Trophy, ChevronRight, TrendingUp, Users } from "lucide-react";
import { useEffect, useState, useMemo } from "react";
import { supabase } from "../lib/supabase";

interface Match {
  id: string;
  tournament_name: string;
  players_text: string;
  players_a: string[];
  players_b: string[];
  score_text: string;
  start_time: string;
  winner_side: string;
  event_key: string;
}

interface PlayerStats {
  totalMatches: number;
  wins: number;
  winRate: number;
}

export function PlayerCareer() {
  const { name } = useParams();
  const [matches, setMatches] = useState<Match[]>([]);
  const [stats, setStats] = useState<PlayerStats>({ totalMatches: 0, wins: 0, winRate: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const monthlyWinRates = useMemo(() => {
    if (!name || matches.length === 0) return [];
    
    const monthlyData: Record<string, { wins: number; total: number }> = {};
    
    matches.forEach(match => {
      if (!match.start_time) return;
      const date = new Date(match.start_time);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      
      if (!monthlyData[monthKey]) {
        monthlyData[monthKey] = { wins: 0, total: 0 };
      }
      
      const isPlayerA = match.players_a.some((p: string) => p.includes(name || ''));
      const isPlayerB = match.players_b.some((p: string) => p.includes(name || ''));
      const isWinner = (isPlayerA && match.winner_side === 'A') || (isPlayerB && match.winner_side === 'B');
      
      if (match.winner_side !== 'UNKNOWN') {
        monthlyData[monthKey].total += 1;
        if (isWinner) monthlyData[monthKey].wins += 1;
      }
    });
    
    return Object.entries(monthlyData)
      .map(([month, data]) => ({
        month,
        winRate: data.total > 0 ? (data.wins / data.total) * 100 : 0,
        wins: data.wins,
        total: data.total
      }))
      .sort((a, b) => a.month.localeCompare(b.month))
      .slice(-12);
  }, [matches, name]);

  const opponentStats = useMemo(() => {
    if (!name || matches.length === 0) return [];
    
    const opponentData: Record<string, { wins: number; losses: number }> = {};
    
    matches.forEach(match => {
      if (match.winner_side === 'UNKNOWN') return;
      
      const isPlayerA = match.players_a.some((p: string) => p.includes(name || ''));
      const isPlayerB = match.players_b.some((p: string) => p.includes(name || ''));
      const isWinner = (isPlayerA && match.winner_side === 'A') || (isPlayerB && match.winner_side === 'B');
      
      const opponents = isPlayerA ? match.players_b : match.players_a;
      const opponentName = opponents.join(' / ');
      
      if (!opponentData[opponentName]) {
        opponentData[opponentName] = { wins: 0, losses: 0 };
      }
      
      if (isWinner) {
        opponentData[opponentName].wins += 1;
      } else {
        opponentData[opponentName].losses += 1;
      }
    });
    
    return Object.entries(opponentData)
      .map(([opponent, data]) => ({
        opponent,
        matches: data.wins + data.losses,
        wins: data.wins,
        losses: data.losses
      }))
      .sort((a, b) => b.matches - a.matches)
      .slice(0, 5);
  }, [matches, name]);

  useEffect(() => {
    async function fetchPlayerData() {
      if (!name) return;

      setLoading(true);
      setError(null);

      try {
        const { data, error: queryError } = await supabase
          .from('matches')
          .select('*')
          .ilike('players_text', `%${name}%`)
          .order('start_time', { ascending: false });

        if (queryError) throw queryError;

        const playerMatches = data || [];
        setMatches(playerMatches);

        const totalMatches = playerMatches.length;
        const wins = playerMatches.filter(match => {
          const isPlayerA = match.players_a.some(p => p.includes(name || ''));
          const isPlayerB = match.players_b.some(p => p.includes(name || ''));
          if (isPlayerA && match.winner_side === 'A') return true;
          if (isPlayerB && match.winner_side === 'B') return true;
          return false;
        }).length;
        const winRate = totalMatches > 0 ? (wins / totalMatches) * 100 : 0;

        setStats({ totalMatches, wins, winRate });
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载数据失败');
      } finally {
        setLoading(false);
      }
    }

    fetchPlayerData();
  }, [name]);

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin mx-auto"></div>
          <p className="text-text-sub">加载选手数据中...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <Link to="/" className="inline-flex items-center space-x-2 text-brand-600 hover:text-brand-700 font-medium">
          <ArrowLeft className="w-4 h-4" />
          <span>返回搜索</span>
        </Link>
        <div className="bg-red-50 border border-red-200 rounded-3xl p-8 text-center">
          <p className="text-red-600 font-medium">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <Link to="/" className="inline-flex items-center space-x-2 text-brand-600 hover:text-brand-700 font-medium">
        <ArrowLeft className="w-4 h-4" />
        <span>返回搜索</span>
      </Link>

      <div className="bg-white/80 backdrop-blur-sm rounded-3xl shadow-sm border border-brand-100 p-8 flex flex-col md:flex-row items-center gap-8">
        <div className="w-32 h-32 bg-gradient-to-br from-brand-100 to-brand-300 rounded-full flex items-center justify-center text-4xl font-extrabold text-brand-800 shadow-inner">
          {name?.substring(0, 2) || "选手"}
        </div>
        <div className="flex-1 text-center md:text-left space-y-4">
          <h1 className="text-3xl md:text-4xl font-extrabold text-text-main">{name || "选手档案"}</h1>
          <div className="flex flex-wrap justify-center md:justify-start gap-4">
            <div className="bg-brand-50 px-4 py-2 rounded-xl border border-brand-100 text-center">
              <div className="text-2xl font-black text-brand-600">{stats.totalMatches}</div>
              <div className="text-xs text-text-sub font-medium">总参赛场次</div>
            </div>
            <div className="bg-brand-50 px-4 py-2 rounded-xl border border-brand-100 text-center">
              <div className="text-2xl font-black text-brand-600">{stats.wins}</div>
              <div className="text-xs text-text-sub font-medium">胜场数</div>
            </div>
            <div className="bg-gradient-to-br from-brand-500 to-brand-600 px-4 py-2 rounded-xl border border-brand-100 text-center text-white shadow-md">
              <div className="text-2xl font-black">{stats.winRate.toFixed(1)}%</div>
              <div className="text-xs font-medium opacity-90">总胜率</div>
            </div>
          </div>
        </div>
      </div>

      {monthlyWinRates.length > 0 && (
        <div className="bg-white/80 backdrop-blur-sm rounded-3xl shadow-sm border border-brand-100 p-8">
          <h2 className="text-2xl font-bold text-text-main mb-6 flex items-center gap-2">
            <TrendingUp className="w-6 h-6 text-brand-500" />
            <span>胜率趋势（近12个月）</span>
          </h2>
          <div className="w-full h-64 relative">
            <svg viewBox="0 0 800 200" className="w-full h-full">
              <defs>
                <linearGradient id="winRateGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#FF9800" stopOpacity="0.3" />
                  <stop offset="100%" stopColor="#FF9800" stopOpacity="0.05" />
                </linearGradient>
              </defs>
              
              {monthlyWinRates.map((data, idx) => {
                const x = (idx / (monthlyWinRates.length - 1 || 1)) * 700 + 50;
                const y = 180 - (data.winRate / 100) * 150;
                return (
                  <g key={data.month}>
                    <circle cx={x} cy={y} r="4" fill="#FF9800" />
                    <text x={x} y="195" textAnchor="middle" fontSize="10" fill="#8C6B5D">
                      {data.month.split('-')[1]}月
                    </text>
                  </g>
                );
              })}
              
              <polyline
                points={monthlyWinRates.map((data, idx) => {
                  const x = (idx / (monthlyWinRates.length - 1 || 1)) * 700 + 50;
                  const y = 180 - (data.winRate / 100) * 150;
                  return `${x},${y}`;
                }).join(' ')}
                fill="none"
                stroke="#FF9800"
                strokeWidth="2"
              />
              
              <polygon
                points={`50,180 ${monthlyWinRates.map((data, idx) => {
                  const x = (idx / (monthlyWinRates.length - 1 || 1)) * 700 + 50;
                  const y = 180 - (data.winRate / 100) * 150;
                  return `${x},${y}`;
                }).join(' ')} ${((monthlyWinRates.length - 1) / (monthlyWinRates.length - 1 || 1)) * 700 + 50},180`}
                fill="url(#winRateGradient)"
              />
              
              <line x1="50" y1="30" x2="50" y2="180" stroke="#FED7AA" strokeWidth="1" />
              <line x1="50" y1="180" x2="750" y2="180" stroke="#FED7AA" strokeWidth="1" />
              
              <text x="20" y="35" fontSize="10" fill="#8C6B5D">100%</text>
              <text x="20" y="110" fontSize="10" fill="#8C6B5D">50%</text>
              <text x="30" y="185" fontSize="10" fill="#8C6B5D">0%</text>
            </svg>
          </div>
        </div>
      )}

      {opponentStats.length > 0 && (
        <div className="bg-white/80 backdrop-blur-sm rounded-3xl shadow-sm border border-brand-100 p-8">
          <h2 className="text-2xl font-bold text-text-main mb-6 flex items-center gap-2">
            <Users className="w-6 h-6 text-brand-500" />
            <span>对手对阵分布（Top 5）</span>
          </h2>
          <div className="space-y-4">
            {opponentStats.map((stat, idx) => (
              <div key={stat.opponent} className="flex items-center gap-4">
                <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center text-brand-600 font-bold text-sm flex-shrink-0">
                  {idx + 1}
                </div>
                <div className="flex-1">
                  <div className="font-bold text-text-main mb-1">{stat.opponent}</div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-6 bg-brand-50 rounded-full overflow-hidden flex">
                      <div
                        className="bg-gradient-to-r from-brand-500 to-brand-600 flex items-center justify-center text-white text-xs font-bold"
                        style={{ width: `${(stat.wins / stat.matches) * 100}%` }}
                      >
                        {stat.wins > 0 && <span className="px-2">{stat.wins}胜</span>}
                      </div>
                      <div
                        className="bg-gray-300 flex items-center justify-center text-gray-700 text-xs font-bold"
                        style={{ width: `${(stat.losses / stat.matches) * 100}%` }}
                      >
                        {stat.losses > 0 && <span className="px-2">{stat.losses}负</span>}
                      </div>
                    </div>
                    <div className="text-sm text-text-sub font-medium w-16 text-right">
                      {stat.matches}场
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white/80 backdrop-blur-sm rounded-3xl shadow-sm border border-brand-100 p-8">
        <h2 className="text-2xl font-bold text-text-main mb-6 flex items-center gap-2">
          <Activity className="w-6 h-6 text-brand-500" />
          <span>生涯时间轴</span>
        </h2>
        
        <div className="space-y-6 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-brand-200 before:to-transparent">
          {matches.length === 0 ? (
            <div className="text-center py-12 text-text-sub">
              <p>暂无比赛记录</p>
            </div>
          ) : (
            matches.map((match) => {
              const isPlayerA = match.players_a.some(p => p.includes(name || ''));
              const isPlayerB = match.players_b.some(p => p.includes(name || ''));
              const isWinner = (isPlayerA && match.winner_side === 'A') || (isPlayerB && match.winner_side === 'B');
              const players = match.players_text.split(/\s+vs\s+/i);
              const opponentName = players.find(p => p !== name) || '对手';
              
              return (
                <div key={match.id} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                  <div className="flex items-center justify-center w-10 h-10 rounded-full border-4 border-white bg-brand-500 text-white shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10">
                    {isWinner ? <Trophy className="w-4 h-4" /> : <Activity className="w-4 h-4" />}
                  </div>
                  
                  <Link to={`/matches/${match.id}`} className="w-[calc(100%-4rem)] md:w-[calc(50%-3rem)] p-4 rounded-2xl border border-brand-100 bg-white shadow-sm hover:shadow-md hover:border-brand-300 transition-all flex justify-between items-center group-hover:-translate-y-1">
                    <div>
                      <div className="text-sm text-text-sub flex items-center gap-1 mb-1">
                        <Calendar className="w-3 h-3" />
                        <span>{match.start_time ? new Date(match.start_time).toLocaleDateString('zh-CN') : '日期未知'}</span>
                      </div>
                      <h3 className="font-bold text-text-main">{match.tournament_name}</h3>
                      <div className="text-sm font-medium mt-2 flex items-center gap-2">
                        <span className={isWinner ? "text-brand-600 font-bold" : "text-text-sub"}>{name}</span>
                        <span className="px-2 py-0.5 bg-gray-100 rounded-full text-xs">{match.score_text || '比分未知'}</span>
                        <span className={!isWinner ? "text-brand-600 font-bold" : "text-text-sub"}>{opponentName}</span>
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-brand-300 group-hover:text-brand-500" />
                  </Link>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
