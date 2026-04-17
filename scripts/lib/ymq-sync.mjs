import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const YMQ_COURTS_URL = 'https://race.ymq.me/webservice/appWxRace/courts.do';
const YMQ_MATCHES_URL = 'https://race.ymq.me/webservice/appWxMatch/matchesScore.do';

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
    const m = fullName.match(/\d{1,2}\s*岁\s*([^\s\[]+)/);
    if (m && m[1]) item = m[1].trim();
  }

  let normalizedItem = item || null;
  if (ageYears && normalizedItem) {
    normalizedItem = normalizedItem.replace(new RegExp(`^${ageYears}\\s*岁`), '').trim();
  }

  const eventKey = ageYears && normalizedItem ? `${ageYears}岁${normalizedItem}` : normalizedItem || null;
  return { ageYears, itemName: item || null, eventKey };
}

async function postJson(url, payload) {
  const res = await fetch(`${url}?t=${Date.now()}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`YMQ request failed ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

export function createSupabaseServiceClient({ url, serviceRoleKey }) {
  return createClient(url, serviceRoleKey);
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
}) {
  const resCourts = await postJson(YMQ_COURTS_URL, { body: { raceId }, header: {} });
  const courts = Array.isArray(resCourts.detail) ? resCourts.detail : [];
  if (courts.length === 0) throw new Error('No courts returned');

  const rowsPerPage = 200;
  const maxPages = mode === 'fast' ? 1 : 200;

  const allRows = [];
  for (const c of courts) {
    let page = 1;
    let fetched = 0;
    let total = 0;
    while (true) {
      const res = await postJson(YMQ_MATCHES_URL, {
        body: { raceId, courtNo: c.num, page, rows: rowsPerPage },
        header: {},
      });
      const list = Array.isArray(res.detail?.rows) ? res.detail.rows : [];
      total = Number(res.detail?.total ?? list.length);
      allRows.push(...list);
      fetched += list.length;
      if (fetched >= total || list.length === 0) break;
      page += 1;
      if (page > maxPages) break;
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
    const sourceUpdatedAt =
      typeof row.scoreEndTime === 'number'
        ? new Date(row.scoreEndTime).toISOString()
        : typeof row.scoreStartTime === 'number'
          ? new Date(row.scoreStartTime).toISOString()
          : new Date().toISOString();

    const rawHash = sha1(JSON.stringify(row));

    const { ageYears, itemName, eventKey } = parseEventKey(row);

    records.push({
      source: 'ymq',
      ymq_match_id: `ymq:${row.id}`,
      category: row.groupName || 'U',
      tournament_name: tournamentName,
      start_time: startTime,
      location: row.courtName || null,
      city: null,
      court_num: row.courtNum ?? null,
      match_no: row.raceTimeNum ?? null,
      match_time_name: row.raceTimeName ?? null,
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

  const { data: upsertRes, error: upsertErr } = await supabase.rpc('upsert_matches_if_changed', {
    records,
  });
  if (upsertErr) throw upsertErr;

  const inserted = Number(upsertRes?.inserted_count ?? 0);
  const updated = Number(upsertRes?.updated_count ?? 0);
  const skipped = Number(upsertRes?.skipped_count ?? 0);

  const pulled = uniqueRows.length;
  const validated = records.length;

  await supabase.from('sync_runs').insert({
    source: 'ymq',
    status: 'SUCCESS',
    pulled_count: pulled,
    upserted_count: inserted + updated,
    error_message: `mode=${mode}; validated=${validated}; invalid=${invalidCount}; inserted=${inserted}; updated=${updated}; skipped=${skipped}`,
  });

  return {
    ok: true,
    raceId,
    courts: courts.length,
    mode,
    pulled,
    validated,
    invalid: invalidCount,
    inserted,
    updated,
    skipped,
  };
}
