import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

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
  return createClient(url, serviceRoleKey);
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

export async function syncOnce({
  supabase,
  raceId,
  tournamentName,
  mode = 'full',
  courtNos,
  maxPages,
  runKind,
}) {
  const courts = await listCourts({ raceId });
  if (courts.length === 0) throw new Error('No courts returned');

  const rowsPerPage = 200;
  const pagesLimit = typeof maxPages === 'number' ? maxPages : mode === 'fast' ? 1 : 200;

  const allRows = [];
  const activeByCourt = new Map();
  const targetCourts = Array.isArray(courtNos) && courtNos.length > 0 ? courts.filter((c) => courtNos.includes(c.num)) : courts;
  for (const c of targetCourts) {
    let page = 1;
    let fetched = 0;
    let total = 0;
    while (true) {
      const res = await listMatches({ raceId, courtNo: c.num, page, rows: rowsPerPage });
      const list = res.rows;
      total = res.total;
      if (list.some((r) => r?.scoreStatusNo !== 2)) {
        activeByCourt.set(c.num, page);
      }
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

    records.push({
      source: 'ymq',
      ymq_match_id: `ymq:${row.id}`,
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
      source_updated_at: sourceUpdatedAt,
      raw_hash: rawHash,
      raw: row,
      age_years: ageYears,
      item_name: itemName,
      event_key: eventKey,
    });
  }

  // Avoid oversized request bodies through nginx/proxy by chunking RPC writes.
  const RPC_BATCH_SIZE = Number(process.env.MATCHLIFE_RPC_BATCH_SIZE || 150);
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  for (const batch of chunkArray(records, RPC_BATCH_SIZE)) {
    const { data: upsertRes, error: upsertErr } = await supabase.rpc('upsert_matches_if_changed', {
      records: batch,
    });
    if (upsertErr) throw upsertErr;
    inserted += Number(upsertRes?.inserted_count ?? 0);
    updated += Number(upsertRes?.updated_count ?? 0);
    skipped += Number(upsertRes?.skipped_count ?? 0);
  }

  const pulled = uniqueRows.length;
  const validated = records.length;
  const successfulStored = inserted + updated + skipped;

  const { error: syncRunErr } = await supabase.from('sync_runs').insert({
    source: 'ymq',
    status: 'SUCCESS',
    pulled_count: pulled,
    upserted_count: successfulStored,
    error_message: `mode=${mode}; kind=${String(runKind || mode)}; validated=${validated}; invalid=${invalidCount}; inserted=${inserted}; updated=${updated}; skipped=${skipped}; hotCourts=${activeByCourt.size}; courts=${targetCourts.length}; pages=${pagesLimit}`,
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
    inserted,
    updated,
    skipped,
    activeCourts: Array.from(activeByCourt.entries()).map(([courtNo, maxPage]) => ({
      courtNo,
      maxPage,
    })),
  };
}
