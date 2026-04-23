import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useSportTab, SPORTS } from '../components/SportTabBar';
import { Medal, Trophy, Activity } from 'lucide-react';

type PlayerRanking = {
  rank: number;
  player_id: string;
  player_name: string;
  avatar_url: string | null;
  total_matches: number;
  wins: number;
  win_rate: number;
  last_active: string;
};

export default function Leaderboard() {
  const { activeSport, setActiveSport } = useSportTab();
  const [rankings, setRankings] = useState<PlayerRanking[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const PAGE_SIZE = 20;

  const fetchRankings = async (offset: number = 0, append: boolean = false) => {
    if (loading) return;
    
    setLoading(true);
    setError(null);

    try {
      const { data, error: rpcError } = await supabase.rpc('get_player_rankings', {
        page_limit: PAGE_SIZE,
        page_offset: offset,
        sport_type: activeSport,
      });

      if (rpcError) throw new Error(rpcError.message);

      const newRankings = (data || []) as PlayerRanking[];
      
      if (append) {
        setRankings((prev) => [...prev, ...newRankings]);
      } else {
        setRankings(newRankings);
      }

      setHasMore(newRankings.length === PAGE_SIZE);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setRankings([]);
    setHasMore(true);
    void fetchRankings(0, false);
  }, [activeSport]);

  useEffect(() => {
    if (!hasMore || loading) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          void fetchRankings(rankings.length, true);
        }
      },
      { threshold: 0.5 }
    );

    if (loadMoreRef.current) {
      observerRef.current.observe(loadMoreRef.current);
    }

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [hasMore, loading, rankings.length]);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return '今天';
    if (diffDays === 1) return '昨天';
    if (diffDays < 7) return `${diffDays}天前`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}周前`;
    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  };

  return (
    <div className="flex flex-col items-center pt-6 pb-20 w-full max-w-5xl mx-auto">
      <div className="w-full mb-8">
        <h1 className="mb-2 text-2xl font-extrabold text-brand-brown sm:text-3xl">
          选手排行榜
        </h1>
        <p className="text-sm text-brand-gray sm:text-base">
          基于比赛胜率和胜场数的综合排名（最少5场比赛）
        </p>
      </div>

      <div className="w-full mb-6 overflow-x-auto scrollbar-hide bg-white/80 backdrop-blur-sm border border-orange-100 rounded-3xl">
        <div className="flex items-center justify-start md:justify-center gap-1 md:gap-3 px-4 py-3 min-w-max">
          {SPORTS.filter(s => s.enabled).map((sport) => {
            const isActive = activeSport === sport.key;
            return (
              <button
                key={sport.key}
                type="button"
                onClick={() => setActiveSport(sport.key)}
                className={`relative flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-bold transition-all duration-200 ${
                  isActive
                    ? 'bg-gradient-to-r from-orange-500 to-red-500 text-white shadow-md'
                    : 'bg-orange-50 text-brand-brown hover:bg-orange-100 hover:text-orange-600'
                }`}
              >
                <span className="text-base">{sport.emoji}</span>
                <span>{sport.label}</span>
                {isActive && (
                  <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-white" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {error && (
        <div className="w-full mb-6 bg-red-50 border border-red-200 text-red-700 px-6 py-4 rounded-3xl text-sm font-medium">
          {error}
        </div>
      )}

      {rankings.length === 0 && !loading ? (
        <div className="w-full rounded-3xl border border-orange-100 bg-white/80 p-12 text-center">
          <Trophy className="w-16 h-16 text-orange-200 mx-auto mb-4" />
          <h3 className="text-xl font-bold text-brand-brown mb-2">暂无排行榜数据</h3>
          <p className="text-brand-gray text-sm">
            当前运动类型下还没有符合条件的选手（需至少5场比赛）
          </p>
        </div>
      ) : (
        <div className="w-full bg-white/80 backdrop-blur-sm rounded-3xl shadow-sm border border-orange-50 overflow-hidden">
          <div className="px-6 py-5 border-b border-orange-100 bg-orange-50/40">
            <h3 className="text-xl font-bold text-brand-brown flex items-center gap-2">
              <Medal className="w-5 h-5 text-orange-500" /> 
              {SPORTS.find(s => s.key === activeSport)?.label}排行榜
            </h3>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-orange-100 text-brand-brown bg-orange-50/20">
                  <th className="p-4 font-bold w-16">排名</th>
                  <th className="p-4 font-bold">选手</th>
                  <th className="p-4 font-bold text-center">胜场</th>
                  <th className="p-4 font-bold text-center">总场次</th>
                  <th className="p-4 font-bold text-center">胜率</th>
                  <th className="p-4 font-bold text-center">最近活跃</th>
                </tr>
              </thead>
              <tbody>
                {rankings.map((player) => {
                  const isTopThree = player.rank <= 3;
                  const rankColor = 
                    player.rank === 1 ? 'text-yellow-600' :
                    player.rank === 2 ? 'text-gray-500' :
                    player.rank === 3 ? 'text-orange-600' :
                    'text-brand-brown';
                  
                  return (
                    <tr 
                      key={player.player_id} 
                      className={`border-b border-orange-50 hover:bg-orange-50/30 transition-colors ${
                        isTopThree ? 'bg-orange-50/20' : ''
                      }`}
                    >
                      <td className="p-4">
                        <div className="flex items-center justify-center">
                          {isTopThree ? (
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center font-extrabold ${
                              player.rank === 1 ? 'bg-yellow-100 text-yellow-600' :
                              player.rank === 2 ? 'bg-gray-100 text-gray-600' :
                              'bg-orange-100 text-orange-600'
                            }`}>
                              {player.rank}
                            </div>
                          ) : (
                            <span className={`font-extrabold ${rankColor}`}>{player.rank}</span>
                          )}
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          {player.avatar_url ? (
                            <img 
                              src={player.avatar_url} 
                              alt={player.player_name}
                              className="w-10 h-10 rounded-full object-cover border-2 border-orange-100"
                            />
                          ) : (
                            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-orange-400 to-red-500 flex items-center justify-center text-white font-bold">
                              {player.player_name.charAt(0)}
                            </div>
                          )}
                          <span className="font-bold text-brand-brown">{player.player_name}</span>
                        </div>
                      </td>
                      <td className="p-4 text-center">
                        <span className="font-extrabold text-orange-600">{player.wins}</span>
                      </td>
                      <td className="p-4 text-center">
                        <span className="font-extrabold text-brand-brown">{player.total_matches}</span>
                      </td>
                      <td className="p-4 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <div className="w-16 h-2 bg-orange-100 rounded-full overflow-hidden">
                            <div 
                              className="h-full bg-gradient-to-r from-orange-400 to-red-500 rounded-full"
                              style={{ width: `${player.win_rate}%` }}
                            />
                          </div>
                          <span className="font-extrabold text-brand-brown min-w-[3rem]">
                            {player.win_rate.toFixed(1)}%
                          </span>
                        </div>
                      </td>
                      <td className="p-4 text-center">
                        <span className="text-sm text-brand-gray">
                          {formatDate(player.last_active)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {loading && (
            <div className="px-6 py-8 text-center border-t border-orange-50">
              <div className="inline-flex items-center gap-2 text-orange-600">
                <Activity className="w-4 h-4 animate-pulse" />
                <span className="text-sm font-medium">加载中...</span>
              </div>
            </div>
          )}

          {hasMore && !loading && (
            <div ref={loadMoreRef} className="px-6 py-4 text-center border-t border-orange-50">
              <span className="text-sm text-brand-gray">滚动加载更多</span>
            </div>
          )}

          {!hasMore && rankings.length > 0 && (
            <div className="px-6 py-4 text-center border-t border-orange-50">
              <span className="text-sm text-brand-gray">已显示全部排名</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
