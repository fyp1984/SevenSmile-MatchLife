import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Calendar, MapPin, Trophy, Share2, Tags, Activity } from "lucide-react";
import { supabase } from "../lib/supabase";
import ShareModal from "../components/ShareModal";
import type { MatchShareData } from "../lib/shareCard";
import { resolveWinnerSide } from "../lib/matchResults";

interface Match {
  id: string;
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

export function MatchDetail() {
  const { id } = useParams<{ id: string }>();
  const [match, setMatch] = useState<Match | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [relatedMatches, setRelatedMatches] = useState<Match[]>([]);
  const [playerRecentMatches, setPlayerRecentMatches] = useState<Match[]>([]);
  const [matchEvents, setMatchEvents] = useState<MatchTagEvent[]>([]);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);

  useEffect(() => {
    async function fetchMatch() {
      if (!id) {
        setError("比赛 ID 缺失");
        setLoading(false);
        return;
      }

      try {
        const { data, error: fetchError } = await supabase
          .from("matches")
          .select("*")
          .eq("id", id)
          .single();

        if (fetchError) throw fetchError;
        if (!data) throw new Error("比赛不存在");

        setMatch(data);
        setLoading(false);

        const allPlayers = [...data.players_a, ...data.players_b].filter(Boolean);
        const playerOrFilters = allPlayers.map((player) => `players_text.ilike.%${player.replace(/[%(),]/g, '')}%`).join(',');

        const [relatedResult, recentResult, tagResult] = await Promise.allSettled([
          supabase
            .from("matches")
            .select("id,tournament_name,players_a,players_b,score_text,start_time,location,winner_side,event_key,round_name,source_updated_at")
            .eq("tournament_name", data.tournament_name)
            .neq("id", data.id)
            .order("start_time", { ascending: false })
            .limit(5),
          playerOrFilters
            ? supabase
                .from("matches")
                .select("id,tournament_name,players_a,players_b,score_text,start_time,location,winner_side,event_key,round_name,source_updated_at")
                .or(playerOrFilters)
                .neq("id", data.id)
                .order("start_time", { ascending: false })
                .limit(5)
            : Promise.resolve({ data: [], error: null }),
          supabase.rpc('matchlife_list_match_tags', {
            p_match_id: data.id,
          }),
        ]);

        if (relatedResult.status === 'fulfilled' && !relatedResult.value.error && relatedResult.value.data) {
          setRelatedMatches(relatedResult.value.data as Match[]);
        }

        if (recentResult.status === 'fulfilled' && !('error' in recentResult.value && recentResult.value.error) && Array.isArray((recentResult.value as { data?: unknown[] }).data)) {
          setPlayerRecentMatches((recentResult.value as { data: Match[] }).data);
        }

        if (tagResult.status === 'fulfilled' && tagResult.value.data) {
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
            }))
          );
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "加载失败");
        setLoading(false);
      }
    }

    fetchMatch();
  }, [id]);

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "日期待定";
    return new Date(dateStr).toLocaleDateString("zh-CN");
  };

  const formatUpdateTime = (dateStr: string | null) => {
    if (!dateStr) return "未知";
    const now = Date.now();
    const updated = new Date(dateStr).getTime();
    const diffMs = now - updated;
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffHours < 1) return "刚刚";
    if (diffHours < 24) return `${diffHours}小时前`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}天前`;
  };

  const parseScore = (scoreText: string | null) => {
    if (!scoreText) return { setsA: 0, setsB: 0 };
    const sets = scoreText.split(",").map(s => s.trim());
    let setsA = 0, setsB = 0;
    sets.forEach(set => {
      const [a, b] = set.split("-").map(n => parseInt(n.trim()));
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
          <p className="text-red-500">{error || "比赛不存在"}</p>
        </div>
      </div>
    );
  }

  const playerANames = match.players_a.join("/");
  const playerBNames = match.players_b.join("/");
  const effectiveWinner = resolveWinnerSide(match);
  const isPlayerAWinner = effectiveWinner === "A";
  const isPlayerBWinner = effectiveWinner === "B";

  const baseUrl = import.meta.env.BASE_URL || '/';
  const fullUrl = `${window.location.origin}${baseUrl}matches/${match.id}`.replace(/([^:]\/)\/+/g, '$1');
  
  const shareData: MatchShareData = {
    type: 'match',
    tournamentName: match.tournament_name,
    playerA: playerANames,
    playerB: playerBNames,
    score: match.score_text || '进行中',
    date: new Date((match as any).match_date || (match as any).created_at || Date.now()).toLocaleDateString('zh-CN'),
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
        <Link
          to={`/matches/${match.id}/tagging`}
          className="inline-flex items-center gap-2 px-4 py-2 border border-orange-200 text-orange-700 font-bold rounded-full bg-white hover:bg-orange-50 transition-all"
        >
          <Tags className="w-4 h-4" />
          录入过程标签
        </Link>
      </div>

      <div className="bg-white/80 backdrop-blur-sm rounded-3xl shadow-sm border border-brand-100 p-8">
        <div className="flex flex-col md:flex-row justify-between items-center gap-6 mb-8 border-b border-brand-100 pb-8">
          <div className="text-center md:text-left">
            {match.event_key && (
              <span className="inline-block px-3 py-1 bg-accent-yellow/20 text-text-main rounded-full text-xs font-bold mb-3">
                {match.event_key}
              </span>
            )}
            <h1 className="text-2xl md:text-3xl font-extrabold text-text-main mb-2">{match.tournament_name}</h1>
            <div className="flex items-center justify-center md:justify-start space-x-4 text-text-sub text-sm">
              <span className="flex items-center space-x-1">
                <Calendar className="w-4 h-4" />
                <span>{formatDate(match.start_time)}</span>
              </span>
              {match.location && (
                <span className="flex items-center space-x-1">
                  <MapPin className="w-4 h-4" />
                  <span>{match.location}</span>
                </span>
              )}
            </div>
          </div>
          
          <div className="flex flex-col items-center">
            <span className="text-sm text-text-sub mb-1">来源平台更新</span>
            <span className="text-brand-600 font-medium">{formatUpdateTime(match.source_updated_at)}</span>
          </div>
        </div>

        <div className="my-12 grid grid-cols-1 items-start gap-8 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:gap-10">
          <div className="flex min-w-0 flex-col items-center text-center">
            <div className={`w-24 h-24 ${isPlayerAWinner ? 'bg-gradient-to-br from-brand-100 to-brand-200' : 'bg-gray-100'} rounded-full flex items-center justify-center text-2xl font-bold ${isPlayerAWinner ? 'text-brand-800' : 'text-gray-600'} shadow-inner mb-4 relative`}>
              {playerANames.split("/")[0].slice(0, 1)}
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
            <div className="px-4 py-1 bg-brand-50 text-brand-600 rounded-full text-sm font-bold mt-2">
              {effectiveWinner === "UNKNOWN" ? "进行中" : "已完赛"}
            </div>
          </div>

          <div className="flex min-w-0 flex-col items-center text-center">
            <div className={`w-24 h-24 ${isPlayerBWinner ? 'bg-gradient-to-br from-brand-100 to-brand-200' : 'bg-gray-100'} rounded-full flex items-center justify-center text-2xl font-bold ${isPlayerBWinner ? 'text-brand-800' : 'text-gray-600'} shadow-inner mb-4 relative`}>
              {playerBNames.split("/")[0].slice(0, 1)}
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
            当前比赛还没有录入任何过程标签。您可以点击下方按钮，为这场比赛补充技战术事件、关键回合和视频时间戳，让比赛数据更加丰富立体。
          </p>
          <Link
            to={`/matches/${match.id}/tagging`}
            className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-orange-400 to-orange-500 text-white font-bold rounded-full shadow hover:shadow-lg transition-all"
          >
            <Tags className="w-4 h-4" />
            去录入过程标签
          </Link>
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
                        <div className="text-xs text-brand-gray/80 mt-0.5">{(item.count / matchEvents.length * 100).toFixed(0)}% 占比</div>
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

      {/* 同赛事更多比赛 */}
      {relatedMatches.length > 0 && (
        <div className="bg-white/80 backdrop-blur-sm rounded-3xl shadow-sm border border-brand-100 p-8">
          <h2 className="text-xl font-bold text-text-main mb-4">同赛事更多比赛</h2>
          <div className="space-y-3">
            {relatedMatches.map((m) => (
              <Link
                key={m.id}
                to={`/matches/${m.id}`}
                className="block p-4 rounded-2xl border border-brand-100 hover:border-brand-300 hover:shadow-md transition-all"
              >
                <div className="flex justify-between items-center">
                  <div className="flex-1">
                    <div className="text-sm text-text-sub mb-1">
                      {m.start_time ? formatDate(m.start_time) : "日期待定"}
                    </div>
                    <div className="font-medium text-text-main">
                      {m.players_a.join("/")} vs {m.players_b.join("/")}
                    </div>
                  </div>
                  <div className="text-lg font-bold text-brand-600">
                    {m.score_text || "-"}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* 选手近期比赛 */}
      {playerRecentMatches.length > 0 && (
        <div className="bg-white/80 backdrop-blur-sm rounded-3xl shadow-sm border border-brand-100 p-8">
          <h2 className="text-xl font-bold text-text-main mb-4">选手近期比赛</h2>
          <div className="space-y-3">
            {playerRecentMatches.map((m) => (
              <Link
                key={m.id}
                to={`/matches/${m.id}`}
                className="block p-4 rounded-2xl border border-brand-100 hover:border-brand-300 hover:shadow-md transition-all"
              >
                <div className="flex justify-between items-center">
                  <div className="flex-1">
                    <div className="text-sm text-text-sub mb-1">
                      {m.tournament_name}
                    </div>
                    <div className="font-medium text-text-main">
                      {m.players_a.join("/")} vs {m.players_b.join("/")}
                    </div>
                    <div className="text-xs text-text-sub mt-1">
                      {m.start_time ? formatDate(m.start_time) : "日期待定"}
                    </div>
                  </div>
                  <div className="text-lg font-bold text-brand-600">
                    {m.score_text || "-"}
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
