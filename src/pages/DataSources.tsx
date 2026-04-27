import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Database, FileJson, Link2, Plus, ShieldCheck, Trash2, Upload, UserRound, Search, Edit2, BookOpen, Layers3 } from 'lucide-react';
import {
  defaultSources,
  deleteSourceFromDb,
  fetchSourcesFromDb,
  readSourcesFromLocal,
  saveSourcesToLocal,
  type SourceItem,
  upsertSourcesToDb,
} from '../lib/dataSources';
import { listPlayerProfiles, upsertPlayerProfile, deletePlayerProfile, type PlayerProfile } from '../lib/playerProfiles';

const MATCHLIFE_SOURCE_JSON_EXAMPLE = `{
  "sources": [
    {
      "name": "七笑果赛事聚合源",
      "type": "api",
      "url": "https://api.example.com/matchlife/source.json",
      "format": "matchlife-source-json",
      "enabled": true
    }
  ]
}`;

const YMQ_JSON_EXAMPLE = `{
  "sources": [
    {
      "name": "YMQ 北方赛区",
      "type": "html",
      "url": "https://apply.ymq.me/wechat/#/match?game_id=38653",
      "format": "ymq-json",
      "enabled": true
    }
  ]
}`;

const TENNIS_JSON_EXAMPLE = `{
  "sources": [
    {
      "name": "全国青少年网球巡回赛",
      "type": "api",
      "url": "https://api.example.com/tennis/tournament-feed.json",
      "format": "tennis-json",
      "enabled": true
    }
  ]
}`;

const PLAYER_PROFILE_JSON_EXAMPLE = `{
  "players": [
    {
      "player_name": "七笑果",
      "primary_sport": "badminton",
      "gender": "female",
      "affiliated_club": "七笑果青训队",
      "coach_name": "李教练",
      "status": "active"
    }
  ]
}`;

const DATA_SOURCE_PASSWORD = import.meta.env.VITE_DATA_SOURCE_PASSWORD || '7%K$QJ2pWtgw';

type DataSourceTab = 'sources' | 'players' | 'formats';
type PlayerActionModalState =
  | { mode: 'edit'; profile: PlayerProfile }
  | { mode: 'delete'; profile: PlayerProfile }
  | null;

function getPasswordVerificationMessage(valid: boolean, actionLabel: string) {
  return valid ? '' : `数据源密码不正确，已取消${actionLabel}。`;
}

function normalizeImportedSources(payload: unknown): SourceItem[] {
  const list = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object' && Array.isArray((payload as { sources?: unknown[] }).sources)
      ? (payload as { sources: unknown[] }).sources
      : [];

  return list
    .map((item, index) => {
      const row = item as Partial<SourceItem> & { format?: string; url?: string; name?: string };
      if (!row?.name || !row?.url) return null;
      const format = row.format === 'ymq-json' ? 'ymq-json' : row.format === 'tennis-json' ? 'tennis-json' : 'matchlife-source-json';
      return {
        id: row.id || `imported-${Date.now()}-${index}`,
        name: row.name.trim(),
        type: row.type === 'html' || row.type === 'file' ? row.type : 'api',
        url: row.url.trim(),
        format,
        enabled: row.enabled !== false,
        updatedAt: new Date().toISOString(),
        origin: 'imported',
      } satisfies SourceItem;
    })
    .filter(Boolean) as SourceItem[];
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const record = error as { message?: string; details?: string; hint?: string; error_description?: string };
    return String(record.message || record.details || record.hint || record.error_description || JSON.stringify(error));
  }
  return String(error || '');
}

function normalizeImportedPlayers(payload: unknown) {
  const list = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object' && Array.isArray((payload as { players?: unknown[] }).players)
      ? (payload as { players: unknown[] }).players
      : [];

  return list
    .map((item) => {
      const row = item as {
        player_name?: string;
        playerName?: string;
        primary_sport?: string;
        primarySport?: string;
        avatar_url?: string;
        avatarUrl?: string;
        gender?: string;
        dominant_hand?: string;
        dominantHand?: string;
        affiliated_club?: string;
        affiliatedClub?: string;
        coach_name?: string;
        coachName?: string;
        status?: string;
      };

      const playerName = row.player_name || row.playerName;
      const primarySport = row.primary_sport || row.primarySport;
      if (!playerName || !primarySport) return null;

      return {
        playerName: playerName.trim(),
        primarySport: primarySport.trim(),
        avatarUrl: row.avatar_url || row.avatarUrl || '',
        gender: row.gender || '',
        dominantHand: row.dominant_hand || row.dominantHand || '',
        affiliatedClub: row.affiliated_club || row.affiliatedClub || '',
        coachName: row.coach_name || row.coachName || '',
        status: row.status || 'active',
      };
    })
    .filter(Boolean) as Array<{
      playerName: string;
      primarySport: string;
      avatarUrl: string;
      gender: string;
      dominantHand: string;
      affiliatedClub: string;
      coachName: string;
      status: string;
    }>;
}

export default function DataSources() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const playerFileInputRef = useRef<HTMLInputElement | null>(null);
  const sourceFeedbackTimerRef = useRef<number | null>(null);
  const playerFeedbackTimerRef = useRef<number | null>(null);
  const [sources, setSources] = useState<SourceItem[]>(() => readSourcesFromLocal());
  const [playerProfiles, setPlayerProfiles] = useState<PlayerProfile[]>([]);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [type, setType] = useState<SourceItem['type']>('api');
  const [format, setFormat] = useState<SourceItem['format']>('matchlife-source-json');
  const [playerName, setPlayerName] = useState('');
  const [playerSport, setPlayerSport] = useState('badminton');
  const [playerClub, setPlayerClub] = useState('');
  const [playerCoach, setPlayerCoach] = useState('');
  const [playerAvatar, setPlayerAvatar] = useState('');
  const [playerHand, setPlayerHand] = useState('');
  const [playerGender, setPlayerGender] = useState('');
  const [playerSearch, setPlayerSearch] = useState('');
  const [sourceMessage, setSourceMessage] = useState<string | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [playerMessage, setPlayerMessage] = useState<string | null>(null);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [sourceSaved, setSourceSaved] = useState(false);
  const [playerSaved, setPlayerSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<DataSourceTab>('sources');
  const [editingPlayerId, setEditingPlayerId] = useState<string | null>(null);
  const [editPasswordVerified, setEditPasswordVerified] = useState(false);
  const [playerActionModal, setPlayerActionModal] = useState<PlayerActionModalState>(null);
  const [playerActionPassword, setPlayerActionPassword] = useState('');
  const [playerActionPending, setPlayerActionPending] = useState(false);
  const [playerActionError, setPlayerActionError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (sourceFeedbackTimerRef.current) window.clearTimeout(sourceFeedbackTimerRef.current);
      if (playerFeedbackTimerRef.current) window.clearTimeout(playerFeedbackTimerRef.current);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const dbItems = await fetchSourcesFromDb();
        const playerItems = await listPlayerProfiles('', '', 200);
        if (cancelled) return;
        if (dbItems.length === 0) {
          await upsertSourcesToDb(defaultSources);
          if (cancelled) return;
          setSources(defaultSources);
          saveSourcesToLocal(defaultSources);
        } else {
          setSources(dbItems);
          saveSourcesToLocal(dbItems);
        }
        setPlayerProfiles(playerItems);
      } catch (e) {
        if (!cancelled) {
          setSourceError(`数据库读取失败，已使用本地草稿：${getErrorMessage(e)}`);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const persistSources = async (next: SourceItem[]) => {
    setSources(next);
    saveSourcesToLocal(next);
    await upsertSourcesToDb(next);
  };

  const activeCount = useMemo(() => sources.filter((item) => item.enabled).length, [sources]);
  const activePlayers = useMemo(
    () => playerProfiles.filter((item) => item.status === 'active').length,
    [playerProfiles],
  );

  const addSource = () => {
    setSourceError(null);
    setSourceMessage(null);
    setSourceSaved(false);
    if (!name.trim() || !url.trim()) {
      setSourceError('请先填写数据源名称与地址。');
      return;
    }

    const nextItem: SourceItem = {
      id: `source-${Date.now()}`,
      name: name.trim(),
      url: url.trim(),
      type,
      format,
      enabled: true,
      updatedAt: new Date().toISOString(),
      origin: 'manual',
    };

    void persistSources([nextItem, ...sources]).catch((e) =>
      setSourceError(`保存到数据库失败：${getErrorMessage(e)}`),
    );
    setName('');
    setUrl('');
    setSourceMessage('数据源已保存并持久化入库。');
    setSourceSaved(true);
    if (sourceFeedbackTimerRef.current) window.clearTimeout(sourceFeedbackTimerRef.current);
    sourceFeedbackTimerRef.current = window.setTimeout(() => setSourceSaved(false), 3000);
  };

  const toggleSource = (id: string) => {
    const next = sources.map((item) =>
      item.id === id
        ? { ...item, enabled: !item.enabled, updatedAt: new Date().toISOString() }
        : item,
    );
    void persistSources(next).catch((e) =>
      setSourceError(`更新数据源状态失败：${getErrorMessage(e)}`),
    );
  };

  const removeSource = (id: string) => {
    const next = sources.filter((item) => item.id !== id);
    setSources(next);
    saveSourcesToLocal(next);
    void deleteSourceFromDb(id).catch((e) =>
      setSourceError(`删除数据源失败：${getErrorMessage(e)}`),
    );
  };

  const importFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setSourceError(null);
    setSourceMessage(null);

    try {
      const text = await file.text();
      const imported = normalizeImportedSources(JSON.parse(text));
      if (imported.length === 0) {
        throw new Error('未识别到可导入的数据源，请使用已适配的 JSON 配置格式。');
      }

      const merged = [...imported, ...sources].filter(
        (item, index, arr) =>
          arr.findIndex((target) => target.name === item.name && target.url === item.url) === index,
      );

      await upsertSourcesToDb(merged);
      setSources(merged);
      saveSourcesToLocal(merged);
      setSourceMessage(`已导入 ${imported.length} 个数据源配置。`);
    } catch (err) {
      setSourceError(err instanceof Error ? err.message : '导入失败，请检查文件格式。');
    } finally {
      event.target.value = '';
    }
  };

  const savePlayerProfile = async () => {
    setPlayerError(null);
    setPlayerMessage(null);
    setPlayerSaved(false);
    if (!playerName.trim()) {
      setPlayerError('请先填写选手姓名。');
      return;
    }

    if (editingPlayerId && !editPasswordVerified) {
      setPlayerError('请先点击对应选手的编辑按钮，并在密码确认弹层中完成验证后再保存。');
      return;
    }

    try {
      const profile = await upsertPlayerProfile({
        playerId: editingPlayerId,
        playerName: playerName.trim(),
        primarySport: playerSport,
        affiliatedClub: playerClub,
        coachName: playerCoach,
        avatarUrl: playerAvatar,
        dominantHand: playerHand,
        gender: playerGender,
        status: 'active',
      });

      if (profile) {
        setPlayerProfiles((current) => {
          const next = [profile, ...current.filter((item) => item.id !== profile.id)];
          return next.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
        });
      }

      setPlayerName('');
      setPlayerClub('');
      setPlayerCoach('');
      setPlayerAvatar('');
      setPlayerHand('');
      setPlayerGender('');
      setEditingPlayerId(null);
      setEditPasswordVerified(false);
      setPlayerMessage(editingPlayerId ? '选手档案已更新。' : '选手档案已写入数据库。');
      setPlayerSaved(true);
      if (playerFeedbackTimerRef.current) window.clearTimeout(playerFeedbackTimerRef.current);
      playerFeedbackTimerRef.current = window.setTimeout(() => setPlayerSaved(false), 3000);
    } catch (e) {
      setPlayerError(`保存选手档案失败：${getErrorMessage(e)}`);
    }
  };

  const beginEditPlayer = (profile: PlayerProfile) => {
    setEditPasswordVerified(true);
    setEditingPlayerId(profile.id);
    setPlayerName(profile.player_name);
    setPlayerSport(profile.primary_sport || 'badminton');
    setPlayerClub(profile.affiliated_club || '');
    setPlayerCoach(profile.coach_name || '');
    setPlayerAvatar(profile.avatar_url || '');
    setPlayerHand(profile.dominant_hand || '');
    setPlayerGender(profile.gender || '');
    
    // Scroll to the form
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setPlayerMessage('已将选手信息填入表单，可直接修改并保存。');
  };

  const openPlayerActionModal = (mode: 'edit' | 'delete', profile: PlayerProfile) => {
    setPlayerError(null);
    setPlayerActionPassword('');
    setPlayerActionError(null);
    setPlayerActionModal({ mode, profile });
  };

  const closePlayerActionModal = () => {
    if (playerActionPending) return;
    setPlayerActionModal(null);
    setPlayerActionPassword('');
    setPlayerActionError(null);
  };

  const confirmPlayerAction = async () => {
    if (!playerActionModal) return;
    const actionLabel = playerActionModal.mode === 'edit' ? '编辑' : '删除';
    const trimmedPassword = playerActionPassword.trim();
    if (!trimmedPassword) {
      setPlayerActionError('请输入数据源密码。');
      return;
    }

    const isValidPassword = trimmedPassword === DATA_SOURCE_PASSWORD;
    if (!isValidPassword) {
      const message = getPasswordVerificationMessage(false, actionLabel);
      setPlayerActionError(message);
      setPlayerError(message);
      return;
    }

    setPlayerActionError(null);
    setPlayerActionPending(true);
    try {
      if (playerActionModal.mode === 'edit') {
        beginEditPlayer(playerActionModal.profile);
      } else {
        const deleted = await deletePlayerProfile(playerActionModal.profile.id);
        if (!deleted) {
          throw new Error('未能删除该选手档案，请检查权限状态或该档案是否仍被比赛标签引用。');
        }
        if (editingPlayerId === playerActionModal.profile.id) setEditingPlayerId(null);
        if (editingPlayerId === playerActionModal.profile.id) setEditPasswordVerified(false);
        setPlayerProfiles((current) => current.filter((p) => p.id !== playerActionModal.profile.id));
        setPlayerMessage(`已成功删除选手档案。`);
      }
      setPlayerActionModal(null);
      setPlayerActionPassword('');
      setPlayerActionError(null);
    } catch (e) {
      const message = `${playerActionModal.mode === 'edit' ? '编辑选手档案' : '删除选手档案'}失败：${getErrorMessage(e)}`;
      setPlayerActionError(message);
      setPlayerError(message);
    } finally {
      setPlayerActionPending(false);
    }
  };

  const importPlayerProfiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setPlayerError(null);
    setPlayerMessage(null);

    try {
      const text = await file.text();
      const imported = normalizeImportedPlayers(JSON.parse(text));
      if (imported.length === 0) {
        throw new Error('未识别到可导入的选手档案，请使用已适配的 JSON 格式。');
      }

      const savedProfiles: PlayerProfile[] = [];
      for (const item of imported) {
        const saved = await upsertPlayerProfile(item);
        if (saved) savedProfiles.push(saved);
      }

      if (savedProfiles.length > 0) {
        setPlayerProfiles((current) => {
          const merged = [...savedProfiles, ...current.filter((item) => !savedProfiles.some((saved) => saved.id === item.id))];
          return merged.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
        });
      }

      setPlayerMessage(`已导入 ${savedProfiles.length} 条选手档案。`);
    } catch (err) {
      setPlayerError(err instanceof Error ? err.message : '选手档案导入失败，请检查文件格式。');
    } finally {
      event.target.value = '';
    }
  };

  const filteredProfiles = useMemo(
    () => playerProfiles.filter((p) => !playerSearch || p.player_name.toLowerCase().includes(playerSearch.toLowerCase())),
    [playerProfiles, playerSearch],
  );

  const tabButtonClass = (tab: DataSourceTab) =>
    `inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold transition ${
      activeTab === tab
        ? 'bg-gradient-to-r from-orange-500 to-red-500 text-white shadow-md'
        : 'border border-orange-200 bg-white text-orange-700 hover:bg-orange-50'
    }`;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 pb-20 pt-4 sm:pt-6">
      <div className="rounded-[28px] border border-orange-100 bg-white/80 p-5 shadow-sm backdrop-blur-sm sm:p-7">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-2xl font-extrabold text-brand-brown sm:text-3xl">数据源维护</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-brand-gray sm:text-base">
              维护已接入的数据源地址，并支持导入当前已适配的 JSON 配置文件，便于后续扩展更多赛事平台与球类来源。
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:flex sm:items-center">
            <div className="rounded-2xl border border-orange-100 bg-orange-50/70 px-4 py-3 text-center">
              <div className="text-xs font-bold uppercase tracking-wide text-orange-500">已启用</div>
              <div className="mt-1 text-2xl font-extrabold text-brand-brown">{activeCount}</div>
            </div>
            <div className="rounded-2xl border border-orange-100 bg-white px-4 py-3 text-center">
              <div className="text-xs font-bold uppercase tracking-wide text-brand-gray">总配置</div>
              <div className="mt-1 text-2xl font-extrabold text-brand-brown">{sources.length}</div>
            </div>
            <div className="rounded-2xl border border-orange-100 bg-white px-4 py-3 text-center">
              <div className="text-xs font-bold uppercase tracking-wide text-brand-gray">活跃档案</div>
              <div className="mt-1 text-2xl font-extrabold text-brand-brown">{activePlayers}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-[28px] border border-orange-100 bg-white/80 p-4 shadow-sm backdrop-blur-sm sm:p-6">
        <div className="flex flex-wrap gap-3">
          <button type="button" className={tabButtonClass('sources')} onClick={() => setActiveTab('sources')}>
            <Layers3 className="h-4 w-4" />
            数据源配置
          </button>
          <button type="button" className={tabButtonClass('players')} onClick={() => setActiveTab('players')}>
            <UserRound className="h-4 w-4" />
            选手档案
          </button>
          <button type="button" className={tabButtonClass('formats')} onClick={() => setActiveTab('formats')}>
            <BookOpen className="h-4 w-4" />
            格式说明
          </button>
        </div>
      </div>

      {activeTab === 'sources' && (
        <>
      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-[28px] border border-orange-100 bg-white/80 p-5 shadow-sm backdrop-blur-sm sm:p-7">
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500 to-red-500 text-white shadow-md">
              <Plus className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-extrabold text-brand-brown sm:text-xl">手动新增地址</h2>
              <p className="text-sm text-brand-gray">先选接入类型，再填写地址和适配格式。建议同一个赛事源仅保留一条启用配置。</p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-sm font-bold text-brand-brown">数据源名称</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="如：北方赛区公开页"
                className="w-full rounded-2xl border border-orange-100 bg-white px-4 py-3 text-sm text-brand-brown outline-none transition focus:border-orange-300"
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-bold text-brand-brown">接入类型</span>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as SourceItem['type'])}
                className="w-full rounded-2xl border border-orange-100 bg-white px-4 py-3 text-sm text-brand-brown outline-none transition focus:border-orange-300"
              >
                <option value="api">接口地址</option>
                <option value="html">页面地址</option>
                <option value="file">文件导入</option>
              </select>
            </label>
          </div>

          <label className="mt-4 block">
            <span className="mb-2 block text-sm font-bold text-brand-brown">数据源地址</span>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/data-feed"
              className="w-full rounded-2xl border border-orange-100 bg-white px-4 py-3 text-sm text-brand-brown outline-none transition focus:border-orange-300"
            />
          </label>

          <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end">
            <label className="block flex-1">
              <span className="mb-2 block text-sm font-bold text-brand-brown">适配格式</span>
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value as SourceItem['format'])}
                className="w-full rounded-2xl border border-orange-100 bg-white px-4 py-3 text-sm text-brand-brown outline-none transition focus:border-orange-300"
              >
                <option value="matchlife-source-json">MatchLife Source JSON</option>
                <option value="ymq-json">YMQ JSON</option>
                <option value="tennis-json">Tennis JSON</option>
              </select>
            </label>
            <button
              type="button"
              onClick={addSource}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-gradient-to-r from-orange-500 to-red-500 px-5 text-sm font-bold text-white shadow-md transition hover:from-orange-400 hover:to-red-400 hover:shadow-lg"
            >
              <Plus className="h-4 w-4" />
              {sourceSaved ? '已保存' : '保存数据源'}
            </button>
          </div>

          {sourceMessage && <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{sourceMessage}</div>}
          {sourceError && <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{sourceError}</div>}
        </section>

        <section className="rounded-[28px] border border-orange-100 bg-white/80 p-5 shadow-sm backdrop-blur-sm sm:p-7">
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-100 text-orange-500">
              <Upload className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-extrabold text-brand-brown sm:text-xl">上传导入</h2>
              <p className="text-sm text-brand-gray">当前仅支持已适配的 JSON 配置文件导入。</p>
            </div>
          </div>

          <div className="rounded-[28px] border border-dashed border-orange-200 bg-orange-50/40 px-6 py-10 text-center transition hover:border-orange-300 hover:bg-orange-50">
            <input ref={fileInputRef} type="file" accept=".json,application/json" className="hidden" onChange={importFile} />
            <FileJson className="mb-4 h-8 w-8 text-orange-500" />
            <div className="text-sm font-bold text-brand-brown">导入已适配的 JSON 配置</div>
            <div className="mt-2 text-xs leading-6 text-brand-gray">
              支持数组或 <code className="rounded bg-white px-1.5 py-0.5">sources</code> 字段，单条记录需包含名称与地址。
            </div>
            <button
              type="button"
              title="上传已适配的数据源 JSON 配置"
              onClick={() => fileInputRef.current?.click()}
              className="mt-5 inline-flex h-11 items-center justify-center gap-2 rounded-full border border-orange-200 bg-white px-5 text-sm font-bold text-orange-600 transition hover:bg-orange-50 hover:shadow-sm"
            >
              <Upload className="h-4 w-4" />
              选择配置文件
            </button>
          </div>

          <div className="mt-5 rounded-3xl border border-orange-100 bg-white p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-bold text-brand-brown">
              <ShieldCheck className="h-4 w-4 text-orange-500" />
              当前已适配格式
            </div>
            <div className="flex flex-wrap gap-2">
              {['ymq-json', 'matchlife-source-json', 'tennis-json'].map((tag) => (
                <span key={tag} className="rounded-full border border-orange-100 bg-orange-50 px-3 py-1 text-xs font-bold text-orange-700">
                  {tag}
                </span>
              ))}
            </div>
          </div>
        </section>
      </div>

      <section className="rounded-[28px] border border-orange-100 bg-white/80 p-5 shadow-sm backdrop-blur-sm sm:p-7">
        <div className="mb-6 grid gap-4 lg:grid-cols-3">
          <div className="rounded-3xl border border-orange-100 bg-orange-50/60 p-4">
            <div className="text-sm font-extrabold text-brand-brown">接口地址</div>
            <p className="mt-2 text-sm leading-6 text-brand-gray">
              适合已整理好的结构化接口，系统直接读取标准 JSON，适用于持续同步和批量更新。
            </p>
            <div className="mt-3 rounded-2xl bg-white px-3 py-2 text-xs text-brand-brown">示例：`https://api.example.com/matchlife/source.json`</div>
          </div>
          <div className="rounded-3xl border border-orange-100 bg-white p-4">
            <div className="text-sm font-extrabold text-brand-brown">页面地址</div>
            <p className="mt-2 text-sm leading-6 text-brand-gray">
              适合公开赛事页或成绩页，系统按已适配平台规则解析页面内容并提取比赛数据。
            </p>
            <div className="mt-3 rounded-2xl bg-orange-50 px-3 py-2 text-xs text-brand-brown">示例：`https://apply.ymq.me/wechat/#/match?game_id=38653`</div>
          </div>
          <div className="rounded-3xl border border-orange-100 bg-white p-4">
            <div className="text-sm font-extrabold text-brand-brown">文件导入</div>
            <p className="mt-2 text-sm leading-6 text-brand-gray">
              适合离线整理后的标准 JSON 配置或批量档案导入。导入前需先确认字段已适配。
            </p>
            <div className="mt-3 rounded-2xl bg-orange-50 px-3 py-2 text-xs text-brand-brown">示例：`matchlife-sources.json` / `players.json`</div>
          </div>
        </div>

        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-100 text-orange-500">
            <Database className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-extrabold text-brand-brown sm:text-xl">已维护数据源</h2>
            <p className="text-sm text-brand-gray">同类配置集中在此管理，启停、删除与地址核对都在一个区域完成。</p>
          </div>
        </div>

        <div className="grid gap-4">
          {loading && (
            <div className="rounded-2xl border border-orange-100 bg-orange-50/50 px-4 py-3 text-sm text-orange-700">
              正在加载数据库中的数据源配置...
            </div>
          )}
          {sources.map((item) => (
            <div key={item.id} className="flex flex-col gap-4 rounded-[24px] border border-orange-100 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-base font-extrabold text-brand-brown">{item.name}</span>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${item.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                    {item.enabled ? '启用中' : '已停用'}
                  </span>
                  <span className="rounded-full bg-orange-50 px-2.5 py-1 text-xs font-bold text-orange-700">{item.type}</span>
                  <span className="rounded-full bg-orange-50 px-2.5 py-1 text-xs font-bold text-orange-700">{item.format}</span>
                </div>
                <div className="mt-2 flex items-start gap-2 text-sm text-brand-gray">
                  <Link2 className="h-4 w-4 flex-shrink-0 text-orange-400" />
                  <span className="break-all whitespace-normal leading-5">{item.url}</span>
                </div>
                <div className="mt-2 text-xs text-brand-gray">
                  来源：{item.origin === 'manual' ? '手动维护' : '文件导入'} · 最近更新：{new Date(item.updatedAt).toLocaleString()}
                </div>
              </div>
              <div className="flex items-center gap-2 self-end sm:self-auto">
                <button
                  type="button"
                  title={item.enabled ? '停用数据源' : '启用数据源'}
                  onClick={() => toggleSource(item.id)}
                  className={`inline-flex h-11 w-11 items-center justify-center rounded-full border transition ${item.enabled ? 'border-emerald-200 bg-emerald-50 text-emerald-600 hover:bg-emerald-100' : 'border-orange-200 bg-white text-orange-500 hover:bg-orange-50'}`}
                >
                  <ShieldCheck className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  title="移除数据源"
                  onClick={() => removeSource(item.id)}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-red-100 bg-white text-red-500 transition hover:bg-red-50"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
        </>
      )}

      {activeTab === 'players' && (
      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <section className="rounded-[28px] border border-orange-100 bg-white/80 p-5 shadow-sm backdrop-blur-sm sm:p-7">
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500 to-red-500 text-white shadow-md">
              <UserRound className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-extrabold text-brand-brown sm:text-xl">维护选手档案</h2>
              <p className="text-sm text-brand-gray">为前台生涯页补充头像、俱乐部、教练与基础资料。</p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-sm font-bold text-brand-brown">选手姓名</span>
              <input
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                placeholder="如：七笑果"
                className="w-full rounded-2xl border border-orange-100 bg-white px-4 py-3 text-sm text-brand-brown outline-none transition focus:border-orange-300"
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-bold text-brand-brown">主运动类型</span>
              <select
                value={playerSport}
                onChange={(e) => setPlayerSport(e.target.value)}
                className="w-full rounded-2xl border border-orange-100 bg-white px-4 py-3 text-sm text-brand-brown outline-none transition focus:border-orange-300"
              >
                <option value="badminton">羽毛球</option>
                <option value="tennis">网球</option>
                <option value="tabletennis">乒乓球</option>
                <option value="basketball">篮球</option>
                <option value="football">足球</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-bold text-brand-brown">俱乐部/机构</span>
              <input
                value={playerClub}
                onChange={(e) => setPlayerClub(e.target.value)}
                placeholder="如：七笑果青训队"
                className="w-full rounded-2xl border border-orange-100 bg-white px-4 py-3 text-sm text-brand-brown outline-none transition focus:border-orange-300"
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-bold text-brand-brown">教练</span>
              <input
                value={playerCoach}
                onChange={(e) => setPlayerCoach(e.target.value)}
                placeholder="如：李教练"
                className="w-full rounded-2xl border border-orange-100 bg-white px-4 py-3 text-sm text-brand-brown outline-none transition focus:border-orange-300"
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-bold text-brand-brown">头像地址</span>
              <input
                value={playerAvatar}
                onChange={(e) => setPlayerAvatar(e.target.value)}
                placeholder="https://..."
                className="w-full rounded-2xl border border-orange-100 bg-white px-4 py-3 text-sm text-brand-brown outline-none transition focus:border-orange-300"
              />
            </label>
            <div className="grid grid-cols-2 gap-4">
              <label className="block">
                <span className="mb-2 block text-sm font-bold text-brand-brown">性别</span>
                <select
                  value={playerGender}
                  onChange={(e) => setPlayerGender(e.target.value)}
                  className="w-full rounded-2xl border border-orange-100 bg-white px-4 py-3 text-sm text-brand-brown outline-none transition focus:border-orange-300"
                >
                  <option value="">未填写</option>
                  <option value="male">男</option>
                  <option value="female">女</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-bold text-brand-brown">惯用手</span>
                <select
                  value={playerHand}
                  onChange={(e) => setPlayerHand(e.target.value)}
                  className="w-full rounded-2xl border border-orange-100 bg-white px-4 py-3 text-sm text-brand-brown outline-none transition focus:border-orange-300"
                >
                  <option value="">未填写</option>
                  <option value="left">左手</option>
                  <option value="right">右手</option>
                  <option value="both">双手</option>
                </select>
              </label>
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              onClick={savePlayerProfile}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-gradient-to-r from-orange-500 to-red-500 px-5 text-sm font-bold text-white shadow-md transition hover:from-orange-400 hover:to-red-400 hover:shadow-lg"
            >
              <Plus className="h-4 w-4" />
              {playerSaved ? '已保存' : editingPlayerId ? '更新选手档案' : '保存选手档案'}
            </button>
            {editingPlayerId && (
              <button
                type="button"
                onClick={() => {
                  setEditingPlayerId(null);
                  setPlayerName('');
                  setPlayerSport('badminton');
                  setPlayerClub('');
                  setPlayerCoach('');
                  setPlayerAvatar('');
                  setPlayerHand('');
                  setPlayerGender('');
                  setEditPasswordVerified(false);
                  setPlayerMessage('已退出编辑状态。');
                }}
                className="inline-flex h-12 items-center justify-center rounded-full border border-orange-200 bg-white px-5 text-sm font-bold text-orange-700 transition hover:bg-orange-50"
              >
                取消编辑
              </button>
            )}
            <div className="rounded-2xl border border-orange-100 bg-orange-50/60 px-4 py-3 text-sm text-brand-gray">
              当前活跃档案 <span className="font-extrabold text-brand-brown">{activePlayers}</span> 条
            </div>
          </div>
          {playerMessage && <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{playerMessage}</div>}
          {playerError && <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{playerError}</div>}
        </section>

        <section className="rounded-[28px] border border-orange-100 bg-white/80 p-5 shadow-sm backdrop-blur-sm sm:p-7">
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-100 text-orange-500">
              <Upload className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-extrabold text-brand-brown sm:text-xl">导入选手档案</h2>
              <p className="text-sm text-brand-gray">支持导入已适配的 JSON 档案文件，快速补齐选手基础信息。</p>
            </div>
          </div>
          <div className="rounded-[28px] border border-dashed border-orange-200 bg-orange-50/40 px-6 py-10 text-center transition hover:border-orange-300 hover:bg-orange-50">
            <input ref={playerFileInputRef} type="file" accept=".json,application/json" className="hidden" onChange={importPlayerProfiles} />
            <FileJson className="mb-4 h-8 w-8 text-orange-500" />
            <div className="text-sm font-bold text-brand-brown">导入已适配的选手档案 JSON</div>
            <div className="mt-2 text-xs leading-6 text-brand-gray">
              支持数组或 <code className="rounded bg-white px-1.5 py-0.5">players</code> 字段，单条记录至少包含姓名与主运动类型。
            </div>
            <button
              type="button"
              onClick={() => playerFileInputRef.current?.click()}
              className="mt-5 inline-flex h-11 items-center justify-center gap-2 rounded-full border border-orange-200 bg-white px-5 text-sm font-bold text-orange-600 transition hover:bg-orange-50 hover:shadow-sm"
            >
              <Upload className="h-4 w-4" />
              选择档案文件
            </button>
          </div>
          <div className="mt-5 rounded-3xl border border-orange-100 bg-white p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-bold text-brand-brown">
                <ShieldCheck className="h-4 w-4 text-orange-500" />
                当前已入库选手
              </div>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-brand-gray" />
                <input
                  value={playerSearch}
                  onChange={(e) => setPlayerSearch(e.target.value)}
                  placeholder="搜索选手..."
                  className="w-32 sm:w-40 rounded-full border border-orange-100 bg-orange-50/50 pl-8 pr-3 py-1.5 text-xs text-brand-brown outline-none transition focus:border-orange-300 focus:bg-white"
                />
              </div>
            </div>
            <div className="space-y-3 max-h-[320px] overflow-y-auto custom-scrollbar pr-1">
              {playerProfiles.length === 0 ? (
                <div className="rounded-2xl bg-orange-50/60 px-4 py-4 text-sm text-brand-gray">
                  暂无选手档案，可先手动新增或导入 JSON。
                </div>
              ) : (
                filteredProfiles
                  .slice(0, 50)
                  .map((profile) => (
                  <div key={profile.id} className="group rounded-2xl border border-orange-100 bg-white px-4 py-3 hover:border-orange-200 hover:shadow-sm transition-all">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <div className="font-bold text-brand-brown truncate">{profile.player_name}</div>
                          <span className="rounded-full bg-orange-50 px-2 py-0.5 text-[10px] font-bold text-orange-700 whitespace-nowrap">
                            {profile.status}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-brand-gray truncate">
                          {profile.primary_sport} · {profile.affiliated_club || '未填写机构'} · {profile.coach_name || '未填写教练'}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                        <button
                          type="button"
                          onClick={() => openPlayerActionModal('edit', profile)}
                          className="p-1.5 text-brand-gray hover:text-orange-500 hover:bg-orange-50 rounded-full transition-colors"
                          title="编辑档案"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => openPlayerActionModal('delete', profile)}
                          className="p-1.5 text-brand-gray hover:text-red-500 hover:bg-red-50 rounded-full transition-colors"
                          title="删除档案"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
              {playerSearch && filteredProfiles.length === 0 && (
                <div className="text-center py-4 text-xs text-brand-gray">未搜索到相关选手</div>
              )}
            </div>
          </div>
        </section>
      </div>
      )}

      {activeTab === 'formats' && (
      <section className="rounded-[28px] border border-orange-100 bg-white/80 p-5 shadow-sm backdrop-blur-sm sm:p-7">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500 to-red-500 text-white shadow-md">
            <FileJson className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-extrabold text-brand-brown sm:text-xl">已适配格式说明与示例</h2>
            <p className="text-sm text-brand-gray">集中查看已适配格式、字段要求和 JSON 示例，避免不同来源配置混用。</p>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-3">
          <div className="rounded-3xl border border-orange-100 bg-orange-50/50 p-4">
            <div className="mb-2 text-sm font-extrabold text-brand-brown">MatchLife Source JSON</div>
            <p className="text-sm leading-6 text-brand-gray">
              用于系统通用数据源配置，至少包含 `name`、`type`、`url`、`format`、`enabled` 字段。
            </p>
            <pre className="mt-4 overflow-x-auto rounded-2xl bg-white p-4 text-xs leading-6 text-brand-brown">{MATCHLIFE_SOURCE_JSON_EXAMPLE}</pre>
          </div>

          <div className="rounded-3xl border border-orange-100 bg-white p-4">
            <div className="mb-2 text-sm font-extrabold text-brand-brown">YMQ JSON</div>
            <p className="text-sm leading-6 text-brand-gray">
              用于已适配的 YMQ 赛事页面地址配置，通常把 `type` 设为 `html`，并将 `format` 设为 `ymq-json`。
            </p>
            <pre className="mt-4 overflow-x-auto rounded-2xl bg-orange-50 p-4 text-xs leading-6 text-brand-brown">{YMQ_JSON_EXAMPLE}</pre>
          </div>

          <div className="rounded-3xl border border-orange-100 bg-white p-4">
            <div className="mb-2 text-sm font-extrabold text-brand-brown">Tennis JSON</div>
            <p className="text-sm leading-6 text-brand-gray">
              用于已适配的网球赛事 JSON 数据源，通常由接口直接返回标准结构，`format` 设为 `tennis-json`。
            </p>
            <pre className="mt-4 overflow-x-auto rounded-2xl bg-orange-50 p-4 text-xs leading-6 text-brand-brown">{TENNIS_JSON_EXAMPLE}</pre>
          </div>
        </div>

        <div className="mt-6 grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-3xl border border-orange-100 bg-white p-4">
            <div className="mb-2 text-sm font-extrabold text-brand-brown">选手档案 JSON</div>
            <p className="text-sm leading-6 text-brand-gray">
              用于批量导入选手基础资料，建议至少提供姓名、主运动类型，其余字段可按需补充。
            </p>
            <pre className="mt-4 overflow-x-auto rounded-2xl bg-orange-50 p-4 text-xs leading-6 text-brand-brown">{PLAYER_PROFILE_JSON_EXAMPLE}</pre>
          </div>

          <div className="rounded-3xl border border-orange-100 bg-orange-50/60 p-4">
            <div className="text-sm font-extrabold text-brand-brown">维护建议</div>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-brand-gray">
              <li>1. 同一赛事优先保留一个启用中的主数据源。</li>
              <li>2. 页面地址适合抓公开页，接口地址适合稳定 JSON 源。</li>
              <li>3. 选手档案删除前请先确认前台是否仍依赖该档案展示。</li>
              <li>4. 临时密码仅用于当前阶段，后续将切换 SSO 权限控制。</li>
            </ul>
          </div>
        </div>
      </section>
      )}

      {playerActionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-brown/35 px-4">
          <div className="w-full max-w-md rounded-[28px] border border-orange-100 bg-white p-6 shadow-xl">
            <h3 className="text-xl font-extrabold text-brand-brown">
              {playerActionModal.mode === 'edit' ? '确认编辑选手档案' : '确认删除选手档案'}
            </h3>
            <p className="mt-3 text-sm leading-6 text-brand-gray">
              {playerActionModal.mode === 'edit'
                ? `即将编辑选手“${playerActionModal.profile.player_name}”，请输入数据源密码后继续。`
                : `即将删除选手“${playerActionModal.profile.player_name}”。该操作会影响前台档案展示，请输入数据源密码确认。`}
            </p>
            <label className="mt-5 block">
              <span className="mb-2 block text-sm font-bold text-brand-brown">数据源密码</span>
              <input
                type="password"
                value={playerActionPassword}
                onChange={(e) => {
                  setPlayerActionPassword(e.target.value);
                  if (playerActionError) setPlayerActionError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void confirmPlayerAction();
                  }
                }}
                placeholder="请输入数据源密码"
                className={`w-full rounded-2xl bg-white px-4 py-3 text-sm text-brand-brown outline-none transition ${
                  playerActionError
                    ? 'border border-red-300 focus:border-red-400'
                    : 'border border-orange-100 focus:border-orange-300'
                }`}
              />
            </label>
            {playerActionError && (
              <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {playerActionError}
              </div>
            )}
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={closePlayerActionModal}
                className="inline-flex h-11 flex-1 items-center justify-center rounded-full border border-orange-200 bg-white px-4 text-sm font-bold text-orange-700 transition hover:bg-orange-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void confirmPlayerAction()}
                disabled={playerActionPending || playerActionPassword.trim().length === 0}
                className={`inline-flex h-11 flex-1 items-center justify-center rounded-full px-4 text-sm font-bold text-white shadow-md transition ${
                  playerActionModal.mode === 'delete'
                    ? 'bg-gradient-to-r from-red-500 to-orange-500 hover:from-red-400 hover:to-orange-400'
                    : 'bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-400 hover:to-red-400'
                } disabled:cursor-not-allowed disabled:opacity-60`}
              >
                {playerActionPending ? '处理中...' : playerActionModal.mode === 'edit' ? '确认编辑' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
