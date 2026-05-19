import fs from 'node:fs/promises';
import crypto from 'crypto';
import { buildCanonicalMatchRecord } from './canonical-match.mjs';

function sha1(value) {
  return crypto.createHash('sha1').update(value).digest('hex');
}

export async function syncTennisOnce({
  supabase,
  sourceUrl,
  tournamentName,
  mode = 'full',
  runKind,
  syncRunMeta,
  sourcePriority = 100,
}) {
  // Fetch data from local json file or http endpoint
  let rawData;
  try {
    if (sourceUrl.startsWith('http')) {
      const res = await fetch(sourceUrl);
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      rawData = await res.json();
    } else {
      const fileContent = await fs.readFile(sourceUrl, 'utf-8');
      rawData = JSON.parse(fileContent);
    }
  } catch (error) {
    throw new Error(`Failed to read or parse tennis json file: ${error.message}`);
  }

  const list = Array.isArray(rawData) ? rawData : (Array.isArray(rawData.matches) ? rawData.matches : []);
  if (list.length === 0) {
    throw new Error('No matches found in tennis json');
  }

  const unique = new Map();
  for (const r of list) {
    if (r && typeof r.id === 'string') unique.set(r.id, r);
  }
  const uniqueRows = Array.from(unique.values());

  const records = [];
  let invalidCount = 0;
  for (const row of uniqueRows) {
    if (!row || !row.id || !row.playersA || !row.playersB) {
      invalidCount += 1;
      continue;
    }
    
    const playersA = Array.isArray(row.playersA) ? row.playersA : [row.playersA].filter(Boolean);
    const playersB = Array.isArray(row.playersB) ? row.playersB : [row.playersB].filter(Boolean);
    
    if (playersA.length === 0 && playersB.length === 0) {
      invalidCount += 1;
      continue;
    }

    const playersText = [...playersA, ...playersB].join(' ').trim() || null;
    
    const winner = row.winnerSide === 'A' || row.winnerSide === 'B' ? row.winnerSide : 'UNKNOWN';
    const scoreText = row.score || null;
    const startTime = row.startTime ? new Date(row.startTime).toISOString() : null;
    const matchStartedAt = row.matchStartedAt ? new Date(row.matchStartedAt).toISOString() : null;
    const matchEndedAt = row.matchEndedAt ? new Date(row.matchEndedAt).toISOString() : null;
    const sourceUpdatedAt = row.updatedAt ? new Date(row.updatedAt).toISOString() : new Date().toISOString();

    const rawHash = sha1(JSON.stringify(row));

    records.push(buildCanonicalMatchRecord({
      source: 'tennis-json',
      source_match_id: `tennis:${row.id}`,
      category: row.category || 'Open',
      tournament_name: tournamentName || row.tournamentName || 'Tennis Match',
      start_time: startTime,
      match_started_at: matchStartedAt,
      match_ended_at: matchEndedAt,
      location: row.location || null,
      city: row.city || null,
      court_num: row.courtNum ?? null,
      match_no: row.matchNo ?? null,
      match_time_name: row.matchTimeName ?? null,
      round_name: row.roundName || null,
      players_a: playersA,
      players_b: playersB,
      players_text: playersText,
      score_text: scoreText,
      winner_side: winner,
      source_updated_at: sourceUpdatedAt,
      raw_hash: rawHash,
      raw: row,
      age_years: null,
      item_name: row.category || null,
      event_key: row.category || null,
    }, {
      sourcePriority,
    }));
  }

  // Avoid oversized request bodies through nginx/proxy by chunking RPC writes.
  const RPC_BATCH_SIZE = Number(process.env.MATCHLIFE_RPC_BATCH_SIZE || 150);
  
  function chunkArray(arr, size) {
    if (!Array.isArray(arr) || arr.length === 0) return [];
    const out = [];
    for (let i = 0; i < arr.length; i += size) {
      out.push(arr.slice(i, i + size));
    }
    return out;
  }

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

  const pulled = uniqueRows.length;
  const validated = records.length;
  const successfulStored = inserted + updated + skipped;

  const { error: syncRunErr } = await supabase.from('sync_runs').insert({
    source: 'tennis-json',
    source_id: syncRunMeta?.sourceId || null,
    adapter_key: syncRunMeta?.adapterKey || null,
    status: 'SUCCESS',
    pulled_count: pulled,
    upserted_count: successfulStored,
    run_group: syncRunMeta?.runGroup || null,
    trigger_mode: syncRunMeta?.triggerMode || 'manual',
    attempt_no: Number(syncRunMeta?.attemptNo || 1),
    retry_kind: syncRunMeta?.retryKind || 'primary',
    circuit_state: syncRunMeta?.circuitState || 'closed',
    isolation_key: syncRunMeta?.isolationKey || null,
    result_payload: {
      cacheInserted,
      cacheUpdated,
      cacheSkipped,
      activeCached,
      queuedPersist,
      inserted,
      updated,
      skipped,
      persistedCount,
      persistFailedCount,
      archivedCount,
      compensatedCount,
      invalidCount,
      ignoredCount,
      sourceUrl,
    },
    error_message:
      `mode=${mode}; kind=${String(runKind || mode)}; validated=${validated}; invalid=${invalidCount}; ` +
      `cacheInserted=${cacheInserted}; cacheUpdated=${cacheUpdated}; cacheSkipped=${cacheSkipped}; ` +
      `activeCached=${activeCached}; pendingPersist=${queuedPersist}; persisted=${persistedCount}; ` +
      `inserted=${inserted}; updated=${updated}; skipped=${skipped}; ` +
      `persistFailed=${persistFailedCount}; archived=${archivedCount}; compensated=${compensatedCount}; ignored=${ignoredCount}`,
  });
  if (syncRunErr) throw syncRunErr;

  return {
    ok: true,
    mode,
    pulled,
    validated,
    invalid: invalidCount,
    cacheInserted,
    cacheUpdated,
    cacheSkipped,
    activeCached,
    queuedPersist,
    inserted,
    updated,
    skipped,
    persistedCount,
    persistFailedCount,
    archivedCount,
    compensatedCount,
    ignoredCount,
  };
}
