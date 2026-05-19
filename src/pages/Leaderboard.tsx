import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSportTab, SPORTS } from '../components/SportTabBar';
import { Medal, Trophy, Activity, AlertTriangle } from 'lucide-react';
import { buildUnavailableDataMessage } from '../lib/dataSourceHints';
import {
  buildScopedStatsPauseNotice,
  useLeaderboardGovernance,
} from '../hooks/usePendingPersistGuard';

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

type GenderFilter = 'all' | 'male' | 'female' | 'mixed';
type ModeFilter = 'all' | 'singles' | 'doubles';
type RankingFilters = {
  sport: string;
  gender: GenderFilter;
  mode: ModeFilter;
};

const GENDER_OPTIONS: Array<{ key: GenderFilter; label: string }> = [
  { key: 'all', label: '全部性别' },
  { key: 'male', label: '男子' },
  { key: 'female', label: '女子' },
  { key: 'mixed', label: '混合' },
];

const MODE_OPTIONS: Array<{ key: ModeFilter; label: string }> = [
  { key: 'all', label: '全部形式' },
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

export default function Leaderboard() {
  const { activeSport, setActiveSport } = useSportTab();
  const [rankings, setRankings] = useState<PlayerRanking[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeGender, setActiveGender] = useState<GenderFilter>('all');
  const [activeMode, setActiveMode] = useState<ModeFilter>('all');
  const [submittedFilters, setSubmittedFilters] = useState<RankingFilters | null>(null);
  const cacheRef = useRef(new Map<string, PlayerRanking[]>());
  const hasSearched = submittedFilters !== null;
  const governanceFilters = useMemo(
    () => ({
      sport: hasSearched ? submittedFilters?.sport || '' : '',
      gender: hasSearched ? submittedFilters?.gender || 'all' : 'all',
      mode: hasSearched ? submittedFilters?.mode || 'all' : 'all',
    }),
    [hasSearched, submittedFilters],
  );
  const {
    scope: governanceScope,
    checking: governanceChecking,
    error: governanceError,
    hasScopePause: hasBlockingRankings,
    refreshScope: refreshLeaderboardGovernance,
  } = useLeaderboardGovernance(governanceFilters);
  const previousPauseRankingsRef = useRef(hasBlockingRankings);
  const filtersDirty =
    !submittedFilters ||
    submittedFilters.sport !== activeSport ||
    submittedFilters.gender !== activeGender ||
    submittedFilters.mode !== activeMode;
  const pauseNotice = useMemo(
    () => buildScopedStatsPauseNotice(governanceScope, governanceError),
    [governanceError, governanceScope],
  );
  const shouldPauseRankings = hasBlockingRankings || Boolean(governanceError);

  useEffect(() => {
    if (!submittedFilters) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    const cacheKey = [submittedFilters.sport, submittedFilters.gender, submittedFilters.mode].join(':');
    void (async () => {
      const runtimeCheck = await refreshLeaderboardGovernance(
        {
          sport: submittedFilters.sport,
          gender: submittedFilters.gender,
          mode: submittedFilters.mode,
        },
        !rankings.length,
      );
      if (cancelled) return;
      if (runtimeCheck.error || runtimeCheck.scope?.isPaused) {
        setLoading(false);
        return;
      }

      const cached = cacheRef.current.get(cacheKey);
      if (cached) {
        setRankings(cached);
        setError(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      setRankings([]);
      try {
        const rpc = await supabase.rpc('matchlife_get_filtered_player_rankings', {
          p_sport_type: submittedFilters.sport,
          p_gender: submittedFilters.gender,
          p_mode: submittedFilters.mode,
          p_limit: 300,
          p_offset: 0,
        });

        if (rpc.error) {
          throw rpc.error;
        }

        if (!cancelled) {
          const nextRankings = ((rpc.data || []) as Array<Record<string, unknown>>).map(mapRankingRow);
          cacheRef.current.set(cacheKey, nextRankings);
          setRankings(nextRankings);
        }
      } catch (err) {
        if (!cancelled) setError(getErrorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      setLoading(false);
    };
  }, [rankings.length, submittedFilters, refreshLeaderboardGovernance]);

  useEffect(() => {
    const wasPauseRankings = previousPauseRankingsRef.current;
    previousPauseRankingsRef.current = hasBlockingRankings;
    if (
      wasPauseRankings &&
      !hasBlockingRankings &&
      submittedFilters &&
      submittedFilters.sport === governanceFilters.sport &&
      submittedFilters.gender === governanceFilters.gender &&
      submittedFilters.mode === governanceFilters.mode
    ) {
      cacheRef.current.clear();
      setSubmittedFilters({ ...submittedFilters });
    }
  }, [governanceFilters, hasBlockingRankings, submittedFilters]);

  const runSearch = () => {
    setSubmittedFilters({
      sport: activeSport,
      gender: activeGender,
      mode: activeMode,
    });
  };

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
          请选择运动项目、性别与单打/双打条件后，再手动检索排行榜，以降低初始化数据库负载。
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
          <div className="mb-2 text-sm font-bold text-brand-brown">比赛形式</div>
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

      <div className="mb-6 flex w-full flex-col gap-3 rounded-3xl border border-orange-100 bg-white/80 p-5 backdrop-blur-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-brand-gray">
          {governanceChecking
            ? '正在准备当前排行榜...'
            : shouldPauseRankings
              ? '当前筛选范围的数据仍在更新，排行榜稍后开放。'
              : hasSearched && !filtersDirty
                ? '当前结果已与所选筛选条件同步。'
                : '调整筛选条件后，点击“开始检索”再加载排行榜。'}
        </div>
        <button
          type="button"
          onClick={runSearch}
          disabled={governanceChecking || hasBlockingRankings}
          className="inline-flex h-11 items-center justify-center rounded-full bg-gradient-to-r from-orange-500 to-red-500 px-6 text-sm font-bold text-white shadow-md transition hover:from-orange-400 hover:to-red-400"
        >
          {governanceChecking ? '准备中...' : hasBlockingRankings ? '稍后查看' : hasSearched ? '更新排行榜' : '开始检索'}
        </button>
      </div>

      {error && (
        <div className="w-full mb-6 bg-red-50 border border-red-200 text-red-700 px-6 py-4 rounded-3xl text-sm font-medium">
          {error}
        </div>
      )}

      {shouldPauseRankings && (
        <div className="mb-6 w-full rounded-3xl border border-amber-200 bg-amber-50 px-6 py-4 text-sm text-amber-800">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600" />
            <div>
              <div className="font-bold text-amber-900">排行榜已暂停</div>
              <div className="mt-1 leading-6">{pauseNotice}</div>
              {governanceScope?.scopeSummary && (
                <div className="mt-2 leading-6">影响范围：{governanceScope.scopeSummary}</div>
              )}
              {governanceScope?.recoveryHint && (
                <div className="mt-2 leading-6">建议稍后：{governanceScope.recoveryHint}</div>
              )}
              {governanceScope && governanceScope.affectedSources.length > 0 && (
                <div className="mt-2 leading-6">
                  影响来源：{governanceScope.affectedSources.join('、')}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {shouldPauseRankings ? (
        <div className="w-full rounded-3xl border border-amber-200 bg-amber-50/80 p-12 text-center text-amber-800">
          <div className="text-base font-bold text-amber-900">
            {governanceChecking ? '正在准备排行榜...' : pauseNotice}
          </div>
          {governanceScope?.scopeSummary && (
            <div className="mt-3 text-sm leading-6">{governanceScope.scopeSummary}</div>
          )}
          {governanceScope?.recoveryHint && (
            <div className="mt-2 text-sm leading-6">建议稍后：{governanceScope.recoveryHint}</div>
          )}
          {governanceScope && governanceScope.affectedTournaments.length > 0 && (
            <div className="mt-2 text-sm leading-6">
              涉及赛事：{governanceScope.affectedTournaments.slice(0, 3).join('、')}
              {governanceScope.affectedTournaments.length > 3 ? ' 等' : ''}
            </div>
          )}
        </div>
      ) : !hasSearched ? (
        <div className="w-full rounded-3xl border border-orange-100 bg-white/80 p-12 text-center">
          <Trophy className="mx-auto mb-4 h-16 w-16 text-orange-200" />
          <h3 className="mb-2 text-xl font-bold text-brand-brown">尚未开始检索</h3>
          <p className="text-sm text-brand-gray">请先选择筛选条件，再点击“开始检索”加载排行榜。</p>
        </div>
      ) : loading && rankings.length === 0 ? (
        <div className="w-full rounded-3xl border border-orange-100 bg-white/80 p-12 text-center">
          <Activity className="w-12 h-12 text-orange-400 mx-auto mb-4 animate-pulse" />
          <h3 className="text-xl font-bold text-brand-brown mb-2">正在获取数据...</h3>
          <p className="text-brand-gray text-sm">稍等片刻，排行榜正在路上</p>
        </div>
      ) : rankings.length === 0 ? (
        <div className="w-full rounded-3xl border border-orange-100 bg-white/80 p-12 text-center">
          <Trophy className="w-16 h-16 text-orange-200 mx-auto mb-4" />
          <h3 className="text-xl font-bold text-brand-brown mb-2">暂无排行榜数据</h3>
          <p className="text-brand-gray text-sm">{buildUnavailableDataMessage(submittedFilters?.sport || activeSport)}</p>
        </div>
      ) : (
        <div className="w-full bg-white/80 backdrop-blur-sm rounded-3xl shadow-sm border border-orange-50 overflow-hidden">
          <div className="px-6 py-5 border-b border-orange-100 bg-orange-50/40">
            <h3 className="text-xl font-bold text-brand-brown flex items-center gap-2">
              <Medal className="w-5 h-5 text-orange-500" />
              {SPORTS.find((sport) => sport.key === (submittedFilters?.sport || activeSport))?.label}排行榜
            </h3>
            <p className="mt-2 text-sm text-brand-gray">
              当前维度：{GENDER_OPTIONS.find((item) => item.key === (submittedFilters?.gender || activeGender))?.label} · {MODE_OPTIONS.find((item) => item.key === (submittedFilters?.mode || activeMode))?.label}
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
