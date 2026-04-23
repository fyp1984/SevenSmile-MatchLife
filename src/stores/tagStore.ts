import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import type { TechniqueTag, MatchEvent, UserReputation, TaggingMode, TagEntry } from '../types/tagging';

type TagStore = {
  mode: TaggingMode;
  currentMatchId: string | null;
  tags: TagEntry[];
  availableTags: TechniqueTag[];
  userReputation: UserReputation | null;
  loading: boolean;
  error: string | null;

  setMode: (mode: TaggingMode) => void;
  setCurrentMatch: (matchId: string) => void;
  loadAvailableTags: (sport: 'badminton' | 'tennis') => Promise<void>;
  loadUserReputation: (userId: string) => Promise<void>;
  loadMatchTags: (matchId: string) => Promise<void>;
  addTag: (params: {
    tagId: string;
    eventTime: string;
    videoTimestamp: number | null;
    notes: string;
  }) => Promise<void>;
  updateTag: (tagId: string, updates: Partial<TagEntry>) => Promise<void>;
  deleteTag: (tagId: string) => Promise<void>;
  clearTags: () => void;
};

export const useTagStore = create<TagStore>((set, get) => ({
  mode: 'realtime',
  currentMatchId: null,
  tags: [],
  availableTags: [],
  userReputation: null,
  loading: false,
  error: null,

  setMode: (mode) => set({ mode }),

  setCurrentMatch: (matchId) => set({ currentMatchId: matchId }),

  loadAvailableTags: async (sport) => {
    set({ loading: true, error: null });
    try {
      const { data, error } = await supabase
        .from('technique_tags')
        .select('*')
        .eq('sport', sport)
        .order('tag_category', { ascending: true });

      if (error) throw error;
      set({ availableTags: data || [], loading: false });
    } catch (error) {
      const msg = error instanceof Error ? error.message : '加载标签失败';
      set({ error: msg, loading: false });
    }
  },

  loadUserReputation: async (userId) => {
    set({ loading: true, error: null });
    try {
      const { data, error } = await supabase
        .from('user_reputation')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (error) throw error;
      set({ userReputation: data, loading: false });
    } catch (error) {
      const msg = error instanceof Error ? error.message : '加载用户信誉失败';
      set({ error: msg, loading: false });
    }
  },

  loadMatchTags: async (matchId) => {
    set({ loading: true, error: null });
    try {
      const { data, error } = await supabase
        .from('match_events')
        .select(`
          id,
          tag_id,
          event_time,
          video_timestamp,
          notes,
          is_verified,
          technique_tags (
            tag_name,
            tag_category
          )
        `)
        .eq('match_id', matchId)
        .order('event_time', { ascending: false });

      if (error) throw error;

      const tags: TagEntry[] = (data || []).map((item: any) => ({
        id: item.id,
        tagId: item.tag_id,
        tagName: item.technique_tags?.tag_name || '',
        tagCategory: item.technique_tags?.tag_category || '',
        eventTime: item.event_time,
        videoTimestamp: item.video_timestamp,
        notes: item.notes || '',
        isVerified: item.is_verified,
      }));

      set({ tags, loading: false });
    } catch (error) {
      const msg = error instanceof Error ? error.message : '加载标签失败';
      set({ error: msg, loading: false });
    }
  },

  addTag: async (params) => {
    const { currentMatchId } = get();
    if (!currentMatchId) {
      set({ error: '请先选择比赛' });
      return;
    }

    set({ loading: true, error: null });
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) throw new Error('用户未登录');

      const { data, error } = await supabase
        .from('match_events')
        .insert({
          match_id: currentMatchId,
          user_id: userData.user.id,
          tag_id: params.tagId,
          event_time: params.eventTime,
          video_timestamp: params.videoTimestamp,
          notes: params.notes,
          created_by: userData.user.id,
        })
        .select(`
          id,
          tag_id,
          event_time,
          video_timestamp,
          notes,
          is_verified,
          technique_tags (
            tag_name,
            tag_category
          )
        `)
        .single();

      if (error) throw error;

      const newTag: TagEntry = {
        id: data.id,
        tagId: data.tag_id,
        tagName: (data as any).technique_tags?.tag_name || '',
        tagCategory: (data as any).technique_tags?.tag_category || '',
        eventTime: data.event_time,
        videoTimestamp: data.video_timestamp,
        notes: data.notes || '',
        isVerified: data.is_verified,
      };

      set((state) => ({
        tags: [newTag, ...state.tags],
        loading: false,
      }));

      await supabase.rpc('increment_user_tags', { p_user_id: userData.user.id });
    } catch (error) {
      const msg = error instanceof Error ? error.message : '添加标签失败';
      set({ error: msg, loading: false });
    }
  },

  updateTag: async (tagId, updates) => {
    set({ loading: true, error: null });
    try {
      const { error } = await supabase
        .from('match_events')
        .update({
          notes: updates.notes,
          video_timestamp: updates.videoTimestamp,
        })
        .eq('id', tagId);

      if (error) throw error;

      set((state) => ({
        tags: state.tags.map((tag) =>
          tag.id === tagId ? { ...tag, ...updates } : tag
        ),
        loading: false,
      }));
    } catch (error) {
      const msg = error instanceof Error ? error.message : '更新标签失败';
      set({ error: msg, loading: false });
    }
  },

  deleteTag: async (tagId) => {
    set({ loading: true, error: null });
    try {
      const { error } = await supabase
        .from('match_events')
        .delete()
        .eq('id', tagId);

      if (error) throw error;

      set((state) => ({
        tags: state.tags.filter((tag) => tag.id !== tagId),
        loading: false,
      }));
    } catch (error) {
      const msg = error instanceof Error ? error.message : '删除标签失败';
      set({ error: msg, loading: false });
    }
  },

  clearTags: () => set({ tags: [], currentMatchId: null }),
}));
