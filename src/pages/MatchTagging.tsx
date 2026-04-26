import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  Tag, Clock, Video, Save, Trash2, Edit2, CheckCircle, 
  Award, TrendingUp, Trophy, Loader2, Play, Pause 
} from 'lucide-react';
import { useTagStore } from '../stores/tagStore';
import { supabase } from '../lib/supabase';
import { format } from 'date-fns';
import { getLocalContributorId } from '../lib/localContributor';

type Match = {
  id: string;
  tournament_name: string;
  players_a: string[];
  players_b: string[];
  category: string;
  start_time: string | null;
};

export default function MatchTagging() {
  const { matchId } = useParams<{ matchId: string }>();
  const navigate = useNavigate();
  
  const {
    mode,
    tags,
    availableTags,
    userReputation,
    loading,
    error,
    setMode,
    setCurrentMatch,
    loadAvailableTags,
    loadUserReputation,
    loadMatchTags,
    addTag,
    updateTag,
    deleteTag,
    clearTags,
  } = useTagStore();

  const [match, setMatch] = useState<Match | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [videoTimestamp, setVideoTimestamp] = useState<number | null>(null);
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (!matchId) return;

    let cancelled = false;
    clearTags();
    setInitializing(true);

    const init = async () => {
      setCurrentMatch(matchId);
      await Promise.allSettled([
        loadMatchDetails(),
        loadAvailableTags('badminton'),
        loadMatchTags(matchId),
        loadUserReputationData(),
      ]);
      if (!cancelled) {
        setInitializing(false);
      }
    };

    void init();

    return () => {
      cancelled = true;
      clearTags();
      setInitializing(true);
    };
  }, [matchId, clearTags, loadAvailableTags, loadMatchTags, loadUserReputation, setCurrentMatch]);

  const loadMatchDetails = async () => {
    if (!matchId) return;
    
    const { data, error } = await supabase
      .from('matches')
      .select('id, tournament_name, players_a, players_b, category, start_time')
      .eq('id', matchId)
      .single();

    if (error) {
      console.error('Failed to load match:', error);
      return;
    }

    setMatch(data);
  };

  const loadUserReputationData = async () => {
    await loadUserReputation(getLocalContributorId());
  };

  const handleAddTag = async () => {
    if (selectedTagIds.length === 0) return;

    for (const tagId of selectedTagIds) {
      await addTag({
        tagId,
        eventTime: new Date().toISOString(),
        videoTimestamp,
        notes,
      });
    }

    setSelectedTagIds([]);
    setNotes('');
    setVideoTimestamp(null);
  };

  const toggleTagSelection = (tagId: string) => {
    setSelectedTagIds((prev) => 
      prev.includes(tagId) ? prev.filter(id => id !== tagId) : [...prev, tagId]
    );
  };

  const handleSaveEdit = async (tagId: string) => {
    await updateTag(tagId, {
      notes,
      videoTimestamp,
    });
    setEditingTagId(null);
    setNotes('');
    setVideoTimestamp(null);
  };

  const filteredTags = availableTags.filter((tag) =>
    searchQuery.trim()
      ? tag.tag_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        tag.tag_category.toLowerCase().includes(searchQuery.toLowerCase())
      : true
  );

  const groupedTags = filteredTags.reduce((acc, tag) => {
    if (!acc[tag.tag_category]) {
      acc[tag.tag_category] = [];
    }
    acc[tag.tag_category].push(tag);
    return acc;
  }, {} as Record<string, typeof availableTags>);

  if (initializing || !match) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center space-y-3">
          <Loader2 className="w-8 h-8 animate-spin text-orange-500 mx-auto" />
          <div className="text-sm font-medium text-brand-gray">正在加载比赛标签面板...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center pt-6 pb-20 w-full max-w-6xl mx-auto px-4">
      <div className="w-full mb-8">
        <button
          onClick={() => navigate(-1)}
          className="mb-4 text-orange-600 hover:text-orange-700 font-bold flex items-center gap-2"
        >
          ← 返回
        </button>
        
        <div className="bg-white/80 backdrop-blur-sm rounded-3xl p-6 border border-orange-100 shadow-sm">
          <h1 className="text-2xl font-extrabold text-brand-brown mb-2">
            {match.tournament_name}
          </h1>
          <div className="flex flex-wrap items-center gap-4 text-brand-gray">
            <span className="px-3 py-1 bg-orange-100 text-orange-700 rounded-full text-sm font-bold">
              {match.category}
            </span>
            <span className="font-medium">
              {match.players_a.join(' / ')} vs {match.players_b.join(' / ')}
            </span>
            {match.start_time && (
              <span className="text-sm">
                {format(new Date(match.start_time), 'yyyy-MM-dd HH:mm')}
              </span>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="w-full mb-6 bg-red-50 border border-red-200 text-red-700 px-6 py-4 rounded-3xl text-sm font-medium">
          {error}
        </div>
      )}

      <div className="w-full grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <div className="bg-white/80 backdrop-blur-sm rounded-3xl p-6 border border-orange-100 shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-2xl bg-orange-100 flex items-center justify-center">
              <Award className="w-6 h-6 text-orange-500" />
            </div>
            <div>
              <div className="text-sm text-brand-gray">信誉等级</div>
              <div className="text-xl font-extrabold text-brand-brown">
                {userReputation?.reputation_level || 'beginner'}
              </div>
            </div>
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-brand-gray">总标签数</span>
              <span className="font-bold text-brand-brown">{userReputation?.total_tags || 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-brand-gray">已验证</span>
              <span className="font-bold text-green-600">{userReputation?.verified_tags || 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-brand-gray">准确率</span>
              <span className="font-bold text-orange-600">
                {((userReputation?.accuracy_score || 0) * 100).toFixed(1)}%
              </span>
            </div>
          </div>
        </div>

        <div className="bg-white/80 backdrop-blur-sm rounded-3xl p-6 border border-orange-100 shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-2xl bg-yellow-100 flex items-center justify-center">
              <Trophy className="w-6 h-6 text-yellow-600" />
            </div>
            <div>
              <div className="text-sm text-brand-gray">积分</div>
              <div className="text-xl font-extrabold text-brand-brown">
                {userReputation?.total_points || 0}
              </div>
            </div>
          </div>
          <div className="text-sm text-brand-gray">
            当前环境支持匿名记录员录入，保存后会累计到本地信誉分
          </div>
        </div>

        <div className="bg-white/80 backdrop-blur-sm rounded-3xl p-6 border border-orange-100 shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-2xl bg-blue-100 flex items-center justify-center">
              <TrendingUp className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <div className="text-sm text-brand-gray">录入模式</div>
              <div className="text-xl font-extrabold text-brand-brown">
                {mode === 'realtime' ? '实时录入' : '赛后补录'}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setMode('realtime')}
              className={`flex-1 px-3 py-2 rounded-xl text-sm font-bold transition-all ${
                mode === 'realtime'
                  ? 'bg-gradient-to-r from-orange-500 to-red-500 text-white'
                  : 'bg-white border border-orange-200 text-orange-700 hover:bg-orange-50'
              }`}
            >
              <Play className="w-4 h-4 inline mr-1" />
              实时
            </button>
            <button
              onClick={() => setMode('replay')}
              className={`flex-1 px-3 py-2 rounded-xl text-sm font-bold transition-all ${
                mode === 'replay'
                  ? 'bg-gradient-to-r from-orange-500 to-red-500 text-white'
                  : 'bg-white border border-orange-200 text-orange-700 hover:bg-orange-50'
              }`}
            >
              <Pause className="w-4 h-4 inline mr-1" />
              补录
            </button>
          </div>
        </div>
      </div>

      <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white/80 backdrop-blur-sm rounded-3xl p-6 border border-orange-100 shadow-sm">
          <h2 className="text-xl font-bold text-brand-brown mb-4 flex items-center gap-2">
            <Tag className="w-5 h-5 text-orange-500" />
            添加标签
          </h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-bold text-brand-brown mb-2">
                搜索标签
              </label>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索技术标签..."
                className="w-full px-4 py-3 rounded-2xl border border-orange-100 bg-white text-brand-brown outline-none focus:border-orange-300 placeholder-orange-300"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-bold text-brand-brown">
                  选择标签 <span className="text-xs text-brand-gray font-normal ml-1">支持组合多选</span>
                </label>
                {selectedTagIds.length > 0 && (
                  <button 
                    onClick={() => setSelectedTagIds([])}
                    className="text-xs font-bold text-orange-600 hover:text-orange-700"
                  >
                    清空已选 ({selectedTagIds.length})
                  </button>
                )}
              </div>
              <div className="max-h-64 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
                {Object.entries(groupedTags).map(([category, categoryTags]) => (
                  <div key={category} className="space-y-1">
                    <div className="text-xs font-bold text-orange-600 px-2 py-1 bg-orange-50 rounded-lg">
                      {category}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {categoryTags.map((tag) => (
                        <button
                          key={tag.id}
                          onClick={() => toggleTagSelection(tag.id)}
                          className={`w-full text-left px-3 py-2 rounded-xl transition-all text-sm truncate ${
                            selectedTagIds.includes(tag.id)
                              ? 'bg-gradient-to-r from-orange-500 to-red-500 text-white font-bold shadow-md'
                              : 'bg-white border border-orange-100 text-brand-brown hover:bg-orange-50'
                          }`}
                          title={tag.tag_name}
                        >
                          {tag.tag_name}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {mode === 'replay' && (
              <div>
                <label className="block text-sm font-bold text-brand-brown mb-2">
                  <Video className="w-4 h-4 inline mr-1" />
                  视频时间戳（秒）
                </label>
                <input
                  type="number"
                  value={videoTimestamp || ''}
                  onChange={(e) => setVideoTimestamp(e.target.value ? Number(e.target.value) : null)}
                  placeholder="例如：125"
                  className="w-full px-4 py-3 rounded-2xl border border-orange-100 bg-white text-brand-brown outline-none focus:border-orange-300"
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-bold text-brand-brown mb-2">
                备注（可选）
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="添加备注信息..."
                rows={3}
                className="w-full px-4 py-3 rounded-2xl border border-orange-100 bg-white text-brand-brown outline-none focus:border-orange-300 placeholder-orange-300 resize-none"
              />
            </div>

            <button
              onClick={handleAddTag}
              disabled={selectedTagIds.length === 0 || loading}
              className="w-full px-6 py-3 rounded-2xl bg-gradient-to-r from-orange-500 to-red-500 text-white font-bold shadow-md hover:shadow-lg hover:from-orange-400 hover:to-red-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  <Save className="w-5 h-5" />
                  保存 {selectedTagIds.length > 1 ? `${selectedTagIds.length} 个` : ''}标签
                </>
              )}
            </button>
          </div>
        </div>

        <div className="bg-white/80 backdrop-blur-sm rounded-3xl p-6 border border-orange-100 shadow-sm">
          <h2 className="text-xl font-bold text-brand-brown mb-4 flex items-center gap-2">
            <Clock className="w-5 h-5 text-orange-500" />
            已录入标签 ({tags.length})
          </h2>

          <div className="space-y-3 max-h-[600px] overflow-y-auto">
            {tags.length === 0 ? (
              <div className="text-center py-12 text-brand-gray">
                暂无标签，开始录入吧
              </div>
            ) : (
              tags.map((tag) => (
                <div
                  key={tag.id}
                  className="p-4 rounded-2xl border border-orange-100 bg-white hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <div className="font-bold text-brand-brown">{tag.tagName}</div>
                      <div className="text-xs text-orange-600 mt-1">{tag.tagCategory}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      {tag.isVerified && (
                        <CheckCircle className="w-5 h-5 text-green-500" />
                      )}
                      <button
                        onClick={() => {
                          setEditingTagId(tag.id);
                          setNotes(tag.notes);
                          setVideoTimestamp(tag.videoTimestamp);
                        }}
                        className="p-2 rounded-lg hover:bg-orange-50 text-orange-600"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => deleteTag(tag.id)}
                        className="p-2 rounded-lg hover:bg-red-50 text-red-600"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <div className="text-sm text-brand-gray space-y-1">
                    <div className="flex items-center gap-2">
                      <Clock className="w-3 h-3" />
                      {format(new Date(tag.eventTime), 'yyyy-MM-dd HH:mm:ss')}
                    </div>
                    {tag.videoTimestamp !== null && (
                      <div className="flex items-center gap-2">
                        <Video className="w-3 h-3" />
                        {tag.videoTimestamp}秒
                      </div>
                    )}
                    {tag.notes && (
                      <div className="mt-2 text-xs bg-orange-50 px-3 py-2 rounded-lg">
                        {tag.notes}
                      </div>
                    )}
                    {editingTagId === tag.id && (
                      <div className="mt-3 rounded-2xl border border-orange-100 bg-orange-50/60 p-3 space-y-3">
                        <textarea
                          value={notes}
                          onChange={(e) => setNotes(e.target.value)}
                          rows={3}
                          placeholder="补充该标签备注..."
                          className="w-full px-3 py-2 rounded-xl border border-orange-100 bg-white text-brand-brown outline-none focus:border-orange-300 resize-none"
                        />
                        <input
                          type="number"
                          value={videoTimestamp ?? ''}
                          onChange={(e) => setVideoTimestamp(e.target.value ? Number(e.target.value) : null)}
                          placeholder="视频时间戳（秒）"
                          className="w-full px-3 py-2 rounded-xl border border-orange-100 bg-white text-brand-brown outline-none focus:border-orange-300"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => void handleSaveEdit(tag.id)}
                            className="px-4 py-2 rounded-xl bg-gradient-to-r from-orange-500 to-red-500 text-white text-sm font-bold"
                          >
                            保存修改
                          </button>
                          <button
                            onClick={() => {
                              setEditingTagId(null);
                              setNotes('');
                              setVideoTimestamp(null);
                            }}
                            className="px-4 py-2 rounded-xl border border-orange-200 text-orange-700 text-sm font-bold bg-white"
                          >
                            取消
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
