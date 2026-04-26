import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import type { TechniqueTag, UserReputation, TaggingMode, TagEntry } from '../types/tagging';
import { getLocalContributorId } from '../lib/localContributor';

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
        .select('id, sport:sport_type, tag_name, tag_category, description:tag_description, created_at')
        .eq('sport_type', sport)
        .eq('is_active', true)
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
      const { data, error } = await supabase.rpc('matchlife_get_user_reputation', {
        p_user_id: userId,
      });

      if (error) throw error;
      set({ userReputation: (data?.[0] as UserReputation | undefined) || null, loading: false });
    } catch (error) {
      const msg = error instanceof Error ? error.message : '加载用户信誉失败';
      set({ error: msg, loading: false });
    }
  },

  loadMatchTags: async (matchId) => {
    set({ loading: true, error: null });
    try {
      const { data, error } = await supabase.rpc('matchlife_list_match_tags', {
        p_match_id: matchId,
      });

      if (error) throw error;

      const tags: TagEntry[] = ((data || []) as Array<Record<string, unknown>>).map((item) => ({
        id: String(item.id || ''),
        tagId: String(item.tag_id || ''),
        tagName: String(item.tag_name || ''),
        tagCategory: String(item.tag_category || ''),
        eventTime: new Date(String(item.created_at || new Date().toISOString())).toISOString(),
        videoTimestamp: typeof item.video_timestamp === 'number' ? item.video_timestamp : null,
        notes: String(item.notes || ''),
        isVerified: Boolean(item.is_verified),
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
      const contributorId = getLocalContributorId();

      const { data, error } = await supabase.rpc('matchlife_add_match_tag', {
        p_match_id: currentMatchId,
        p_created_by: contributorId,
        p_tag_id: params.tagId,
        p_event_time: params.videoTimestamp ? Math.round(params.videoTimestamp) : 0,
        p_video_timestamp: params.videoTimestamp,
        p_notes: params.notes,
        p_is_verified: false,
      });

      if (error) throw error;

      const row = data?.[0] as Record<string, unknown> | undefined;
      if (!row) throw new Error('标签保存失败');

      const newTag: TagEntry = {
        id: String(row.id),
        tagId: String(row.tag_id || ''),
        tagName: String(row.tag_name || ''),
        tagCategory: String(row.tag_category || ''),
        eventTime: new Date(String(row.created_at || new Date().toISOString())).toISOString(),
        videoTimestamp: typeof row.video_timestamp === 'number' ? row.video_timestamp : null,
        notes: String(row.notes || ''),
        isVerified: Boolean(row.is_verified),
      };

      set((state) => ({
        tags: [newTag, ...state.tags],
        loading: false,
      }));

      await get().loadUserReputation(contributorId);
    } catch (error) {
      const msg = error instanceof Error ? error.message : '添加标签失败';
      set({ error: msg, loading: false });
    }
  },

  updateTag: async (tagId, updates) => {
    set({ loading: true, error: null });
    try {
      const contributorId = getLocalContributorId();
      const { data, error } = await supabase.rpc('matchlife_update_match_tag', {
        p_event_id: tagId,
        p_created_by: contributorId,
        p_video_timestamp: updates.videoTimestamp ?? null,
        p_notes: updates.notes ?? null,
      });

      if (error) throw error;

      const row = data?.[0] as Record<string, unknown> | undefined;
      if (!row) throw new Error('更新标签失败');

      set((state) => ({
        tags: state.tags.map((tag) =>
          tag.id === tagId
            ? {
                ...tag,
                eventTime: new Date(String(row.created_at || tag.eventTime)).toISOString(),
                videoTimestamp: typeof row.video_timestamp === 'number' ? row.video_timestamp : null,
                notes: String(row.notes || ''),
                isVerified: Boolean(row.is_verified),
              }
            : tag
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
      const contributorId = getLocalContributorId();
      const { data, error } = await supabase.rpc('matchlife_delete_match_tag', {
        p_event_id: tagId,
        p_created_by: contributorId,
      });

      if (error) throw error;
      if (!data) throw new Error('删除标签失败');

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
