import { supabase } from './supabase';

export type SourceItem = {
  id: string;
  name: string;
  type: 'api' | 'html' | 'file';
  url: string;
  format: 'ymq-json' | 'matchlife-source-json' | 'tennis-json';
  enabled: boolean;
  updatedAt: string;
  origin: 'manual' | 'imported';
};

type SourceRow = {
  id: string;
  name: string;
  type: SourceItem['type'];
  url: string;
  format: SourceItem['format'];
  enabled: boolean;
  updated_at: string;
  origin: SourceItem['origin'];
};

export const STORAGE_KEY = 'matchlife_data_sources';

export const defaultSources: SourceItem[] = [
  {
    id: 'ymq-u12-north-default',
    name: '2026年全国U系列羽毛球比赛U12-14（北方赛区）',
    type: 'html',
    url: 'https://apply.ymq.me/wechat/#/match?game_id=38653',
    format: 'matchlife-source-json',
    enabled: true,
    updatedAt: new Date().toISOString(),
    origin: 'manual',
  },
];

const rowToItem = (row: SourceRow): SourceItem => ({
  id: row.id,
  name: row.name,
  type: row.type,
  url: row.url,
  format: row.format,
  enabled: row.enabled,
  updatedAt: row.updated_at,
  origin: row.origin,
});

const itemToRow = (item: SourceItem): SourceRow => ({
  id: item.id,
  name: item.name,
  type: item.type,
  url: item.url,
  format: item.format,
  enabled: item.enabled,
  updated_at: item.updatedAt,
  origin: item.origin,
});

export function readSourcesFromLocal(): SourceItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultSources;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return defaultSources;
    return parsed as SourceItem[];
  } catch {
    return defaultSources;
  }
}

export function saveSourcesToLocal(items: SourceItem[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

export async function fetchSourcesFromDb() {
  const { data, error } = await supabase
    .from('matchlife_data_sources')
    .select('id, name, type, url, format, enabled, updated_at, origin')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return ((data || []) as SourceRow[]).map(rowToItem);
}

export async function upsertSourcesToDb(items: SourceItem[]) {
  if (items.length === 0) return;
  const rows = items.map(itemToRow);
  const { error } = await supabase.from('matchlife_data_sources').upsert(rows, { onConflict: 'id' });
  if (error) throw error;
}

export async function deleteSourceFromDb(id: string) {
  const { error } = await supabase.from('matchlife_data_sources').delete().eq('id', id);
  if (error) throw error;
}

export function getRaceIdFromSource(url: string): number | null {
  try {
    const u = new URL(url);
    const fromSearch =
      u.searchParams.get('game_id') || u.searchParams.get('raceId') || u.searchParams.get('race_id');
    const hash = (u.hash || '').replace(/^#/, '');
    let fromHash = '';
    if (hash.includes('?')) {
      const queryPart = hash.slice(hash.indexOf('?') + 1);
      const hashParams = new URLSearchParams(queryPart);
      fromHash =
        hashParams.get('game_id') || hashParams.get('raceId') || hashParams.get('race_id') || '';
    }
    const raw = fromSearch || fromHash;
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function extractRaceIdFromTournamentName(name: string): number | null {
  const raw = String(name || '').trim();
  if (!raw) return null;

  const manualMatch = raw.match(/^manual-source-(\d+)$/i);
  if (manualMatch) return Number(manualMatch[1]);

  const suffixMatch = raw.match(/#(\d+)\s*$/);
  if (suffixMatch) return Number(suffixMatch[1]);

  return null;
}

export function buildSourceLabelByRaceId(sources: SourceItem[]) {
  const labels: Record<string, string> = {};
  for (const source of sources) {
    if (!source.enabled) continue;
    const raceId = getRaceIdFromSource(source.url);
    const name = String(source.name || '').trim();
    if (raceId && name) labels[String(raceId)] = name;
  }
  return labels;
}

export async function fetchSourceLabelByRaceId() {
  try {
    const dbSources = await fetchSourcesFromDb();
    return buildSourceLabelByRaceId(dbSources.length ? dbSources : defaultSources);
  } catch {
    return buildSourceLabelByRaceId(defaultSources);
  }
}

export function resolveTournamentDisplayName(
  tournamentName: string,
  sourceLabelByRaceId: Record<string, string>,
) {
  const raceId = extractRaceIdFromTournamentName(tournamentName);
  if (!raceId) return tournamentName;
  return sourceLabelByRaceId[String(raceId)] || tournamentName;
}

export function replaceTournamentPlaceholders(
  text: string,
  sourceLabelByRaceId: Record<string, string>,
) {
  return String(text || '').replace(/manual-source-(\d+)/gi, (match, raceId) => {
    return sourceLabelByRaceId[String(raceId)] || match;
  });
}
