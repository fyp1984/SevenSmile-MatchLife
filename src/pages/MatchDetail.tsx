import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Calendar, MapPin, Trophy } from "lucide-react";
import { supabase } from "../lib/supabase";

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

export function MatchDetail() {
  const { id } = useParams<{ id: string }>();
  const [match, setMatch] = useState<Match | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [relatedMatches, setRelatedMatches] = useState<Match[]>([]);
  const [playerRecentMatches, setPlayerRecentMatches] = useState<Match[]>([]);

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

        // 获取同赛事更多比赛
        const { data: related } = await supabase
          .from("matches")
          .select("*")
          .eq("tournament_name", data.tournament_name)
          .neq("id", data.id)
          .order("start_time", { ascending: false })
          .limit(5);
        
        if (related) setRelatedMatches(related);

        // 获取选手近期比赛（包含任一选手）
        const allPlayers = [...data.players_a, ...data.players_b];
        if (allPlayers.length > 0) {
          const { data: recent } = await supabase
            .from("matches")
            .select("*")
            .or(allPlayers.map(p => `players_a.cs.{${p}},players_b.cs.{${p}}`).join(','))
            .neq("id", data.id)
            .order("start_time", { ascending: false })
            .limit(5);
          
          if (recent) setPlayerRecentMatches(recent);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "加载失败");
      } finally {
        setLoading(false);
      }
    }

    fetchMatch();
  }, [id]);

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
  const isPlayerAWinner = match.winner_side === "A";
  const isPlayerBWinner = match.winner_side === "B";
  
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

  const { setsA, setsB } = parseScore(match.score_text);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <Link to="/" className="inline-flex items-center space-x-2 text-brand-600 hover:text-brand-700 font-medium">
        <ArrowLeft className="w-4 h-4" />
        <span>返回搜索</span>
      </Link>

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

        <div className="flex flex-col md:flex-row items-center justify-center gap-8 md:gap-16 my-12">
          <div className="flex flex-col items-center">
            <div className={`w-24 h-24 ${isPlayerAWinner ? 'bg-gradient-to-br from-brand-100 to-brand-200' : 'bg-gray-100'} rounded-full flex items-center justify-center text-2xl font-bold ${isPlayerAWinner ? 'text-brand-800' : 'text-gray-600'} shadow-inner mb-4 relative`}>
              {playerANames.split("/")[0].slice(0, 2)}
              {isPlayerAWinner && (
                <div className="absolute -top-2 -right-2 bg-accent-yellow text-white p-1.5 rounded-full shadow-sm">
                  <Trophy className="w-4 h-4" />
                </div>
              )}
            </div>
            <Link to={`/player/${encodeURIComponent(playerANames)}`} className="text-lg font-bold text-text-main hover:text-brand-600 transition-colors">{playerANames}</Link>
            {isPlayerAWinner && <span className="text-green-500 font-medium text-sm mt-1">胜者</span>}
          </div>

          <div className="flex flex-col items-center space-y-2">
            <div className="text-5xl font-black text-brand-600 tracking-wider">{setsA} : {setsB}</div>
            {match.score_text && (
              <div className="text-text-sub font-medium text-lg">{match.score_text}</div>
            )}
            <div className="px-4 py-1 bg-brand-50 text-brand-600 rounded-full text-sm font-bold mt-2">
              {match.winner_side === "UNKNOWN" ? "进行中" : "已完赛"}
            </div>
          </div>

          <div className="flex flex-col items-center">
            <div className={`w-24 h-24 ${isPlayerBWinner ? 'bg-gradient-to-br from-brand-100 to-brand-200' : 'bg-gray-100'} rounded-full flex items-center justify-center text-2xl font-bold ${isPlayerBWinner ? 'text-brand-800' : 'text-gray-600'} shadow-inner mb-4 relative`}>
              {playerBNames.split("/")[0].slice(0, 2)}
              {isPlayerBWinner && (
                <div className="absolute -top-2 -right-2 bg-accent-yellow text-white p-1.5 rounded-full shadow-sm">
                  <Trophy className="w-4 h-4" />
                </div>
              )}
            </div>
            <Link to={`/player/${encodeURIComponent(playerBNames)}`} className="text-lg font-bold text-text-main hover:text-brand-600 transition-colors">{playerBNames}</Link>
            {isPlayerBWinner && <span className="text-green-500 font-medium text-sm mt-1">胜者</span>}
          </div>
        </div>
      </div>

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
    </div>
  );
}
