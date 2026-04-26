import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSportTab, SPORTS } from '../components/SportTabBar';
import { Medal, Trophy, Activity } from 'lucide-react';
import { buildUnavailableDataMessage } from '../lib/dataSourceHints';
import { listPlayerProfiles, type PlayerProfile } from '../lib/playerProfiles';
import {
  inferGenderBucket,
  inferMatchMode,
  inferSportType,
  normalizeParticipantName,
  resolveWinnerSide,
  type GenderBucket,
  type MatchMode,
} from '../lib/matchResults';

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

type RankingMatch = {
  players_a: string[];
  players_b: string[];
  winner_side: 'A' | 'B' | 'UNKNOWN';
  score_text: string | null;
  event_key: string | null;
  category: string | null;
  tournament_name: string | null;
  source: string | null;
  start_time: string | null;
  source_updated_at: string | null;
};

type GenderFilter = 'all' | Exclude<GenderBucket, 'mixed' | 'unknown'>;
type ModeFilter = 'all' | Extract<MatchMode, 'singles' | 'doubles'>;

const GENDER_OPTIONS: Array<{ key: GenderFilter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'male', label: '男' },
  { key: 'female', label: '女' },
];

const MODE_OPTIONS: Array<{ key: ModeFilter; label: string }> = [
  { key: 'all', label: '全部项目' },
  { key: 'singles', label: '单打' },
  { key: 'doubles', label: '双打' },
];

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const record = error as { message?: string; details?: string; hint?: string; error_description?: string };
    return String(record.message || record.details || record.hint || record.error_description || JSON.stringify(error));
  }
  return String(error || '');
}

function isMissingFilteredRankingRpc(error: unknown) {
  const message = getErrorMessage(error);
  return /matchlife_get_filtered_player_rankings/i.test(message) && /(schema cache|does not exist|Could not find the function)/i.test(message);
}

function mapRankingRow(row: Record<string, unknown>): PlayerRanking {
  return {
    rank: Number(row.rank || 0),
    player_id: String(row.player_id || ''),
    player_name: String(row.player_name || ''),
    avatar_url: row.avatar_url ? String(row.avatar_url) : null,
    total_matches: Number(row.total_matches || 0),
    wins: Number(row.wins || 0),
    win_rate: Number(row.win_rate || 0),
    last_active: String(row.last_active || new Date(0).toISOString()),
  };
}

async function buildFallbackRankings(activeSport: string, activeGender: GenderFilter, activeMode: ModeFilter) {
  const BATCH_SIZE = 500;
  const collected: RankingMatch[] = [];
  const profiles = await listPlayerProfiles('', activeSport, 500);
  const profilesByName = profiles.reduce<Record<string, PlayerProfile>>((acc, profile) => {
    acc[normalizeParticipantName(profile.player_name)] = profile;
    return acc;
  }, {});

  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('matches')
      .select('players_a,players_b,winner_side,score_text,event_key,category,tournament_name,source,start_time,source_updated_at')
      .range(from, from + BATCH_SIZE - 1);

    if (error) throw error;
    const batch = ((data || []) as RankingMatch[]).filter((match) => inferSportType(match) === activeSport);
    collected.push(...batch);
    if (batch.length < BATCH_SIZE) break;
    from += BATCH_SIZE;
  }

  const aggregates = new Map<string, PlayerRanking>();
  for (const match of collected) {
    const resolvedWinner = resolveWinnerSide(match);
    if (resolvedWinner === 'UNKNOWN') continue;
    const mode = inferMatchMode(match);
    if (activeMode !== 'all' && mode !== activeMode) continue;
    const lastActive = match.start_time || match.source_updated_at || new Date(0).toISOString();

    const consumeSide = (team: string[], side: 'A' | 'B') => {
      for (const playerName of team) {
        const normalized = normalizeParticipantName(playerName);
        const profile = profilesByName[normalized];
        const gender = inferGenderBucket(match, profile?.gender);
        if (activeGender !== 'all' && gender !== activeGender) continue;
        const key = `${activeSport}:${normalized}:${activeGender}:${activeMode}`;
        const prev = aggregates.get(key);
        const won = resolvedWinner === side ? 1 : 0;
        if (!prev) {
          aggregates.set(key, {
            rank: 0,
            player_id: key,
            player_name: playerName,
            avatar_url: profile?.avatar_url || null,
            total_matches: 1,
            wins: won,
            win_rate: 0,
            last_active: lastActive,
          });
          continue;
        }
        prev.total_matches += 1;
        prev.wins += won;
        if (Date.parse(lastActive) > Date.parse(prev.last_active)) prev.last_active = lastActive;
        if (!prev.avatar_url && profile?.avatar_url) prev.avatar_url = profile.avatar_url;
      }
    };

    consumeSide(match.players_a || [], 'A');
    consumeSide(match.players_b || [], 'B');
  }

  return Array.from(aggregates.values())
    .map((player) => ({
      ...player,
      win_rate: player.total_matches > 0 ? Number(((player.wins / player.total_matches) * 100).toFixed(1)) : 0,
    }))
    .sort((a, b) => {
      if (b.win_rate !== a.win_rate) return b.win_rate - a.win_rate;
      if (b.wins !== a.wins) return b.wins - a.wins;
      if (b.total_matches !== a.total_matches) return b.total_matches - a.total_matches;
      if (b.last_active !== a.last_active) return Date.parse(b.last_active) - Date.parse(a.last_active);
      return a.player_name.localeCompare(b.player_name, 'zh-CN');
    })
    .map((player, index) => ({ ...player, rank: index + 1 }));
}

export default function Leaderboard() {
  const { activeSport, setActiveSport } = useSportTab();
  const [rankings, setRankings] = useState<PlayerRanking[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeGender, setActiveGender] = useState<GenderFilter>('all');
  const [activeMode, setActiveMode] = useState<ModeFilter>('all');

  useEffect(() => {
    setActiveGender('all');
    setActiveMode('all');
  }, [activeSport]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const rpc = await supabase.rpc('matchlife_get_filtered_player_rankings', {
          p_sport_type: activeSport,
          p_gender: activeGender,
          p_mode: activeMode,
          p_limit: 300,
          p_offset: 0,
        });

        if (rpc.error) {
          if (!isMissingFilteredRankingRpc(rpc.error)) throw rpc.error;
          const fallback = await buildFallbackRankings(activeSport, activeGender, activeMode);
          if (!cancelled) setRankings(fallback);
          return;
        }

        if (!cancelled) {
          setRankings(((rpc.data || []) as Array<Record<string, unknown>>).map(mapRankingRow));
        }
      } catch (err) {
        if (!cancelled) setError(getErrorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeGender, activeMode, activeSport]);

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
        <h1 className="mb-2 text-2xl font-extrabold text-brand-brown sm:text-3xl">选手排行榜</h1>
        <p className="text-sm text-brand-gray sm:text-base">
          基于系统内全部历史比赛数据生成，可按男、女、单打、双打等维度查看当前运动项目的排名表现。
        </p>
      </div>

      <div className="w-full mb-6 overflow-x-auto scrollbar-hide bg-white/80 backdrop-blur-sm border border-orange-100 rounded-3xl">
        <div className="flex items-center justify-start md:justify-center gap-1 md:gap-3 px-4 py-3 min-w-max">
          {SPORTS.filter((sport) => sport.enabled).map((sport) => {
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
                {isActive && <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-white" />}
              </button>
            );
          })}
        </div>
      </div>

      <div className="w-full mb-6 grid gap-4 rounded-3xl border border-orange-100 bg-white/80 p-5 backdrop-blur-sm md:grid-cols-2">
        <div>
          <div className="mb-2 text-sm font-bold text-brand-brown">性别筛选</div>
          <div className="flex flex-wrap gap-2">
            {GENDER_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setActiveGender(option.key)}
                className={`rounded-full px-4 py-2 text-sm font-bold transition ${
                  activeGender === option.key
                    ? 'bg-gradient-to-r from-orange-500 to-red-500 text-white shadow-md'
                    : 'border border-orange-200 bg-white text-orange-700 hover:bg-orange-50'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-2 text-sm font-bold text-brand-brown">项目筛选</div>
          <div className="flex flex-wrap gap-2">
            {MODE_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setActiveMode(option.key)}
                className={`rounded-full px-4 py-2 text-sm font-bold transition ${
                  activeMode === option.key
                    ? 'bg-gradient-to-r from-orange-500 to-red-500 text-white shadow-md'
                    : 'border border-orange-200 bg-white text-orange-700 hover:bg-orange-50'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
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
          <p className="text-brand-gray text-sm">{buildUnavailableDataMessage(activeSport)}</p>
        </div>
      ) : (
        <div className="w-full bg-white/80 backdrop-blur-sm rounded-3xl shadow-sm border border-orange-50 overflow-hidden">
          <div className="px-6 py-5 border-b border-orange-100 bg-orange-50/40">
            <h3 className="text-xl font-bold text-brand-brown flex items-center gap-2">
              <Medal className="w-5 h-5 text-orange-500" />
              {SPORTS.find((sport) => sport.key === activeSport)?.label}排行榜
            </h3>
            <p className="mt-2 text-sm text-brand-gray">
              当前维度：{GENDER_OPTIONS.find((item) => item.key === activeGender)?.label} · {MODE_OPTIONS.find((item) => item.key === activeMode)?.label}
            </p>
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
                      className={`border-b border-orange-50 hover:bg-orange-50/30 transition-colors ${isTopThree ? 'bg-orange-50/20' : ''}`}
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
                        <Link
                          to={`/player/${encodeURIComponent(player.player_name)}`}
                          className="flex items-center gap-3 group/link"
                        >
                          {player.avatar_url ? (
                            <img
                              src={player.avatar_url}
                              alt={player.player_name}
                              className="w-10 h-10 rounded-full object-cover border-2 border-orange-100 transition-transform group-hover/link:scale-105"
                            />
                          ) : (
                            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-orange-400 to-red-500 flex items-center justify-center text-white font-bold shadow-sm transition-transform group-hover/link:scale-105">
                              {player.player_name.charAt(0)}
                            </div>
                          )}
                          <div>
                            <span className="font-bold text-brand-brown group-hover/link:text-orange-600 transition-colors">
                              {player.player_name}
                            </span>
                            <p className="text-xs text-brand-gray">查看生涯趋势与比赛时间轴</p>
                          </div>
                        </Link>
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
                        <span className="text-sm text-brand-gray">{formatDate(player.last_active)}</span>
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
        </div>
      )}
    </div>
  );
}
