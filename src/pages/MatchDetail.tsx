import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Calendar, MapPin, Trophy, Share2, Tags, Activity, RefreshCw } from 'lucide-react';
import {
  getFriendlySupabaseErrorMessage,
  retrySupabaseOperation,
  supabase,
} from '../lib/supabase';
import ShareModal from '../components/ShareModal';
import type { MatchShareData } from '../lib/shareCard';
import { resolveWinnerSide } from '../lib/matchResults';
import {
  buildMatchDetailPath,
  buildMatchTaggingPath,
  getPreferredMatchDetailRef,
  isPollingPreferred,
} from '../lib/matchReadModel';

interface MatchDetailRow {
  id: string;
  match_id: string | null;
  persisted_match_id: string | null;
  detail_match_ref: string;
  canonical_match_id: string | null;
  source_match_id: string | null;
  tournament_name: string;
  players_a: string[];
  players_b: string[];
  score_text: string | null;
  start_time: string | null;
  location: string | null;
  city: string | null;
  winner_side: string;
  event_key: string | null;
  round_name: string | null;
  category: string | null;
  match_time_name: string | null;
  source_updated_at: string | null;
  match_started_at: string | null;
  match_ended_at: string | null;
  match_status: string | null;
  lifecycle_status: string | null;
  snapshot_version: number | null;
  stage_label: string | null;
  stage_hint: string | null;
  is_realtime: boolean | null;
  is_fallback: boolean | null;
  has_persisted_match: boolean;
}

interface RelatedMatch {
  id: string;
  canonical_match_id: string | null;
  tournament_name: string;
  players_a: string[];
  players_b: string[];
  score_text: string | null;
  start_time: string | null;
  location: string | null;
  winner_side: string;
  event_key: string | null;
  round_name: string | null;
  source_updated_at: string | null;
}

interface MatchTagEvent {
  id: string;
  tagId: string;
  tagName: string;
  tagCategory: string;
  eventTime: number;
  videoTimestamp: number | null;
  notes: string;
  isVerified: boolean;
  createdAt: string;
}

type MatchFallbackRow = {
  id: string;
  canonical_match_id: string | null;
  source_match_id: string | null;
  tournament_name: string;
  players_a: string[];
  players_b: string[];
  score_text: string | null;
  start_time: string | null;
  location: string | null;
  city: string | null;
  winner_side: string;
  event_key: string | null;
  round_name: string | null;
  category: string | null;
  match_time_name: string | null;
  source_updated_at: string | null;
  match_started_at: string | null;
  match_ended_at: string | null;
  match_status: string | null;
  lifecycle_status: string | null;
  snapshot_version: number | null;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getErrorMessage(error: unknown, fallback = '加载失败') {
  if (error instanceof Error) return error.message || fallback;
  if (error && typeof error === 'object') {
    const record = error as { message?: string; details?: string; hint?: string; error_description?: string };
    return String(record.message || record.details || record.hint || record.error_description || fallback);
  }
  return String(error || fallback);
}

function isMissingDetailRpcError(error: unknown) {
  const message = getErrorMessage(error);
  return /matchlife_get_match_detail/i.test(message) && /(schema cache|does not exist|Could not find the function)/i.test(message);
}

function toFallbackDetail(row: MatchFallbackRow): MatchDetailRow {
  const isFallback = row.match_status === 'LIVE' || ['persist_failed', 'manual_review', 'quality_blocked'].includes(String(row.lifecycle_status || ''));

  return {
    id: row.id,
    match_id: row.id,
    persisted_match_id: row.id,
    detail_match_ref: row.canonical_match_id || row.id,
    canonical_match_id: row.canonical_match_id,
    source_match_id: row.source_match_id,
    tournament_name: row.tournament_name,
    players_a: row.players_a || [],
    players_b: row.players_b || [],
    score_text: row.score_text,
    start_time: row.start_time,
    location: row.location,
    city: row.city,
    winner_side: row.winner_side || 'UNKNOWN',
    event_key: row.event_key,
    round_name: row.round_name,
    category: row.category,
    match_time_name: row.match_time_name,
    source_updated_at: row.source_updated_at,
    match_started_at: row.match_started_at,
    match_ended_at: row.match_ended_at,
    match_status: row.match_status,
    lifecycle_status: row.lifecycle_status || 'persisted',
    snapshot_version: row.snapshot_version,
    stage_label: null,
    stage_hint: null,
    is_realtime: false,
    is_fallback: isFallback,
    has_persisted_match: true,
  };
}

export function MatchDetail() {
  const { id } = useParams<{ id: string }>();
  const [match, setMatch] = useState<MatchDetailRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [relatedMatches, setRelatedMatches] = useState<RelatedMatch[]>([]);
  const [playerRecentMatches, setPlayerRecentMatches] = useState<RelatedMatch[]>([]);
  const [matchEvents, setMatchEvents] = useState<MatchTagEvent[]>([]);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);

  useEffect(() => {
    if (!id) {
      setError('比赛 ID 缺失');
      setLoading(false);
      return;
    }

    let cancelled = false;

    const fetchSupportData = async (matchData: MatchDetailRow) => {
      const allPlayers = [...matchData.players_a, ...matchData.players_b].filter(Boolean);
      const playerOrFilters = allPlayers
        .map((player) => `players_text.ilike.%${player.replace(/[%(),]/g, '')}%`)
        .join(',');
      const excludeId = matchData.persisted_match_id || matchData.match_id || null;

      const [relatedResult, recentResult, tagResult] = await Promise.allSettled([
        supabase
          .from('matches')
          .select('id,canonical_match_id,tournament_name,players_a,players_b,score_text,start_time,location,winner_side,event_key,round_name,source_updated_at')
          .eq('tournament_name', matchData.tournament_name)
          .order('start_time', { ascending: false })
          .limit(6),
        playerOrFilters
          ? supabase
              .from('matches')
              .select('id,canonical_match_id,tournament_name,players_a,players_b,score_text,start_time,location,winner_side,event_key,round_name,source_updated_at')
              .or(playerOrFilters)
              .order('start_time', { ascending: false })
              .limit(6)
          : Promise.resolve({ data: [], error: null }),
        matchData.persisted_match_id
          ? supabase.rpc('matchlife_list_match_tags', { p_match_id: matchData.persisted_match_id })
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (cancelled) return;

      if (relatedResult.status === 'fulfilled' && !relatedResult.value.error && Array.isArray(relatedResult.value.data)) {
        setRelatedMatches((relatedResult.value.data as RelatedMatch[]).filter((item) => item.id !== excludeId).slice(0, 5));
      } else {
        setRelatedMatches([]);
      }

      if (
        recentResult.status === 'fulfilled' &&
        !('error' in recentResult.value && recentResult.value.error) &&
        Array.isArray((recentResult.value as { data?: unknown[] }).data)
      ) {
        setPlayerRecentMatches(
          ((recentResult.value as { data: RelatedMatch[] }).data || []).filter((item) => item.id !== excludeId).slice(0, 5),
        );
      } else {
        setPlayerRecentMatches([]);
      }

      if (tagResult.status === 'fulfilled' && Array.isArray(tagResult.value.data)) {
        setMatchEvents(
          (tagResult.value.data as Array<Record<string, unknown>>).map((item) => ({
            id: String(item.id || ''),
            tagId: String(item.tag_id || ''),
            tagName: String(item.tag_name || ''),
            tagCategory: String(item.tag_category || '未分类'),
            eventTime: Number(item.event_time || 0),
            videoTimestamp: typeof item.video_timestamp === 'number' ? item.video_timestamp : null,
            notes: String(item.notes || ''),
            isVerified: Boolean(item.is_verified),
            createdAt: String(item.created_at || new Date().toISOString()),
          })),
        );
      } else {
        setMatchEvents([]);
      }
    };

    const fetchMatch = async (silent = false) => {
      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      try {
        const rpc = await retrySupabaseOperation(() =>
          supabase.rpc('matchlife_get_match_detail', {
            p_match_ref: id,
          }),
        );

        let nextMatch: MatchDetailRow | null = null;

        if (!rpc.error) {
          const row = Array.isArray(rpc.data) ? rpc.data[0] : rpc.data;
          nextMatch = (row as MatchDetailRow | null) || null;
        } else if (!isMissingDetailRpcError(rpc.error)) {
          throw rpc.error;
        }

        if (!nextMatch) {
          const fallbackSelect =
            'id,canonical_match_id,source_match_id,tournament_name,players_a,players_b,score_text,start_time,location,city,winner_side,event_key,round_name,category,match_time_name,source_updated_at,match_started_at,match_ended_at,match_status,lifecycle_status,snapshot_version';
          const fallbackQuery = supabase
            .from('matches')
            .select(fallbackSelect)
            .order('snapshot_version', { ascending: false })
            .limit(1);
          const fallbackResponse = UUID_PATTERN.test(id)
            ? await fallbackQuery.eq('id', id).maybeSingle()
            : await fallbackQuery.eq('canonical_match_id', id).maybeSingle();

          if (fallbackResponse.error) throw fallbackResponse.error;
          if (fallbackResponse.data) {
            nextMatch = toFallbackDetail(fallbackResponse.data as MatchFallbackRow);
          }
        }

        if (!nextMatch) {
          throw new Error('比赛不存在');
        }

        if (cancelled) return;

        setMatch(nextMatch);
        setError(null);
        if (!silent) setLoading(false);
        void fetchSupportData(nextMatch);
      } catch (err) {
        if (cancelled) return;
        setError(getFriendlySupabaseErrorMessage(err));
        if (!silent) setLoading(false);
      } finally {
        if (!cancelled && silent) {
          setRefreshing(false);
        }
      }
    };

    void fetchMatch();

    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (!id || !match || !isPollingPreferred(match)) return;

    let cancelled = false;

    const refreshMatch = async () => {
      if (document.hidden || cancelled) return;
      setRefreshing(true);
      try {
        const rpc = await retrySupabaseOperation(() =>
          supabase.rpc('matchlife_get_match_detail', {
            p_match_ref: id,
          }),
        );
        if (rpc.error) throw rpc.error;
        const row = Array.isArray(rpc.data) ? rpc.data[0] : rpc.data;
        if (!row || cancelled) return;
        setMatch(row as MatchDetailRow);
      } catch {
        // Polling failures should not replace the current detail card.
      } finally {
        if (!cancelled) setRefreshing(false);
      }
    };

    const refreshIfVisible = () => {
      void refreshMatch();
    };
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        void refreshMatch();
      }
    };

    const timer = window.setInterval(refreshIfVisible, 5000);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [id, match]);

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '日期待定';
    return new Date(dateStr).toLocaleDateString('zh-CN');
  };

  const formatUpdateTime = (dateStr: string | null) => {
    if (!dateStr) return '未知';
    const now = Date.now();
    const updated = new Date(dateStr).getTime();
    const diffMs = now - updated;
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffHours < 1) return '刚刚';
    if (diffHours < 24) return `${diffHours}小时前`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}天前`;
  };

  const parseScore = (scoreText: string | null) => {
    if (!scoreText) return { setsA: 0, setsB: 0 };
    const sets = scoreText.split(',').map((value) => value.trim());
    let setsA = 0;
    let setsB = 0;
    sets.forEach((set) => {
      const [a, b] = set.split('-').map((value) => parseInt(value.trim(), 10));
      if (!isNaN(a) && !isNaN(b)) {
        if (a > b) setsA++;
        else if (b > a) setsB++;
      }
    });
    return { setsA, setsB };
  };

  const { setsA, setsB } = parseScore(match?.score_text ?? null);
  const eventSummary = useMemo(() => {
    const grouped = new Map<string, number>();
    matchEvents.forEach((event) => {
      const key = event.tagCategory || '未分类';
      grouped.set(key, (grouped.get(key) || 0) + 1);
    });
    return Array.from(grouped.entries())
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count);
  }, [matchEvents]);

  const timelineEvents = useMemo(
    () => [...matchEvents].sort((a, b) => a.eventTime - b.eventTime || a.createdAt.localeCompare(b.createdAt)),
    [matchEvents],
  );

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <Link to="/" className="inline-flex items-center space-x-2 text-brand-600 hover:text-brand-700 font-medium">
          <ArrowLeft className="w-4 h-4" />
          <span>返回搜索</span>
        </Link>
        <div className="bg-white/80 backdrop-blur-sm rounded-3xl shadow-sm border border-brand-100 p-8 text-center">
          <p className="text-text-sub">加载中...</p>
        </div>
      </div>
    );
  }

  if (error || !match) {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <Link to="/" className="inline-flex items-center space-x-2 text-brand-600 hover:text-brand-700 font-medium">
          <ArrowLeft className="w-4 h-4" />
          <span>返回搜索</span>
        </Link>
        <div className="bg-white/80 backdrop-blur-sm rounded-3xl shadow-sm border border-brand-100 p-8 text-center">
          <p className="text-red-500">{error || '比赛不存在'}</p>
        </div>
      </div>
    );
  }

  const playerANames = match.players_a.join('/');
  const playerBNames = match.players_b.join('/');
  const effectiveWinner = resolveWinnerSide(match);
  const isPlayerAWinner = effectiveWinner === 'A';
  const isPlayerBWinner = effectiveWinner === 'B';
  const baseUrl = import.meta.env.BASE_URL || '/';
  const detailPath = buildMatchDetailPath(getPreferredMatchDetailRef(match));
  const fullUrl = `${window.location.origin}${baseUrl}${detailPath.replace(/^\//, '')}`.replace(/([^:]\/)\/+/g, '$1');
  const taggingPath = match.persisted_match_id ? buildMatchTaggingPath(match.persisted_match_id) : null;
  const shouldPoll = isPollingPreferred(match);

  const shareData: MatchShareData = {
    type: 'match',
    tournamentName: match.tournament_name,
    playerA: playerANames,
    playerB: playerBNames,
    score: match.score_text || '进行中',
    date: new Date(match.start_time || match.source_updated_at || Date.now()).toLocaleDateString('zh-CN'),
    eventKey: match.event_key,
    winnerSide: (match.winner_side || 'UNKNOWN') as 'A' | 'B' | 'UNKNOWN',
    qrCodeUrl: fullUrl,
  };

  const shareUrl = fullUrl;
  const shareTitle = `${match.tournament_name} - ${playerANames} vs ${playerBNames}`;
  const shareDesc = `比分：${match.score_text || '进行中'} | 七笑果 MatchLife`;

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
          分享
        </button>
        {taggingPath ? (
          <Link
            to={taggingPath}
            className="inline-flex items-center gap-2 px-4 py-2 border border-orange-200 text-orange-700 font-bold rounded-full bg-white hover:bg-orange-50 transition-all"
          >
            <Tags className="w-4 h-4" />
            补充比赛笔记
          </Link>
        ) : (
          <button
            type="button"
            disabled
            className="inline-flex items-center gap-2 px-4 py-2 border border-gray-200 text-gray-400 font-bold rounded-full bg-gray-50 cursor-not-allowed"
          >
            <Tags className="w-4 h-4" />
            结果确认后可补充
          </button>
        )}
      </div>

      <div className="bg-white/80 backdrop-blur-sm rounded-3xl shadow-sm border border-brand-100 p-8">
        <div className="flex flex-col md:flex-row justify-between items-center gap-6 mb-8 border-b border-brand-100 pb-8">
          <div className="text-center md:text-left">
            <div className="mb-3 flex flex-wrap items-center justify-center gap-2 md:justify-start">
              {match.event_key && (
                <span className="inline-block px-3 py-1 bg-accent-yellow/20 text-text-main rounded-full text-xs font-bold">
                  {match.event_key}
                </span>
              )}
              {match.round_name && (
                <span className="inline-block px-3 py-1 bg-orange-50 text-orange-700 rounded-full text-xs font-bold">
                  {match.round_name}
                </span>
              )}
            </div>
            <h1 className="text-2xl md:text-3xl font-extrabold text-text-main mb-2">{match.tournament_name}</h1>
            <div className="flex items-center justify-center md:justify-start space-x-4 text-text-sub text-sm">
              <span className="flex items-center space-x-1">
                <Calendar className="w-4 h-4" />
                <span>{formatDate(match.start_time)}</span>
              </span>
              {(match.location || match.city) && (
                <span className="flex items-center space-x-1">
                  <MapPin className="w-4 h-4" />
                  <span>{match.location || match.city}</span>
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-col items-center gap-2">
            <span className="text-sm text-text-sub mb-1">来源平台更新</span>
            <span className="text-brand-600 font-medium">{formatUpdateTime(match.source_updated_at)}</span>
            {shouldPoll && (
              <div className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-3 py-1 text-xs font-bold text-orange-700">
                <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                {refreshing ? '轮询刷新中' : '每 5 秒轮询'}
              </div>
            )}
          </div>
        </div>

        <div className="my-12 grid grid-cols-1 items-start gap-8 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:gap-10">
          <div className="flex min-w-0 flex-col items-center text-center">
            <div className={`w-24 h-24 ${isPlayerAWinner ? 'bg-gradient-to-br from-brand-100 to-brand-200' : 'bg-gray-100'} rounded-full flex items-center justify-center text-2xl font-bold ${isPlayerAWinner ? 'text-brand-800' : 'text-gray-600'} shadow-inner mb-4 relative`}>
              {playerANames.split('/')[0].slice(0, 1)}
              {isPlayerAWinner && (
                <div className="absolute -top-2 -right-2 bg-accent-yellow text-gray-900 p-1.5 rounded-full shadow-sm">
                  <Trophy className="w-4 h-4" />
                </div>
              )}
            </div>
            <Link to={`/player/${encodeURIComponent(playerANames)}`} className="max-w-full break-words text-lg font-bold leading-7 text-text-main transition-colors hover:text-brand-600">
              {playerANames}
            </Link>
            {isPlayerAWinner && <span className="text-green-500 font-medium text-sm mt-1">胜者</span>}
          </div>

          <div className="flex flex-col items-center justify-center space-y-2 md:px-2">
            <div className="text-center text-4xl font-black tracking-wider text-brand-600 sm:text-5xl">{setsA} : {setsB}</div>
            {match.score_text && (
              <div className="max-w-[18rem] text-center text-base font-medium leading-6 text-text-sub sm:text-lg">{match.score_text}</div>
            )}
            <div className={`px-4 py-1 rounded-full text-sm font-bold mt-2 ${effectiveWinner === 'UNKNOWN' ? 'bg-orange-50 text-orange-700' : 'bg-emerald-50 text-emerald-700'}`}>
              {effectiveWinner === 'UNKNOWN' ? '比赛进行中' : '比赛已结束'}
            </div>
            {(match.match_time_name || match.match_started_at || match.match_ended_at) && (
              <div className="text-xs text-brand-gray text-center">
                {match.match_time_name || '实时赛程'}
                {match.match_started_at ? ` · 开始 ${formatDate(match.match_started_at)}` : ''}
                {match.match_ended_at ? ` · 结束 ${formatDate(match.match_ended_at)}` : ''}
              </div>
            )}
          </div>

          <div className="flex min-w-0 flex-col items-center text-center">
            <div className={`w-24 h-24 ${isPlayerBWinner ? 'bg-gradient-to-br from-brand-100 to-brand-200' : 'bg-gray-100'} rounded-full flex items-center justify-center text-2xl font-bold ${isPlayerBWinner ? 'text-brand-800' : 'text-gray-600'} shadow-inner mb-4 relative`}>
              {playerBNames.split('/')[0].slice(0, 1)}
              {isPlayerBWinner && (
                <div className="absolute -top-2 -right-2 bg-accent-yellow text-gray-900 p-1.5 rounded-full shadow-sm">
                  <Trophy className="w-4 h-4" />
                </div>
              )}
            </div>
            <Link to={`/player/${encodeURIComponent(playerBNames)}`} className="max-w-full break-words text-lg font-bold leading-7 text-text-main transition-colors hover:text-brand-600">
              {playerBNames}
            </Link>
            {isPlayerBWinner && <span className="text-green-500 font-medium text-sm mt-1">胜者</span>}
          </div>
        </div>
      </div>

      {matchEvents.length === 0 ? (
        <div className="bg-white/80 backdrop-blur-sm rounded-3xl shadow-sm border border-dashed border-orange-200 p-12 text-center flex flex-col items-center justify-center">
          <div className="w-16 h-16 bg-orange-50 rounded-full flex items-center justify-center mb-4">
            <Activity className="w-8 h-8 text-orange-400" />
          </div>
          <h3 className="text-xl font-bold text-brand-800 mb-2">暂无过程数据</h3>
          <p className="text-brand-gray max-w-md mb-6">
            {taggingPath
              ? '当前比赛还没有补充更多记录。您可以点击下方按钮，补充关键回合、时间点和比赛笔记。'
              : '当前比赛结果确认后，可以继续补充这场比赛的更多记录。'}
          </p>
          {taggingPath ? (
            <Link
              to={taggingPath}
              className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-orange-400 to-orange-500 text-white font-bold rounded-full shadow hover:shadow-lg transition-all"
            >
              <Tags className="w-4 h-4" />
              去补充比赛笔记
            </Link>
          ) : (
            <div className="inline-flex items-center gap-2 px-6 py-3 bg-gray-100 text-gray-500 font-bold rounded-full">
              <Tags className="w-4 h-4" />
              结果确认后开放
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[0.95fr,1.05fr] gap-6">
          <div className="bg-white/80 backdrop-blur-sm rounded-3xl shadow-sm border border-brand-100 p-8 flex flex-col">
            <h2 className="text-xl font-bold text-text-main mb-6 flex items-center gap-2">
              <Activity className="w-5 h-5 text-orange-500" />
              过程数据概览
            </h2>
            <div className="space-y-6 flex-1">
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-2xl bg-gradient-to-br from-orange-50 to-white px-5 py-5 border border-orange-100 shadow-sm relative overflow-hidden">
                  <div className="absolute -right-2 -top-2 opacity-5">
                    <Activity className="w-16 h-16" />
                  </div>
                  <div className="text-sm font-medium text-brand-gray mb-1">标签总数</div>
                  <div className="text-4xl font-black text-orange-600">{matchEvents.length}</div>
                </div>
                <div className="rounded-2xl bg-gradient-to-br from-green-50 to-white px-5 py-5 border border-green-100 shadow-sm relative overflow-hidden">
                  <div className="absolute -right-2 -top-2 opacity-5">
                    <Tags className="w-16 h-16" />
                  </div>
                  <div className="text-sm font-medium text-brand-gray mb-1">已验证标签</div>
                  <div className="text-4xl font-black text-green-600">
                    {matchEvents.filter((event) => event.isVerified).length}
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-bold text-brand-gray mb-3 px-1">标签分类统计</h3>
                <div className="space-y-3">
                  {eventSummary.map((item) => (
                    <div key={item.category} className="group relative flex items-center justify-between rounded-2xl border border-orange-100/50 bg-white px-5 py-3.5 hover:border-orange-200 hover:shadow-sm transition-all overflow-hidden">
                      <div className="absolute left-0 top-0 bottom-0 bg-orange-50 transition-all duration-500 -z-10" style={{ width: `${Math.max(10, (item.count / matchEvents.length) * 100)}%` }} />
                      <div className="z-10">
                        <div className="font-bold text-brand-brown">{item.category}</div>
                        <div className="text-xs text-brand-gray/80 mt-0.5">{((item.count / matchEvents.length) * 100).toFixed(0)}% 占比</div>
                      </div>
                      <div className="text-2xl font-black text-orange-500 z-10">{item.count}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white/80 backdrop-blur-sm rounded-3xl shadow-sm border border-brand-100 p-8 flex flex-col">
            <h2 className="text-xl font-bold text-text-main mb-6 flex items-center gap-2">
              <Tags className="w-5 h-5 text-orange-500" />
              比赛事件时间轴
            </h2>
            <div className="space-y-0 relative before:absolute before:inset-0 before:ml-[1.4rem] before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-orange-200 before:to-transparent max-h-[520px] overflow-y-auto pr-2 custom-scrollbar">
              {timelineEvents.map((event, index) => (
                <div key={event.id} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active mb-6 last:mb-0">
                  <div className="flex items-center justify-center w-8 h-8 rounded-full border-4 border-white bg-orange-400 text-white shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 absolute left-0 md:left-1/2 -translate-x-1/2 z-10">
                    <span className="text-[10px] font-bold">{index + 1}</span>
                  </div>

                  <div className="w-[calc(100%-3rem)] md:w-[calc(50%-2rem)] ml-12 md:ml-0 rounded-2xl border border-orange-100 bg-white p-4 shadow-sm hover:shadow-md transition-shadow">
                    <div className="flex items-start justify-between mb-1">
                      <div className="font-bold text-brand-brown text-base">{event.tagName}</div>
                      <div className="text-xs font-bold px-2 py-1 bg-orange-50 text-orange-600 rounded-md">
                        {event.videoTimestamp !== null ? `${event.videoTimestamp}s` : event.tagCategory}
                      </div>
                    </div>
                    <div className="text-xs text-brand-gray mb-2">
                      {new Date(event.createdAt).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </div>
                    {event.notes && (
                      <div className="mt-2 rounded-xl bg-gray-50 px-3 py-2 text-sm text-brand-brown/80 border border-gray-100">
                        {event.notes}
                      </div>
                    )}
                    {event.isVerified && (
                      <div className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-green-600">
                        <div className="w-1.5 h-1.5 rounded-full bg-green-500"></div>已验证
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {relatedMatches.length > 0 && (
        <div className="bg-white/80 backdrop-blur-sm rounded-3xl shadow-sm border border-brand-100 p-8">
          <h2 className="text-xl font-bold text-text-main mb-4">同赛事更多比赛</h2>
          <div className="space-y-3">
            {relatedMatches.map((item) => (
              <Link
                key={item.id}
                to={buildMatchDetailPath(getPreferredMatchDetailRef(item))}
                className="block p-4 rounded-2xl border border-brand-100 hover:border-brand-300 hover:shadow-md transition-all"
              >
                <div className="flex justify-between items-center">
                  <div className="flex-1">
                    <div className="text-sm text-text-sub mb-1">
                      {item.start_time ? formatDate(item.start_time) : '日期待定'}
                    </div>
                    <div className="font-medium text-text-main">
                      {item.players_a.join('/')} vs {item.players_b.join('/')}
                    </div>
                  </div>
                  <div className="text-lg font-bold text-brand-600">
                    {item.score_text || '-'}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {playerRecentMatches.length > 0 && (
        <div className="bg-white/80 backdrop-blur-sm rounded-3xl shadow-sm border border-brand-100 p-8">
          <h2 className="text-xl font-bold text-text-main mb-4">选手近期比赛</h2>
          <div className="space-y-3">
            {playerRecentMatches.map((item) => (
              <Link
                key={item.id}
                to={buildMatchDetailPath(getPreferredMatchDetailRef(item))}
                className="block p-4 rounded-2xl border border-brand-100 hover:border-brand-300 hover:shadow-md transition-all"
              >
                <div className="flex justify-between items-center">
                  <div className="flex-1">
                    <div className="text-sm text-text-sub mb-1">
                      {item.tournament_name}
                    </div>
                    <div className="font-medium text-text-main">
                      {item.players_a.join('/')} vs {item.players_b.join('/')}
                    </div>
                    <div className="text-xs text-text-sub mt-1">
                      {item.start_time ? formatDate(item.start_time) : '日期待定'}
                    </div>
                  </div>
                  <div className="text-lg font-bold text-brand-600">
                    {item.score_text || '-'}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

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
