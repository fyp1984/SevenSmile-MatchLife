import fs from 'node:fs/promises';
import crypto from 'crypto';

function sha1(value) {
  return crypto.createHash('sha1').update(value).digest('hex');
}

export async function syncTennisOnce({ supabase, sourceUrl, tournamentName, mode = 'full', runKind }) {
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

    records.push({
      source: 'tennis-json',
      ymq_match_id: `tennis:${row.id}`,
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
    });
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
    source: 'tennis-json',
    status: 'SUCCESS',
    pulled_count: pulled,
    upserted_count: successfulStored,
    error_message: `mode=${mode}; kind=${String(runKind || mode)}; validated=${validated}; invalid=${invalidCount}; inserted=${inserted}; updated=${updated}; skipped=${skipped}`,
  });
  if (syncRunErr) throw syncRunErr;

  return {
    ok: true,
    mode,
    pulled,
    validated,
    invalid: invalidCount,
    inserted,
    updated,
    skipped,
  };
}