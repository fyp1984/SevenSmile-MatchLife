import { createClient } from '@supabase/supabase-js';
import { createRequire } from 'node:module';

function getNodeWebSocketTransport() {
  if (typeof globalThis.WebSocket !== 'undefined') {
    return globalThis.WebSocket;
  }
  try {
    const require = createRequire(import.meta.url);
    const transport = require('ws');
    globalThis.WebSocket = transport;
    return transport;
  } catch {
    return undefined;
  }
}
import crypto from 'crypto';
import { buildCanonicalMatchRecord } from './canonical-match.mjs';

const YMQ_COURTS_URL = 'https://race.ymq.me/webservice/appWxRace/courts.do';
const YMQ_MATCHES_URL = 'https://race.ymq.me/webservice/appWxMatch/matchesScore.do';
const YMQ_HTTP_TIMEOUT_MS = Number(process.env.YMQ_HTTP_TIMEOUT_MS || 12000);

function sha1(value) {
  return crypto.createHash('sha1').update(value).digest('hex');
}

function names(list) {
  if (!Array.isArray(list)) return [];
  return list.map((p) => (p?.name || '').trim()).filter(Boolean);
}

function computeWinner(row) {
  if (row.scoreStatusNo !== 2) return 'UNKNOWN';
  const scoreOne = Number(row.scoreOne ?? NaN);
  const scoreTwo = Number(row.scoreTwo ?? NaN);
  if (Number.isFinite(scoreOne) && Number.isFinite(scoreTwo) && scoreOne !== scoreTwo) {
    return scoreOne > scoreTwo ? 'A' : 'B';
  }
  if (Array.isArray(row.gameScores) && row.gameScores.length > 0) {
    let setsA = 0;
    let setsB = 0;
    for (const set of row.gameScores) {
      const a = Number(set?.scoreOne ?? NaN);
      const b = Number(set?.scoreTwo ?? NaN);
      if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) continue;
      if (a > b) setsA += 1;
      if (b > a) setsB += 1;
    }
    if (setsA > setsB) return 'A';
    if (setsB > setsA) return 'B';
  }
  const a = Number(row.battleScoreOne ?? 0);
  const b = Number(row.battleScoreTwo ?? 0);
  if (a > b) return 'A';
  if (b > a) return 'B';
  return 'UNKNOWN';
}

function formatScore(row) {
  if (Array.isArray(row.gameScores) && row.gameScores.length > 0) {
    const parts = row.gameScores.map((g) => `${g.scoreOne ?? 0}-${g.scoreTwo ?? 0}`).join(', ');
    return parts || null;
  }
  if (typeof row.battleScoreOne === 'number' || typeof row.battleScoreTwo === 'number') {
    return `${row.battleScoreOne ?? 0}-${row.battleScoreTwo ?? 0}`;
  }
  return null;
}

function parseRoundName(row) {
  const rulesName = String(row.rulesName || '').trim();
  if (rulesName) return rulesName;
  const fullName = String(row.fullName || '').trim();
  const m = fullName.match(/(\d{1,3}\s*进\s*\d{1,3})/);
  if (m && m[1]) return m[1].replace(/\s+/g, '');
  if (fullName.includes('半决赛')) return '半决赛';
  if (fullName.includes('决赛')) return '决赛';
  return null;
}

function validateRow(row) {
  if (!row || typeof row !== 'object') return 'invalid row';
  if (typeof row.id !== 'number') return 'missing id';
  if (typeof row.raceId !== 'number') return 'missing raceId';
  if (!row.courtName) return 'missing courtName';
  if (!row.groupName) return 'missing groupName';
  const a = names(row.playerOnes);
  const b = names(row.playerTwos);
  if (a.length === 0 && b.length === 0) return 'missing players';
  return null;
}

function parseEventKey(row) {
  const fullName = String(row.fullName || '').trim();
  const itemName = String(row.itemName || '').trim();
  const ageMatch = fullName.match(/(\d{1,2})\s*岁/);
  const ageYears = ageMatch ? Number(ageMatch[1]) : null;

  let item = itemName;
  if (!item) {
    const m = fullName.match(/\d{1,2}\s*岁\s*([^\s\x5B]+)/);
    if (m && m[1]) item = m[1].trim();
  }

  let normalizedItem = item || null;
  if (ageYears && normalizedItem) {
    normalizedItem = normalizedItem.replace(new RegExp(`^${ageYears}\\s*岁`), '').trim();
  }

  const eventKey = ageYears && normalizedItem ? `${ageYears}岁${normalizedItem}` : normalizedItem || null;
  return { ageYears, itemName: item || null, eventKey };
}

function chunkArray(list, size) {
  if (!Array.isArray(list) || list.length === 0) return [];
  const out = [];
  for (let i = 0; i < list.length; i += size) {
    out.push(list.slice(i, i + size));
  }
  return out;
}

function hasLiveScore(row) {
  if (typeof row?.battleScoreOne === 'number' || typeof row?.battleScoreTwo === 'number') {
    return Number(row?.battleScoreOne ?? 0) > 0 || Number(row?.battleScoreTwo ?? 0) > 0;
  }
  if (!Array.isArray(row?.gameScores)) return false;
  return row.gameScores.some((set) => Number(set?.scoreOne ?? 0) > 0 || Number(set?.scoreTwo ?? 0) > 0);
}

function isFinishedMatch(row) {
  return row?.scoreStatusNo === 2 || typeof row?.scoreEndTime === 'number' || computeWinner(row) !== 'UNKNOWN';
}

function isActiveLiveMatch(row) {
  if (isFinishedMatch(row)) return false;
  return typeof row?.scoreStartTime === 'number' || hasLiveScore(row) || [1, 3, 4, 5].includes(Number(row?.scoreStatusNo ?? 0));
}

async function listPriorityCourtNos({ supabase, raceId, limit = 12 }) {
  try {
    const { data, error } = await supabase
      .from('active_match_cache')
      .select('court_num, cache_status, last_seen_at')
      .eq('source', 'ymq')
      .eq('source_race_id', raceId)
      .order('last_seen_at', { ascending: false })
      .limit(limit * 4);
    if (error) return [];
    return Array.from(
      new Set(
        (Array.isArray(data) ? data : [])
          .filter((row) => row?.cache_status === 'ACTIVE' || row?.cache_status === 'READY_TO_PERSIST')
          .map((row) => Number(row?.court_num))
          .filter((courtNo) => Number.isFinite(courtNo) && courtNo > 0)
      )
    ).slice(0, limit);
  } catch {
    return [];
  }
}

async function fetchSyncRuntimeState({ supabase }) {
  try {
    const { data, error } = await supabase.from('sync_runtime_state').select('*').limit(1);
    if (error) {
      return {
        activeCachedCount: 0,
        pendingPersistCount: 0,
        persistedCount: 0,
      };
    }
    const row = Array.isArray(data) ? data[0] || {} : {};
    return {
      activeCachedCount: Number(row?.active_cached_count ?? 0),
      pendingPersistCount: Number(row?.pending_persist_count ?? 0),
      persistedCount: Number(row?.persisted_count ?? 0),
    };
  } catch {
    return {
      activeCachedCount: 0,
      pendingPersistCount: 0,
      persistedCount: 0,
    };
  }
}

async function cleanupSyncRuns({ supabase, source = 'ymq', keep = 5 }) {
  const { data: keepRows, error: keepErr } = await supabase
    .from('sync_runs')
    .select('id')
    .eq('source', source)
    .order('run_at', { ascending: false })
    .limit(keep);
  if (keepErr) throw keepErr;
  const keepIds = Array.isArray(keepRows) ? keepRows.map((r) => r?.id).filter(Boolean) : [];
  if (keepIds.length === 0) return;
  const inList = `(${keepIds.join(',')})`;
  const { error: delErr } = await supabase
    .from('sync_runs')
    .delete()
    .eq('source', source)
    .not('id', 'in', inList);
  if (delErr) throw delErr;
}

async function postJson(url, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), YMQ_HTTP_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${url}?t=${Date.now()}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`YMQ request timeout after ${YMQ_HTTP_TIMEOUT_MS}ms: ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`YMQ request failed ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

export function createSupabaseServiceClient({ url, serviceRoleKey }) {
  const transport = getNodeWebSocketTransport();
  const options = transport ? { realtime: { transport } } : undefined;
  return createClient(url, serviceRoleKey, options);
}

function getResetDbErrorMessage(error) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    return String(error.message || error.details || error.hint || JSON.stringify(error));
  }
  return String(error || '');
}

export function isResetDbUnavailableError(error) {
  const message = getResetDbErrorMessage(error);
  return /PGRST202|Could not find the function|does not exist|schema cache|permission denied/i.test(message);
}

export async function listCourts({ raceId }) {
  const resCourts = await postJson(YMQ_COURTS_URL, { body: { raceId }, header: {} });
  const courts = Array.isArray(resCourts.detail) ? resCourts.detail : [];
  return courts;
}

export async function listMatches({ raceId, courtNo, page, rows }) {
  const res = await postJson(YMQ_MATCHES_URL, {
    body: { raceId, courtNo, page, rows },
    header: {},
  });
  const list = Array.isArray(res.detail?.rows) ? res.detail.rows : [];
  const total = Number(res.detail?.total ?? list.length);
  return { rows: list, total };
}

export async function resetDb({ supabase }) {
  const { error } = await supabase.rpc('matchlife_reset_db');
  if (error) throw error;
}

export async function attemptResetDb({ supabase }) {
  try {
    await resetDb({ supabase });
    return {
      resetApplied: true,
      warning: null,
    };
  } catch (error) {
    if (!isResetDbUnavailableError(error)) {
      throw error;
    }
    return {
      resetApplied: false,
      warning: '当前环境暂不支持直接清空，已自动改为执行全量更新。',
    };
  }
}

export async function syncOnce({
  supabase,
  raceId,
  tournamentName,
  mode = 'full',
  courtNos,
  maxPages,
  runKind,
  syncRunMeta,
  sourcePriority = 100,
}) {
  const courts = await listCourts({ raceId });
  if (courts.length === 0) throw new Error('No courts returned');

  const rowsPerPage = 200;
  const pagesLimit = typeof maxPages === 'number' ? maxPages : mode === 'fast' ? 1 : 200;
  const explicitCourtNos = Array.isArray(courtNos)
    ? Array.from(new Set(courtNos.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0)))
    : [];
  const prioritizedCourtNos =
    explicitCourtNos.length > 0 || mode !== 'fast'
      ? []
      : await listPriorityCourtNos({ supabase, raceId });

  const allRows = [];
  const activeByCourt = new Map();
  const targetCourts =
    explicitCourtNos.length > 0
      ? courts.filter((c) => explicitCourtNos.includes(c.num))
      : prioritizedCourtNos.length > 0
        ? courts.filter((c) => prioritizedCourtNos.includes(c.num))
        : courts;
  for (const c of targetCourts) {
    let page = 1;
    let fetched = 0;
    let total = 0;
    while (true) {
      const res = await listMatches({ raceId, courtNo: c.num, page, rows: rowsPerPage });
      const list = res.rows;
      total = res.total;
      allRows.push(...list);
      fetched += list.length;
      if (fetched >= total || list.length === 0) break;
      page += 1;
      if (page > pagesLimit) break;
    }
  }

  const unique = new Map();
  for (const r of allRows) {
    if (r && typeof r.id === 'number') unique.set(r.id, r);
  }
  const uniqueRows = Array.from(unique.values());

  const records = [];
  let invalidCount = 0;
  for (const row of uniqueRows) {
    const err = validateRow(row);
    if (err) {
      invalidCount += 1;
      continue;
    }
    const playersA = names(row.playerOnes);
    const playersB = names(row.playerTwos);
    const playersText = [...playersA, ...playersB].join(' ').trim() || null;
    const winner = computeWinner(row);
    const scoreText = formatScore(row);
    const startTime = typeof row.raceTimestamp === 'number' ? new Date(row.raceTimestamp).toISOString() : null;
    const matchStartedAt = typeof row.scoreStartTime === 'number' ? new Date(row.scoreStartTime).toISOString() : null;
    const matchEndedAt = typeof row.scoreEndTime === 'number' ? new Date(row.scoreEndTime).toISOString() : null;
    const sourceUpdatedAt =
      typeof row.scoreEndTime === 'number'
        ? new Date(row.scoreEndTime).toISOString()
        : typeof row.scoreStartTime === 'number'
          ? new Date(row.scoreStartTime).toISOString()
          : new Date().toISOString();

    const rawHash = sha1(JSON.stringify(row));

    const { ageYears, itemName, eventKey } = parseEventKey(row);
    const roundName = parseRoundName(row);
    if (isActiveLiveMatch(row) && Number.isFinite(Number(row.courtNum)) && Number(row.courtNum) > 0) {
      activeByCourt.set(Number(row.courtNum), pagesLimit);
    }

    records.push(buildCanonicalMatchRecord({
      source: 'ymq',
      source_race_id: raceId,
      source_match_id: `ymq:${row.id}`,
      category: row.groupName || 'U',
      tournament_name: tournamentName,
      start_time: startTime,
      match_started_at: matchStartedAt,
      match_ended_at: matchEndedAt,
      location: row.courtName || null,
      city: null,
      court_num: row.courtNum ?? null,
      match_no: row.raceTimeNum ?? null,
      match_time_name: row.raceTimeName ?? null,
      round_name: roundName,
      players_a: playersA,
      players_b: playersB,
      players_text: playersText,
      score_text: scoreText,
      winner_side: winner,
      source_status_no: Number.isFinite(Number(row.scoreStatusNo)) ? Number(row.scoreStatusNo) : null,
      source_updated_at: sourceUpdatedAt,
      raw_hash: rawHash,
      raw: row,
      age_years: ageYears,
      item_name: itemName,
      event_key: eventKey,
    }, {
      sourcePriority,
    }));
  }

  // Avoid oversized request bodies through nginx/proxy by chunking RPC writes.
  const RPC_BATCH_SIZE = Number(process.env.MATCHLIFE_RPC_BATCH_SIZE || 150);
  let cacheInserted = 0;
  let cacheUpdated = 0;
  let cacheSkipped = 0;
  let activeCached = 0;
  let queuedPersist = 0;
  let ignoredCount = 0;
  for (const batch of chunkArray(records, RPC_BATCH_SIZE)) {
    const { data: stageRes, error: stageErr } = await supabase.rpc('stage_live_matches', {
      records: batch,
    });
    if (stageErr) throw stageErr;
    cacheInserted += Number(stageRes?.cached_inserted_count ?? 0);
    cacheUpdated += Number(stageRes?.cached_updated_count ?? 0);
    cacheSkipped += Number(stageRes?.cached_skipped_count ?? 0);
    activeCached += Number(stageRes?.active_cached_count ?? 0);
    queuedPersist += Number(stageRes?.queued_persist_count ?? 0);
    ignoredCount += Number(stageRes?.ignored_count ?? 0);
  }

  const { data: persistRes, error: persistErr } = await supabase.rpc('persist_ready_active_matches');
  if (persistErr) throw persistErr;
  const inserted = Number(persistRes?.persisted_inserted_count ?? 0);
  const updated = Number(persistRes?.persisted_updated_count ?? 0);
  const skipped = Number(persistRes?.persisted_skipped_count ?? 0);
  const persistedCount = Number(persistRes?.marked_persisted_count ?? 0);
  const persistFailedCount = Number(persistRes?.persist_failed_count ?? 0);
  const archivedCount = Number(persistRes?.archived_count ?? 0);
  const compensatedCount = Number(persistRes?.compensated_count ?? 0);
  const runtimeState = await fetchSyncRuntimeState({ supabase });

  const pulled = uniqueRows.length;
  const validated = records.length;
  const successfulStored = inserted + updated + skipped;

  const { error: syncRunErr } = await supabase.from('sync_runs').insert({
    source: 'ymq',
    source_id: syncRunMeta?.sourceId || null,
    adapter_key: syncRunMeta?.adapterKey || null,
    status: 'SUCCESS',
    pulled_count: pulled,
    upserted_count: successfulStored,
    active_cached_count: runtimeState.activeCachedCount,
    pending_persist_count: runtimeState.pendingPersistCount,
    persisted_count: runtimeState.persistedCount,
    run_group: syncRunMeta?.runGroup || null,
    trigger_mode: syncRunMeta?.triggerMode || 'manual',
    attempt_no: Number(syncRunMeta?.attemptNo || 1),
    retry_kind: syncRunMeta?.retryKind || 'primary',
    circuit_state: syncRunMeta?.circuitState || 'closed',
    isolation_key: syncRunMeta?.isolationKey || null,
    result_payload: {
      raceId,
      cacheInserted,
      cacheUpdated,
      cacheSkipped,
      activeCached: runtimeState.activeCachedCount,
      pendingPersist: runtimeState.pendingPersistCount,
      persisted: persistedCount,
      inserted,
      updated,
      skipped,
        persistFailedCount,
        archivedCount,
        compensatedCount,
      ignoredCount,
      activeCourts: Array.from(activeByCourt.keys()),
      prioritizedCourtNos,
    },
    error_message:
      `mode=${mode}; kind=${String(runKind || mode)}; validated=${validated}; invalid=${invalidCount}; ` +
      `cacheInserted=${cacheInserted}; cacheUpdated=${cacheUpdated}; cacheSkipped=${cacheSkipped}; ` +
      `activeCached=${runtimeState.activeCachedCount}; pendingPersist=${runtimeState.pendingPersistCount}; ` +
      `persisted=${persistedCount}; inserted=${inserted}; updated=${updated}; skipped=${skipped}; ` +
      `persistFailed=${persistFailedCount}; archived=${archivedCount}; compensated=${compensatedCount}; ` +
      `ignored=${ignoredCount}; hotCourts=${activeByCourt.size}; priorityCourts=${prioritizedCourtNos.length}; ` +
      `courts=${targetCourts.length}; pages=${pagesLimit}`,
  });
  if (syncRunErr) throw syncRunErr;

  await cleanupSyncRuns({ supabase, source: 'ymq', keep: 5 });

  return {
    ok: true,
    raceId,
    courts: targetCourts.length,
    mode,
    pulled,
    validated,
    invalid: invalidCount,
    cacheInserted,
    cacheUpdated,
    cacheSkipped,
    activeCached: runtimeState.activeCachedCount,
    pendingPersist: runtimeState.pendingPersistCount,
    persistedCount,
    inserted,
    updated,
    skipped,
    persistFailedCount,
    archivedCount,
    compensatedCount,
    pulledCount: pulled,
    upsertedCount: successfulStored,
    ignoredCount,
    prioritizedCourtNos,
    activeCourts: Array.from(activeByCourt.entries()).map(([courtNo, maxPage]) => ({
      courtNo,
      maxPage,
    })),
  };
}
