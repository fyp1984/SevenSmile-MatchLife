import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Activity, Calendar, Trophy, ChevronRight, TrendingUp, Users, Share2 } from "lucide-react";
import { useEffect, useState, useMemo } from "react";
import { supabase } from "../lib/supabase";
import ShareModal from "../components/ShareModal";
import type { PlayerShareData } from "../lib/shareCard";
import { DATA_SOURCE_CONTACT_HINT } from "../lib/dataSourceHints";
import { listPlayerProfiles, type PlayerProfile } from "../lib/playerProfiles";
import { fetchSourceLabelByRaceId, resolveTournamentDisplayName } from "../lib/dataSources";
import { buildDisplayTeam, findPlayerSide, resolveWinnerSide } from "../lib/matchResults";

interface Match {
  id: string;
  tournament_name: string;
  players_text?: string | null;
  players_a: string[];
  players_b: string[];
  score_text: string;
  start_time: string;
  winner_side: string;
  event_key: string;
}

const MATCH_SELECT =
  'id,tournament_name,players_text,players_a,players_b,score_text,start_time,winner_side,event_key';
const PLAYER_MATCH_LIMIT = 200;

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const record = error as { message?: string; details?: string; hint?: string; error_description?: string };
    return String(record.message || record.details || record.hint || record.error_description || JSON.stringify(error));
  }
  return String(error || '');
}

function isMissingPlayersTextError(error: unknown) {
  const message = getErrorMessage(error);
  return /players_text/i.test(message) && /(column|schema cache|does not exist)/i.test(message);
}

function isTransientGatewayError(error: unknown) {
  const message = getErrorMessage(error);
  return /(504 Gateway Time-out|502 Bad Gateway|503 Service Unavailable|upstream|timed out|timeout|ERR_ABORTED|Failed to fetch|fetch failed)/i.test(message);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeMatch(row: Match): Match {
  const playersText =
    row.players_text ||
    [...(row.players_a || []), ...(row.players_b || [])]
      .filter(Boolean)
      .join(' vs ');
  return { ...row, players_text: playersText };
}

function dedupeMatches(rows: Match[]) {
  const deduped = new Map<string, Match>();
  for (const row of rows) {
    deduped.set(row.id, normalizeMatch(row));
  }
  return Array.from(deduped.values()).sort((a, b) => {
    const timeA = a.start_time ? Date.parse(a.start_time) : 0;
    const timeB = b.start_time ? Date.parse(b.start_time) : 0;
    return timeB - timeA;
  });
}

async function fetchMatchesByExactName(name: string) {
  const [asA, asB] = await Promise.all([
    supabase
      .from('matches')
      .select(MATCH_SELECT)
      .contains('players_a', [name])
      .order('start_time', { ascending: false })
      .limit(PLAYER_MATCH_LIMIT),
    supabase
      .from('matches')
      .select(MATCH_SELECT)
      .contains('players_b', [name])
      .order('start_time', { ascending: false })
      .limit(PLAYER_MATCH_LIMIT),
  ]);

  if (asA.error) throw asA.error;
  if (asB.error) throw asB.error;

  return dedupeMatches([...(asA.data || []), ...(asB.data || [])] as Match[]);
}

async function fetchMatchesByTextLike(name: string) {
  const { data, error } = await supabase
    .from('matches')
    .select(MATCH_SELECT)
    .ilike('players_text', `%${name}%`)
    .order('start_time', { ascending: false })
    .limit(PLAYER_MATCH_LIMIT);

  if (error) throw error;
  return ((data || []) as Match[]).map(normalizeMatch);
}

async function fetchPlayerMatches(name: string) {
  const exactMatches = await fetchMatchesByExactName(name);
  if (exactMatches.length > 0) {
    return exactMatches;
  }
  return await fetchMatchesByTextLike(name);
}

async function fetchPlayerMatchesWithRetry(name: string) {
  try {
    return await fetchPlayerMatches(name);
  } catch (error) {
    if (!isTransientGatewayError(error)) throw error;
    await delay(500);
    return await fetchPlayerMatches(name);
  }
}

interface PlayerStats {
  totalMatches: number;
  wins: number;
  winRate: number;
}

interface MonthlyTrendPoint {
  month: string;
  label: string;
  winRate: number;
  wins: number;
  total: number;
  isEstimated: boolean;
  isForecast: boolean;
}

function clampRate(value: number) {
  return Math.min(95, Math.max(5, value));
}

function buildMonthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function buildMonthLabel(date: Date) {
  return `${String(date.getMonth() + 1).padStart(2, '0')}月`;
}

function shiftMonth(date: Date, offset: number) {
  return new Date(date.getFullYear(), date.getMonth() + offset, 1);
}

function inferTrendForecast(points: MonthlyTrendPoint[], fallbackRate: number) {
  const observed = points.filter((point) => !point.isEstimated && point.total > 0);
  const usable = observed.length > 0 ? observed : points;
  const recentRates = usable.slice(-6).map((point) => point.winRate);
  const lastRate = recentRates[recentRates.length - 1] ?? fallbackRate;
  const shortAvg =
    recentRates.slice(-3).reduce((sum, rate) => sum + rate, 0) /
    Math.max(1, recentRates.slice(-3).length);
  const longAvg =
    recentRates.reduce((sum, rate) => sum + rate, 0) /
    Math.max(1, recentRates.length);
  const slope =
    recentRates.length >= 2
      ? (recentRates[recentRates.length - 1] - recentRates[0]) / (recentRates.length - 1)
      : 0;

  const baseDate = shiftMonth(new Date(), 1);
  return Array.from({ length: 3 }, (_, index) => {
    const monthDate = shiftMonth(baseDate, index);
    const projected = clampRate(lastRate * 0.35 + shortAvg * 0.4 + longAvg * 0.25 + slope * (index + 1) * 0.9);
    return {
      month: buildMonthKey(monthDate),
      label: buildMonthLabel(monthDate),
      winRate: Number(projected.toFixed(1)),
      wins: 0,
      total: 0,
      isEstimated: true,
      isForecast: true,
    } satisfies MonthlyTrendPoint;
  });
}

function normalizePlayerName(value: string) {
  return value.replace(/[／/]/g, '/').replace(/\s+/g, '').trim().toLowerCase();
}

export function PlayerCareer() {
  const { name } = useParams();
  const [matches, setMatches] = useState<Match[]>([]);
  const [playerProfile, setPlayerProfile] = useState<PlayerProfile | null>(null);
  const [stats, setStats] = useState<PlayerStats>({ totalMatches: 0, wins: 0, winRate: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [sourceLabelByRaceId, setSourceLabelByRaceId] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;

    const loadSourceLabels = async () => {
      const labels = await fetchSourceLabelByRaceId();
      if (!cancelled) setSourceLabelByRaceId(labels);
    };

    void loadSourceLabels();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setMatches((current) =>
      current.map((match) => {
        const nextName = resolveTournamentDisplayName(match.tournament_name, sourceLabelByRaceId);
        return nextName === match.tournament_name ? match : { ...match, tournament_name: nextName };
      }),
    );
  }, [sourceLabelByRaceId]);

  const historicalTrend = useMemo(() => {
    const monthlyData: Record<string, { wins: number; total: number }> = {};

    matches.forEach(match => {
      if (!match.start_time || !name) return;
      const date = new Date(match.start_time);
      const monthKey = buildMonthKey(date);

      if (!monthlyData[monthKey]) {
        monthlyData[monthKey] = { wins: 0, total: 0 };
      }

      const playerSide = findPlayerSide(match, name || '');
      const effectiveWinner = resolveWinnerSide(match);
      const isWinner = (playerSide === 'A' && effectiveWinner === 'A') || (playerSide === 'B' && effectiveWinner === 'B');

      if (effectiveWinner !== 'UNKNOWN') {
        monthlyData[monthKey].total += 1;
        if (isWinner) monthlyData[monthKey].wins += 1;
      }
    });

    const currentMonth = new Date();
    const months: MonthlyTrendPoint[] = [];
    let carryRate = stats.winRate || 50;

    for (let offset = -11; offset <= 0; offset += 1) {
      const monthDate = shiftMonth(currentMonth, offset);
      const monthKey = buildMonthKey(monthDate);
      const summary = monthlyData[monthKey];
      const hasData = Boolean(summary && summary.total > 0);
      const actualRate = hasData ? (summary!.wins / summary!.total) * 100 : carryRate;

      if (hasData) {
        carryRate = actualRate;
      }

      months.push({
        month: monthKey,
        label: buildMonthLabel(monthDate),
        winRate: Number(actualRate.toFixed(1)),
        wins: summary?.wins ?? 0,
        total: summary?.total ?? 0,
        isEstimated: !hasData,
        isForecast: false,
      });
    }

    return months;
  }, [matches, name, stats.winRate]);

  const forecastTrend = useMemo(
    () => inferTrendForecast(historicalTrend, stats.winRate || 50),
    [historicalTrend, stats.winRate],
  );

  const forecastSummary = useMemo(() => {
    if (forecastTrend.length === 0) return null;
    const rates = forecastTrend.map((item) => item.winRate);
    const minRate = Math.min(...rates);
    const maxRate = Math.max(...rates);
    const averageRate = rates.reduce((sum, rate) => sum + rate, 0) / rates.length;
    return {
      minRate: Number(minRate.toFixed(1)),
      maxRate: Number(maxRate.toFixed(1)),
      averageRate: Number(averageRate.toFixed(1)),
    };
  }, [forecastTrend]);

  const opponentStats = useMemo(() => {
    if (!name || matches.length === 0) return [];
    
    const opponentData: Record<string, { wins: number; losses: number }> = {};
    
    matches.forEach(match => {
      const effectiveWinner = resolveWinnerSide(match);
      if (effectiveWinner === 'UNKNOWN') return;

      const playerSide = findPlayerSide(match, name || '');
      if (playerSide === 'UNKNOWN') return;

      const isWinner = (playerSide === 'A' && effectiveWinner === 'A') || (playerSide === 'B' && effectiveWinner === 'B');

      const opponents = playerSide === 'A' ? match.players_b : match.players_a;
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

  const milestones = useMemo(() => {
    if (!name || matches.length === 0) return [];
    const list: Array<{ title: string; date: string; description: string; icon: string }> = [];
    
    // Sort matches chronologically for milestone calculation
    const chronoMatches = [...matches]
      .filter(m => m.start_time)
      .sort((a, b) => new Date(a.start_time!).getTime() - new Date(b.start_time!).getTime());
      
    if (chronoMatches.length === 0) return list;

    // 1. 生涯首秀 (Career Debut)
    const debut = chronoMatches[0];
    list.push({
      title: '生涯首秀',
      date: new Date(debut.start_time!).toLocaleDateString('zh-CN'),
      description: `在 ${debut.tournament_name} 完成首次记录`,
      icon: '🎯'
    });

    // 2. 最高连胜 (Longest Winning Streak)
    let maxStreak = 0;
    let currentStreak = 0;
    let streakEndDate = '';
    
    chronoMatches.forEach(match => {
      const effectiveWinner = resolveWinnerSide(match);
      if (effectiveWinner === 'UNKNOWN') return;
      const playerSide = findPlayerSide(match, name || '');
      const isWinner = (playerSide === 'A' && effectiveWinner === 'A') || (playerSide === 'B' && effectiveWinner === 'B');
      
      if (isWinner) {
        currentStreak++;
        if (currentStreak > maxStreak) {
          maxStreak = currentStreak;
          streakEndDate = match.start_time!;
        }
      } else {
        currentStreak = 0;
      }
    });

    if (maxStreak >= 3) {
      list.push({
        title: `${maxStreak} 连胜达成`,
        date: new Date(streakEndDate).toLocaleDateString('zh-CN'),
        description: `连续赢得 ${maxStreak} 场比赛，展现统治力`,
        icon: '🔥'
      });
    }

    // 3. 场次里程碑 (Match Count Milestones)
    const milestoneCounts = [10, 50, 100];
    milestoneCounts.forEach(count => {
      if (chronoMatches.length >= count) {
        const nthMatch = chronoMatches[count - 1];
        list.push({
          title: `达成 ${count} 场比赛`,
          date: new Date(nthMatch.start_time!).toLocaleDateString('zh-CN'),
          description: `在 ${nthMatch.tournament_name} 完成第 ${count} 场出战`,
          icon: '🏅'
        });
      }
    });

    // 4. 首次战胜对手 (First Win)
    const firstWin = chronoMatches.find(match => {
      const effectiveWinner = resolveWinnerSide(match);
      if (effectiveWinner === 'UNKNOWN') return false;
      const playerSide = findPlayerSide(match, name || '');
      return (playerSide === 'A' && effectiveWinner === 'A') || (playerSide === 'B' && effectiveWinner === 'B');
    });

    if (firstWin && firstWin.id !== debut.id) {
      list.push({
        title: '首场胜利',
        date: new Date(firstWin.start_time!).toLocaleDateString('zh-CN'),
        description: `在 ${firstWin.tournament_name} 拿下首胜`,
        icon: '✌️'
      });
    }

    // Sort milestones by date descending
    return list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 4);
  }, [matches, name]);

  useEffect(() => {
    async function fetchPlayerData() {
      if (!name) return;

      setLoading(true);
      setError(null);

      try {
        const profileCandidates = await listPlayerProfiles(name, '', 20);
        const normalizedTarget = normalizePlayerName(name || '');
        const exactProfile =
          profileCandidates.find((item) => normalizePlayerName(item.player_name) === normalizedTarget) ||
          profileCandidates.find((item) => normalizePlayerName(item.player_name).includes(normalizedTarget)) ||
          profileCandidates[0] ||
          null;
        setPlayerProfile(exactProfile);

        let playerMatches = await fetchPlayerMatchesWithRetry(name);
        if (playerMatches.length === 0) {
          try {
            playerMatches = await fetchMatchesByTextLike(name);
          } catch (textError) {
            if (!isMissingPlayersTextError(textError)) throw textError;
            const fallback = await supabase
              .from('matches')
              .select('id,tournament_name,players_a,players_b,score_text,start_time,winner_side,event_key')
              .order('start_time', { ascending: false })
              .limit(1000);
            if (fallback.error) throw fallback.error;
            playerMatches = ((fallback.data || []) as Match[])
              .map(normalizeMatch)
              .filter((match) =>
                [...(match.players_a || []), ...(match.players_b || [])].some((player) =>
                  String(player || '').includes(name || ''),
                ),
              );
          }
        }

        setMatches(
          playerMatches.map((match) => ({
            ...match,
            tournament_name: resolveTournamentDisplayName(match.tournament_name, sourceLabelByRaceId),
          })),
        );

        const totalMatches = playerMatches.length;
        const wins = playerMatches.filter(match => {
          const playerSide = findPlayerSide(match, name || '');
          const effectiveWinner = resolveWinnerSide(match);
          return (playerSide === 'A' && effectiveWinner === 'A') || (playerSide === 'B' && effectiveWinner === 'B');
        }).length;
        const winRate = totalMatches > 0 ? (wins / totalMatches) * 100 : 0;

        setStats({ totalMatches, wins, winRate });
      } catch (err) {
        if (isTransientGatewayError(err)) {
          setError('选手数据服务暂时超时，请稍后重试。');
        } else {
          setError(getErrorMessage(err) || '加载数据失败');
        }
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

  const baseUrl = import.meta.env.BASE_URL || '/';
  const fullUrl = `${window.location.origin}${baseUrl}player/${encodeURIComponent(name || '')}`.replace(/([^:]\/)\/+/g, '$1');
  
  const shareData: PlayerShareData = {
    type: 'player',
    playerName: name || '',
    totalMatches: stats.totalMatches,
    wins: stats.wins,
    winRate: stats.winRate,
    qrCodeUrl: fullUrl,
  };

  const shareUrl = fullUrl;
  const shareTitle = `${name} 的生涯数据 - 七笑果-赛事生涯`;
  const shareDesc = `总场次：${stats.totalMatches} | 胜场：${stats.wins} | 胜率：${stats.winRate.toFixed(1)}%`;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <Link to="/" className="inline-flex items-center space-x-2 text-brand-600 hover:text-brand-700 font-medium">
          <ArrowLeft className="w-4 h-4" />
          <span>返回搜索</span>
        </Link>
        <button
          onClick={() => setIsShareModalOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-orange-500 to-red-500 text-white font-bold rounded-full shadow-md hover:shadow-lg transition-all"
        >
          <Share2 className="w-4 h-4" />
          分享成就
        </button>
      </div>

      <div className="bg-white/80 backdrop-blur-sm rounded-3xl shadow-sm border border-brand-100 p-8 flex flex-col md:flex-row items-center gap-8">
        {playerProfile?.avatar_url ? (
          <img
            src={playerProfile.avatar_url}
            alt={playerProfile.player_name}
            className="w-32 h-32 rounded-full object-cover border-4 border-orange-100 shadow-md"
          />
        ) : (
          <div className="w-32 h-32 bg-gradient-to-br from-brand-100 to-brand-300 rounded-full flex items-center justify-center text-4xl font-extrabold text-brand-800 shadow-inner">
            {name?.substring(0, 1) || "选"}
          </div>
        )}
        <div className="flex-1 text-center md:text-left space-y-4">
          <h1 className="text-3xl md:text-4xl font-extrabold text-text-main">{name || "选手档案"}</h1>
          {playerProfile ? (
            <div className="flex flex-wrap justify-center md:justify-start gap-2">
              <span className="rounded-full bg-orange-50 px-3 py-1 text-sm font-bold text-orange-700">
                主项：{playerProfile.primary_sport}
              </span>
              {playerProfile.affiliated_club && (
                <span className="rounded-full bg-white px-3 py-1 text-sm font-bold text-brand-brown border border-orange-100">
                  俱乐部：{playerProfile.affiliated_club}
                </span>
              )}
              {playerProfile.coach_name && (
                <span className="rounded-full bg-white px-3 py-1 text-sm font-bold text-brand-brown border border-orange-100">
                  教练：{playerProfile.coach_name}
                </span>
              )}
              {playerProfile.dominant_hand && (
                <span className="rounded-full bg-white px-3 py-1 text-sm font-bold text-brand-brown border border-orange-100">
                  惯用手：{playerProfile.dominant_hand}
                </span>
              )}
              <span className="rounded-full bg-white px-3 py-1 text-sm font-bold text-brand-brown border border-orange-100">
                状态：{playerProfile.status === 'active' ? '活跃' : playerProfile.status}
              </span>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-orange-200 bg-orange-50/60 px-4 py-3 text-sm text-brand-gray">
              当前先展示比赛里的生涯数据，选手资料可后续再补充。
            </div>
          )}
          <div className="flex flex-wrap justify-center md:justify-start gap-4">
            <div className="bg-brand-50 px-4 py-2 rounded-xl border border-brand-100 text-center">
              <div className="text-2xl font-black text-brand-600">{stats.totalMatches}</div>
              <div className="text-xs text-text-sub font-medium">总参赛场次</div>
            </div>
            <div className="bg-brand-50 px-4 py-2 rounded-xl border border-brand-100 text-center">
              <div className="text-2xl font-black text-brand-600">{stats.wins}</div>
              <div className="text-xs text-text-sub font-medium">胜场数</div>
            </div>
            <div className="bg-white px-4 py-2 rounded-xl border border-orange-200 text-center shadow-md">
              <div className="text-2xl font-black" style={{ color: 'rgb(241, 77, 59)' }}>{stats.winRate.toFixed(1)}%</div>
              <div className="text-xs font-medium" style={{ color: 'rgb(241, 77, 59)' }}>总胜率</div>
            </div>
          </div>
        </div>
      </div>

      {historicalTrend.length > 0 ? (
        <div className="bg-white/80 backdrop-blur-sm rounded-3xl shadow-sm border border-brand-100 p-6 sm:p-8">
          <h2 className="text-2xl font-bold text-text-main mb-6 flex items-center gap-2">
            <TrendingUp className="w-6 h-6 text-brand-500" />
            <span>胜率走势</span>
          </h2>
          <div className="mb-6 rounded-2xl border border-orange-100 bg-gradient-to-br from-orange-50 via-white to-amber-50 px-5 py-4 text-sm text-brand-brown">
            <p className="font-bold text-base">近 12 个月表现</p>
            <p className="mt-1 text-brand-gray">
              这里会展示近一年的走势，并给出未来 3 个月的参考变化。
            </p>
            {forecastSummary && (
              <p className="mt-2 text-orange-700 font-semibold">
                未来 3 个月大致会保持在 {forecastSummary.minRate}% - {forecastSummary.maxRate}%，
                参考值约 {forecastSummary.averageRate}%。
              </p>
            )}
          </div>
          <div className="w-full h-72 relative">
            <svg viewBox="0 0 960 280" className="w-full h-full">
              <defs>
                <linearGradient id="winRateGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#FF8A00" stopOpacity="0.36" />
                  <stop offset="100%" stopColor="#FF8A00" stopOpacity="0.08" />
                </linearGradient>
                <linearGradient id="forecastGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#F97316" />
                  <stop offset="100%" stopColor="#C2410C" />
                </linearGradient>
              </defs>

              {[0, 25, 50, 75, 100].map((tick) => {
                const y = 230 - (tick / 100) * 180;
                return (
                  <g key={tick}>
                    <line x1="70" y1={y} x2="910" y2={y} stroke={tick === 0 ? "#EFB86F" : "#F8D8B0"} strokeWidth={tick === 0 ? 2 : 1} strokeDasharray={tick === 0 ? "0" : "6 6"} />
                    <text x="48" y={y + 4} textAnchor="end" fontSize="12" fontWeight="700" fill="#6B3B20">
                      {tick}%
                    </text>
                  </g>
                );
              })}

              {historicalTrend.map((data, idx) => {
                const x = (idx / (historicalTrend.length + forecastTrend.length - 1 || 1)) * 840 + 70;
                const y = 230 - (data.winRate / 100) * 180;
                return (
                  <g key={data.month}>
                    <circle
                      cx={x}
                      cy={y}
                      r={data.isEstimated ? 4 : 5.5}
                      fill={data.isEstimated ? "#FDE3C1" : "#F97316"}
                      stroke={data.isEstimated ? "#F59E0B" : "#C2410C"}
                      strokeWidth={data.isEstimated ? 1.5 : 2.5}
                    />
                    <text x={x} y="258" textAnchor="middle" fontSize="11" fontWeight="700" fill="#6B3B20">
                      {data.label}
                    </text>
                    {data.total > 0 && (
                      <text x={x} y={y - 12} textAnchor="middle" fontSize="10" fontWeight="700" fill="#8A4B16">
                        {data.winRate.toFixed(0)}%
                      </text>
                    )}
                  </g>
                );
              })}

              {forecastTrend.map((data, idx) => {
                const pointIndex = historicalTrend.length + idx;
                const x = (pointIndex / (historicalTrend.length + forecastTrend.length - 1 || 1)) * 840 + 70;
                const y = 230 - (data.winRate / 100) * 180;
                return (
                  <g key={data.month}>
                    <circle cx={x} cy={y} r="5" fill="#FFF7ED" stroke="#C2410C" strokeWidth="2.5" />
                    <text x={x} y="258" textAnchor="middle" fontSize="11" fontWeight="700" fill="#6B3B20">
                      {data.label}
                    </text>
                    <text x={x} y={y - 12} textAnchor="middle" fontSize="10" fontWeight="700" fill="#9A3412">
                      参考 {data.winRate.toFixed(0)}%
                    </text>
                  </g>
                );
              })}

              <polyline
                points={historicalTrend.map((data, idx) => {
                  const x = (idx / (historicalTrend.length + forecastTrend.length - 1 || 1)) * 840 + 70;
                  const y = 230 - (data.winRate / 100) * 180;
                  return `${x},${y}`;
                }).join(' ')}
                fill="none"
                stroke="url(#forecastGradient)"
                strokeWidth="4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              <polyline
                points={[...historicalTrend.slice(-1), ...forecastTrend].map((data, idx) => {
                  const pointIndex = historicalTrend.length - 1 + idx;
                  const x = (pointIndex / (historicalTrend.length + forecastTrend.length - 1 || 1)) * 840 + 70;
                  const y = 230 - (data.winRate / 100) * 180;
                  return `${x},${y}`;
                }).join(' ')}
                fill="none"
                stroke="#9A3412"
                strokeWidth="3"
                strokeDasharray="10 8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              <polygon
                points={`70,230 ${historicalTrend.map((data, idx) => {
                  const x = (idx / (historicalTrend.length + forecastTrend.length - 1 || 1)) * 840 + 70;
                  const y = 230 - (data.winRate / 100) * 180;
                  return `${x},${y}`;
                }).join(' ')} ${((historicalTrend.length - 1) / (historicalTrend.length + forecastTrend.length - 1 || 1)) * 840 + 70},230`}
                fill="url(#winRateGradient)"
              />

              <line x1="70" y1="30" x2="70" y2="230" stroke="#D97706" strokeWidth="1.5" />
              <line x1="70" y1="230" x2="910" y2="230" stroke="#D97706" strokeWidth="1.5" />

              <rect x="710" y="24" width="190" height="52" rx="18" fill="rgba(255,247,237,0.96)" stroke="#F5C38B" />
              <line x1="730" y1="44" x2="770" y2="44" stroke="url(#forecastGradient)" strokeWidth="4" strokeLinecap="round" />
              <text x="780" y="48" fontSize="12" fontWeight="700" fill="#6B3B20">历史趋势</text>
              <line x1="730" y1="62" x2="770" y2="62" stroke="#9A3412" strokeWidth="3" strokeDasharray="10 8" strokeLinecap="round" />
              <text x="780" y="66" fontSize="12" fontWeight="700" fill="#6B3B20">未来参考</text>
            </svg>
          </div>
          <div className="mt-6 grid gap-3 md:grid-cols-3">
            {forecastTrend.map((point) => (
              <div key={point.month} className="rounded-2xl border border-orange-100 bg-orange-50/70 px-4 py-3">
                <p className="text-xs font-bold tracking-wide text-orange-700">未来参考</p>
                <p className="mt-1 text-lg font-extrabold text-brand-brown">{point.label}</p>
                <p className="mt-1 text-sm text-brand-gray">参考胜率</p>
                <p className="text-2xl font-black text-orange-600">{point.winRate.toFixed(1)}%</p>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-white/80 backdrop-blur-sm rounded-3xl shadow-sm border border-brand-100 p-8 text-center">
          <TrendingUp className="w-12 h-12 text-brand-200 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-text-main mb-2">还没有比赛记录</h2>
          <p className="text-brand-gray text-sm">暂时还看不到这位选手的走势和里程碑。</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {opponentStats.length > 0 && (
          <div className="bg-white/80 backdrop-blur-sm rounded-3xl shadow-sm border border-brand-100 p-8">
            <h2 className="text-xl font-bold text-text-main mb-6 flex items-center gap-2">
              <Users className="w-5 h-5 text-brand-500" />
              <span>常见对手</span>
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
                          className="bg-white flex items-center justify-center text-xs font-bold"
                          style={{ width: `${(stat.wins / stat.matches) * 100}%` }}
                        >
                          {stat.wins > 0 && <span className="px-2" style={{ color: 'rgb(241, 77, 59)' }}>{stat.wins}胜</span>}
                        </div>
                        <div
                          className="bg-gray-300 flex items-center justify-center text-gray-700 text-xs font-bold"
                          style={{ width: `${(stat.losses / stat.matches) * 100}%` }}
                        >
                          {stat.losses > 0 && <span className="px-2">{stat.losses}负</span>}
                        </div>
                      </div>
                      <div className="text-sm text-text-sub font-medium w-12 text-right">
                        {stat.matches}场
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {milestones.length > 0 && (
          <div className="bg-white/80 backdrop-blur-sm rounded-3xl shadow-sm border border-brand-100 p-8">
            <h2 className="text-xl font-bold text-text-main mb-6 flex items-center gap-2">
              <Trophy className="w-5 h-5 text-accent-yellow" />
              <span>荣誉与里程碑</span>
            </h2>
            <div className="space-y-4">
              {milestones.map((milestone, idx) => (
                <div key={idx} className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-2xl bg-orange-50 flex items-center justify-center text-xl flex-shrink-0 shadow-sm border border-orange-100">
                    {milestone.icon}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <div className="font-bold text-brand-brown">{milestone.title}</div>
                      <div className="text-xs text-brand-gray bg-gray-50 px-2 py-0.5 rounded-full">{milestone.date}</div>
                    </div>
                    <div className="mt-1 text-sm text-brand-gray/80 leading-snug">
                      {milestone.description}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="bg-white/80 backdrop-blur-sm rounded-3xl shadow-sm border border-brand-100 p-8">
        <h2 className="text-2xl font-bold text-text-main mb-6 flex items-center gap-2">
          <Activity className="w-6 h-6 text-brand-500" />
          <span>生涯时间轴</span>
        </h2>
        
        <div className="space-y-6 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-brand-200 before:to-transparent">
          {matches.length === 0 ? (
            <div className="text-center py-12 text-text-sub">
              <p>暂时还没有这位选手的比赛数据。</p>
              <p className="mt-2 text-sm text-brand-gray">{DATA_SOURCE_CONTACT_HINT}</p>
            </div>
          ) : (
            matches.map((match) => {
              const playerSide = findPlayerSide(match, name || '');
              const effectiveWinner = resolveWinnerSide(match);
              const isWinner = (playerSide === 'A' && effectiveWinner === 'A') || (playerSide === 'B' && effectiveWinner === 'B');
              const currentTeam = buildDisplayTeam(playerSide === 'B' ? match.players_b : match.players_a);
              const opponentTeam = buildDisplayTeam(playerSide === 'B' ? match.players_a : match.players_b);
              const currentTeamLabel = currentTeam.join(' / ') || name || '当前选手';
              const opponentName = opponentTeam.join(' / ') || '对手';
              
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
                      <div className="text-sm font-medium mt-2 flex flex-wrap items-center gap-2">
                        <span className={isWinner ? "text-brand-600 font-bold" : "text-text-sub"}>{currentTeamLabel}</span>
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

      <ShareModal
        isOpen={isShareModalOpen}
        onClose={() => setIsShareModalOpen(false)}
        data={shareData}
        shareUrl={shareUrl}
        shareTitle={shareTitle}
        shareDesc={shareDesc}
      />
    </div>
  );
}
